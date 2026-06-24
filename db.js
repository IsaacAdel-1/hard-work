/* ============================================================
   db.js — MongoDB connection module
   Connects once and reuses a single client across the app.
   The database name is taken from the MONGODB_URI connection string.
   ============================================================ */
const { MongoClient } = require("mongodb");
const dns = require("dns");

// On some Windows networks Node's DNS resolver (c-ares) gets ECONNREFUSED on the
// SRV lookup that "mongodb+srv://" requires, even though nslookup works fine.
// Forcing a reliable public DNS resolver fixes it. Set DNS_OVERRIDE=off to skip.
if (process.env.DNS_OVERRIDE !== "off") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set. Add it to your .env file.");
}

// One shared client for the whole process (no reconnect per request).
const client = new MongoClient(uri);
let db = null;

// Call once at startup. Safe to call again — returns the cached connection.
async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "workhard"); // explicit DB name
  console.log("✅ Connected to MongoDB");
  await ensureIndexes();
  return db;
}

// Indexes: enforce unique usernames/ids + speed up per-user queries
async function ensureIndexes() {
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("users").createIndex({ id: 1 }, { unique: true });
  await db.collection("tasks").createIndex({ userId: 1 });
  await db.collection("tasks").createIndex({ id: 1 }, { unique: true });
  await db.collection("settings").createIndex({ userId: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ userId: 1 }, { unique: true });
}

function getDB() {
  if (!db) throw new Error("DB not connected yet. Call connectDB() first.");
  return db;
}

function getCollection(name) {
  return getDB().collection(name);
}

module.exports = { connectDB, getDB, getCollection, client };
