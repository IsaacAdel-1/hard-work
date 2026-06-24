/* ============================================================
   Work Hard — Backend (Express + MongoDB)
   Features: user accounts (register/login), per-user tasks,
   pomodoro settings & session counts.
   ============================================================ */
require("dotenv").config(); // loads variables from .env into process.env
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { connectDB, getCollection } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "work-hard-dev-secret-change-me";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// collection accessors
const users = () => getCollection("users");
const tasks = () => getCollection("tasks");
const settings = () => getCollection("settings");
const sessions = () => getCollection("sessions");

function newId() {
  return crypto.randomUUID();
}

/* ---------- Auth middleware ---------- */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET); // { id, username }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ============================================================
   AUTH ROUTES
   ============================================================ */
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });
  if (username.length < 3)
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  if (password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters" });

  const uname = username.trim().toLowerCase();
  const existing = await users().findOne({ username: uname });
  if (existing) return res.status(409).json({ error: "Username already taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: newId(),
    username: uname,
    displayName: username.trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await users().insertOne(user);
  await settings().insertOne({ userId: user.id, focus: 25, break: 5 });

  const token = jwt.sign({ id: user.id, username: user.displayName }, JWT_SECRET, {
    expiresIn: "30d",
  });
  res.json({ token, username: user.displayName });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });

  const uname = username.trim().toLowerCase();
  const user = await users().findOne({ username: uname });
  if (!user) return res.status(401).json({ error: "Invalid username or password" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  const token = jwt.sign({ id: user.id, username: user.displayName }, JWT_SECRET, {
    expiresIn: "30d",
  });
  res.json({ token, username: user.displayName });
});

app.get("/api/me", auth, async (req, res) => {
  const user = await users().findOne({ id: req.user.id });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ username: user.displayName, createdAt: user.createdAt });
});

/* ============================================================
   TASK ROUTES
   ============================================================ */
app.get("/api/tasks", auth, async (req, res) => {
  const list = await tasks()
    .find({ userId: req.user.id }, { projection: { _id: 0 } })
    .toArray();
  res.json(list);
});

app.post("/api/tasks", auth, async (req, res) => {
  const { text, color } = req.body || {};
  if (!text || !text.trim())
    return res.status(400).json({ error: "Task text is required" });

  const task = {
    id: newId(),
    userId: req.user.id,
    text: text.trim(),
    color: color || "#6366f1",
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await tasks().insertOne(task);
  delete task._id; // insertOne adds _id; strip it so the response stays identical
  res.json(task);
});

app.patch("/api/tasks/:id", auth, async (req, res) => {
  const filter = { id: req.params.id, userId: req.user.id };
  const updates = {};
  if (typeof req.body.done === "boolean") {
    updates.done = req.body.done;
    updates.completedAt = req.body.done ? new Date().toISOString() : null;
  }
  if (typeof req.body.text === "string" && req.body.text.trim())
    updates.text = req.body.text.trim();
  if (typeof req.body.color === "string") updates.color = req.body.color;

  // nothing to change -> just return the current task
  if (Object.keys(updates).length === 0) {
    const current = await tasks().findOne(filter, { projection: { _id: 0 } });
    if (!current) return res.status(404).json({ error: "Task not found" });
    return res.json(current);
  }

  const updated = await tasks().findOneAndUpdate(
    filter,
    { $set: updates },
    { returnDocument: "after", projection: { _id: 0 } }
  );
  if (!updated) return res.status(404).json({ error: "Task not found" });
  res.json(updated);
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const result = await tasks().deleteOne({ id: req.params.id, userId: req.user.id });
  if (result.deletedCount === 0)
    return res.status(404).json({ error: "Task not found" });
  res.json({ ok: true });
});

/* ============================================================
   POMODORO SETTINGS + SESSIONS
   ============================================================ */
app.get("/api/settings", auth, async (req, res) => {
  const doc = await settings().findOne({ userId: req.user.id });
  res.json(doc ? { focus: doc.focus, break: doc.break } : { focus: 25, break: 5 });
});

app.put("/api/settings", auth, async (req, res) => {
  const focus = parseInt(req.body.focus, 10);
  const brk = parseInt(req.body.break, 10);
  if (!focus || focus < 1 || !brk || brk < 1)
    return res.status(400).json({ error: "Invalid durations" });
  await settings().updateOne(
    { userId: req.user.id },
    { $set: { focus, break: brk } },
    { upsert: true }
  );
  res.json({ focus, break: brk });
});

// Today's completed pomodoro sessions
app.get("/api/sessions", auth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rec = await sessions().findOne({ userId: req.user.id });
  const count = rec && rec.date === today ? rec.count : 0;
  res.json({ date: today, count });
});

app.post("/api/sessions/increment", auth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rec = await sessions().findOne({ userId: req.user.id });
  const count = rec && rec.date === today ? rec.count + 1 : 1;
  await sessions().updateOne(
    { userId: req.user.id },
    { $set: { date: today, count } },
    { upsert: true }
  );
  res.json({ date: today, count });
});

/* ---------- Fallback to index.html ---------- */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- Start the server ----------
   The frontend currently runs in guest mode (data stays in the browser), so the
   static app must always be served. We start listening immediately and connect
   to MongoDB in the background — the (dormant) account API uses it once ready. */
app.listen(PORT, () => {
  console.log(`\n✅ Work Hard server running on port ${PORT}\n`);
});

connectDB()
  .then(() => console.log("✅ Connected to MongoDB (account API ready)"))
  .catch((err) =>
    console.warn("⚠️  MongoDB not connected — account API disabled:", err.message)
  );

if (JWT_SECRET === "work-hard-dev-secret-change-me") {
  console.warn("⚠️  Using the default JWT_SECRET. Set a strong JWT_SECRET env var in production.");
}
