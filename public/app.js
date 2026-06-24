/* ============================================================
   Work Hard — Frontend
   Works in two modes:
     • Guest    -> data saved in this browser (localStorage)
     • Logged in -> data saved on the server (per account)
   Guest data is migrated to the account on sign-up / login.
   ============================================================ */

const API = "/api";
let token = localStorage.getItem("wh_token") || null;
let isGuest = false;
let tasks = [];
let settings = { focus: 25, break: 5 };
let selectedColor = "#6366f1";

/* ---------- small helpers ---------- */
function lsGet(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ---------- API helper ---------- */
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ============================================================
   STORAGE LAYER — branches on guest vs logged-in
   ============================================================ */
const store = {
  async getTasks() {
    if (isGuest) return lsGet("wh_guest_tasks", []);
    return api("/tasks");
  },
  async addTask(text, color) {
    if (isGuest) {
      const t = {
        id: uid(), text, color, done: false,
        createdAt: new Date().toISOString(), completedAt: null,
      };
      const all = lsGet("wh_guest_tasks", []);
      all.push(t);
      lsSet("wh_guest_tasks", all);
      return t;
    }
    return api("/tasks", { method: "POST", body: JSON.stringify({ text, color }) });
  },
  async toggleTask(id, done) {
    if (isGuest) {
      const all = lsGet("wh_guest_tasks", []);
      const t = all.find((x) => x.id === id);
      if (t) { t.done = done; t.completedAt = done ? new Date().toISOString() : null; }
      lsSet("wh_guest_tasks", all);
      return t;
    }
    return api("/tasks/" + id, { method: "PATCH", body: JSON.stringify({ done }) });
  },
  async deleteTask(id) {
    if (isGuest) {
      lsSet("wh_guest_tasks", lsGet("wh_guest_tasks", []).filter((x) => x.id !== id));
      return;
    }
    return api("/tasks/" + id, { method: "DELETE" });
  },
  async getSettings() {
    if (isGuest) return lsGet("wh_guest_settings", { focus: 25, break: 5 });
    return api("/settings");
  },
  async saveSettings(focus, brk) {
    if (isGuest) { const s = { focus, break: brk }; lsSet("wh_guest_settings", s); return s; }
    return api("/settings", { method: "PUT", body: JSON.stringify({ focus, break: brk }) });
  },
  async getSessions() {
    if (isGuest) {
      const rec = lsGet("wh_guest_sessions", null);
      return rec && rec.date === todayStr() ? rec : { date: todayStr(), count: 0 };
    }
    return api("/sessions");
  },
  async incrementSession() {
    if (isGuest) {
      let rec = lsGet("wh_guest_sessions", null);
      if (!rec || rec.date !== todayStr()) rec = { date: todayStr(), count: 0 };
      rec.count++;
      lsSet("wh_guest_sessions", rec);
      return rec;
    }
    return api("/sessions/increment", { method: "POST" });
  },
};

/* ============================================================
   AUTH
   ============================================================ */
const authScreen = document.getElementById("auth-screen");
const appEl = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authUsername = document.getElementById("auth-username");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authTabs = document.querySelectorAll(".auth-tab");
const guestBtn = document.getElementById("guest-btn");
const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");

let authMode = "login";

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.auth;
    authTabs.forEach((t) => t.classList.toggle("active", t === tab));
    authSubmit.textContent = authMode === "login" ? "Login" : "Create account";
    authError.textContent = "";
  });
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!username || !password) { authError.textContent = "Please fill in all fields"; return; }

  authSubmit.disabled = true;
  try {
    const data = await api("/" + authMode, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    localStorage.setItem("wh_token", token);
    isGuest = false;

    // migrate any guest data created in this browser
    await migrateGuestData();

    await enterApp(data.username);
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

guestBtn.addEventListener("click", async () => {
  isGuest = true;
  if (!localStorage.getItem("wh_guest_since"))
    lsSet("wh_guest_since", new Date().toISOString());
  await enterApp("Guest");
});

logoutBtn.addEventListener("click", () => {
  stopTimer();
  if (isGuest) {
    // guest -> just go back to auth (keep local data so it can be saved)
    appEl.style.display = "none";
    authScreen.style.display = "block";
    return;
  }
  token = null;
  localStorage.removeItem("wh_token");
  appEl.style.display = "none";
  authScreen.style.display = "block";
  authUsername.value = "";
  authPassword.value = "";
});

async function migrateGuestData() {
  const gTasks = lsGet("wh_guest_tasks", []);
  const gSettings = lsGet("wh_guest_settings", null);
  if (gTasks.length === 0 && !gSettings) return;

  const ok = confirm(
    `You created ${gTasks.length} task(s) as a guest.\nAdd them to your account?`
  );
  if (ok) {
    for (const t of gTasks) {
      try {
        const created = await api("/tasks", {
          method: "POST",
          body: JSON.stringify({ text: t.text, color: t.color }),
        });
        if (t.done)
          await api("/tasks/" + created.id, {
            method: "PATCH",
            body: JSON.stringify({ done: true }),
          });
      } catch (e) { /* skip failed item */ }
    }
    if (gSettings) {
      try {
        await api("/settings", {
          method: "PUT",
          body: JSON.stringify({ focus: gSettings.focus, break: gSettings.break }),
        });
      } catch (e) { /* ignore */ }
    }
  }
  // clear guest data either way (user decided)
  localStorage.removeItem("wh_guest_tasks");
  localStorage.removeItem("wh_guest_settings");
  localStorage.removeItem("wh_guest_sessions");
  localStorage.removeItem("wh_guest_since");
}

async function enterApp(username) {
  authScreen.style.display = "none";
  appEl.style.display = "block";

  if (isGuest) {
    userNameEl.textContent = "👤 Guest";
    logoutBtn.textContent = "💾 Save / Sign up";
    logoutBtn.classList.add("is-guest");
  } else {
    userNameEl.textContent = "👋 " + username;
    logoutBtn.textContent = "Logout";
    logoutBtn.classList.remove("is-guest");
  }

  // load data through the storage layer
  tasks = await store.getTasks();
  settings = await store.getSettings();
  focusInput.value = settings.focus;
  breakInput.value = settings.break;
  remainingSeconds = settings.focus * 60;

  const sess = await store.getSessions();
  sessionData = { date: sess.date, count: sess.count };
  sessionsCount.textContent = sessionData.count;

  let createdAt = null;
  if (isGuest) createdAt = lsGet("wh_guest_since", null);
  else {
    try { createdAt = (await api("/me")).createdAt; } catch (e) {}
  }

  renderTasks();
  updateDisplay();
  renderProfile(username, createdAt);
}

/* Auto-login if a valid token exists */
(async function init() {
  if (!token) return;
  try {
    const me = await api("/me");
    isGuest = false;
    await enterApp(me.username);
  } catch (e) {
    token = null;
    localStorage.removeItem("wh_token");
  }
})();

/* ============================================================
   TABS
   ============================================================ */
const tabsNav = document.querySelector(".tabs");
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("active", p.id === target));
    tabsNav.dataset.active = target;
    if (target === "profile") renderHistory();
  });
});

/* ============================================================
   TO-DO BOARD
   ============================================================ */
const todoInput = document.getElementById("todo-input");
const addTaskBtn = document.getElementById("add-task-btn");
const colorPicker = document.getElementById("color-picker");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeCount = document.getElementById("active-count");
const doneCount = document.getElementById("done-count");

colorPicker.addEventListener("click", (e) => {
  const swatch = e.target.closest(".swatch");
  if (!swatch) return;
  selectedColor = swatch.dataset.color;
  colorPicker.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s === swatch));
});

function buildTaskCard(task) {
  const card = document.createElement("div");
  card.className = "task" + (task.done ? " is-done" : "");
  card.style.setProperty("--c", task.color);

  const text = document.createElement("div");
  text.className = "task-text";
  text.textContent = task.text;

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "task-btn " + (task.done ? "btn-undo" : "btn-complete");
  toggleBtn.textContent = task.done ? "↩ Undo" : "✓ Done";
  toggleBtn.addEventListener("click", () => toggleTask(task.id));

  const xBtn = document.createElement("button");
  xBtn.className = "task-btn btn-x";
  xBtn.textContent = "✕";
  xBtn.title = "Delete";
  xBtn.addEventListener("click", () => deleteTask(task.id));

  actions.append(toggleBtn, xBtn);
  card.append(text, actions);
  return card;
}

function renderTasks() {
  activeList.innerHTML = "";
  doneList.innerHTML = "";

  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  if (active.length === 0) activeList.innerHTML = '<div class="empty-col">No tasks yet ➕</div>';
  else active.forEach((t) => activeList.appendChild(buildTaskCard(t)));

  if (done.length === 0) doneList.innerHTML = '<div class="empty-col">Nothing done yet 💪</div>';
  else done.forEach((t) => doneList.appendChild(buildTaskCard(t)));

  activeCount.textContent = active.length;
  doneCount.textContent = done.length;
  updateProfileStats();
}

async function addTask() {
  const text = todoInput.value.trim();
  if (!text) { todoInput.focus(); return; }
  try {
    const task = await store.addTask(text, selectedColor);
    tasks.push(task);
    renderTasks();
    todoInput.value = "";
    todoInput.focus();
  } catch (e) { alert(e.message); }
}

async function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  try {
    const updated = await store.toggleTask(id, !task.done);
    if (updated) Object.assign(task, updated);
    renderTasks();
  } catch (e) { alert(e.message); }
}

async function deleteTask(id) {
  try {
    await store.deleteTask(id);
    tasks = tasks.filter((t) => t.id !== id);
    renderTasks();
  } catch (e) { alert(e.message); }
}

addTaskBtn.addEventListener("click", addTask);
todoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });

/* ============================================================
   PROFILE
   ============================================================ */
const avatarEl = document.getElementById("avatar");
const profileName = document.getElementById("profile-name");
const profileJoined = document.getElementById("profile-joined");
const statTotal = document.getElementById("stat-total");
const statToday = document.getElementById("stat-today");
const statPending = document.getElementById("stat-pending");
const profileSearch = document.getElementById("profile-search");
const dayFilter = document.getElementById("profile-day-filter");
const historyEl = document.getElementById("profile-history");

function renderProfile(username, createdAt) {
  avatarEl.textContent = (username || "?")[0].toUpperCase();
  profileName.textContent = username;
  if (createdAt) {
    const d = new Date(createdAt);
    profileJoined.textContent =
      (isGuest ? "Browsing since " : "Joined ") +
      d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } else {
    profileJoined.textContent = isGuest ? "Guest session" : "";
  }
  updateProfileStats();
}

function updateProfileStats() {
  const done = tasks.filter((t) => t.done);
  const ts = todayStr();
  statTotal.textContent = done.length;
  statToday.textContent = done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) === ts).length;
  statPending.textContent = tasks.filter((t) => !t.done).length;
}

function renderHistory() {
  updateProfileStats();
  const search = profileSearch.value.trim().toLowerCase();
  const filterVal = dayFilter.value;
  const now = new Date();

  let done = tasks.filter((t) => t.done && t.completedAt);
  if (search) done = done.filter((t) => t.text.toLowerCase().includes(search));

  if (filterVal === "today") {
    done = done.filter((t) => t.completedAt.slice(0, 10) === todayStr());
  } else if (filterVal === "7" || filterVal === "30") {
    const cutoff = new Date(now.getTime() - parseInt(filterVal, 10) * 86400000);
    done = done.filter((t) => new Date(t.completedAt) >= cutoff);
  }

  done.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  if (done.length === 0) {
    historyEl.innerHTML = '<div class="profile-empty">No completed tasks match your filter 🔍</div>';
    return;
  }

  const groups = {};
  done.forEach((t) => {
    const key = t.completedAt.slice(0, 10);
    (groups[key] = groups[key] || []).push(t);
  });

  const ts = todayStr();
  const yest = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

  historyEl.innerHTML = "";
  Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach((dayKey) => {
    const items = groups[dayKey];
    let label = new Date(dayKey + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    if (dayKey === ts) label = "Today";
    else if (dayKey === yest) label = "Yesterday";

    const group = document.createElement("div");
    group.className = "day-group";

    const header = document.createElement("div");
    header.className = "day-header";
    header.innerHTML = `<span>${label}</span><span class="day-badge">${items.length} done</span>`;
    group.appendChild(header);

    items.forEach((t) => {
      const row = document.createElement("div");
      row.className = "history-item";
      row.style.setProperty("--c", t.color);
      const time = new Date(t.completedAt).toLocaleTimeString(undefined, {
        hour: "2-digit", minute: "2-digit",
      });
      row.innerHTML = `<span class="h-text">${escapeHtml(t.text)}</span><span class="h-time">${time}</span>`;
      group.appendChild(row);
    });

    historyEl.appendChild(group);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

profileSearch.addEventListener("input", renderHistory);
dayFilter.addEventListener("change", renderHistory);

/* ============================================================
   POMODORO TIMER
   ============================================================ */
const timerTime = document.getElementById("timer-time");
const timerLabel = document.getElementById("timer-label");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const modeBtns = document.querySelectorAll(".mode-btn");
const focusInput = document.getElementById("focus-minutes");
const breakInput = document.getElementById("break-minutes");
const applyBtn = document.getElementById("apply-settings");
const sessionsCount = document.getElementById("sessions-count");
const ringFg = document.querySelector(".ring-fg");

const RING_CIRCUMFERENCE = 2 * Math.PI * 108;

let mode = "focus";
let remainingSeconds = settings.focus * 60;
let intervalId = null;
let isRunning = false;
let sessionData = { date: "", count: 0 };

function modeDuration(m) { return (m === "focus" ? settings.focus : settings.break) * 60; }
function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
function updateRing() {
  const total = modeDuration(mode);
  const progress = total > 0 ? remainingSeconds / total : 0;
  ringFg.style.strokeDasharray = RING_CIRCUMFERENCE;
  ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
  ringFg.style.stroke = mode === "focus" ? "#6366f1" : "#22c55e";
}
function updateDisplay() {
  timerTime.textContent = formatTime(remainingSeconds);
  timerLabel.textContent = mode === "focus" ? "Focus time" : "Break time";
  document.title = `${formatTime(remainingSeconds)} — Work Hard`;
  updateRing();
}
function setMode(m) {
  mode = m;
  stopTimer();
  remainingSeconds = modeDuration(m);
  modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  updateDisplay();
}
function startTimer() {
  if (isRunning) return;
  isRunning = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  intervalId = setInterval(() => {
    remainingSeconds--;
    updateDisplay();
    if (remainingSeconds <= 0) finishSession();
  }, 1000);
}
function stopTimer() {
  clearInterval(intervalId);
  intervalId = null;
  isRunning = false;
  if (startBtn) startBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;
}
function resetTimer() {
  stopTimer();
  remainingSeconds = modeDuration(mode);
  updateDisplay();
}
async function finishSession() {
  stopTimer();
  notify();
  if (mode === "focus") {
    try {
      const rec = await store.incrementSession();
      sessionData = rec;
      sessionsCount.textContent = rec.count;
    } catch (e) { /* ignore */ }
    setMode("break");
  } else {
    setMode("focus");
  }
}
function notify() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.start();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) { /* ignore */ }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(mode === "focus" ? "Focus session done! 🎉" : "Break over 💪", {
      body: mode === "focus" ? "Take a break now" : "Let's get back to studying",
    });
  }
}

startBtn.addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  startTimer();
});
pauseBtn.addEventListener("click", stopTimer);
resetBtn.addEventListener("click", resetTimer);
modeBtns.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

applyBtn.addEventListener("click", async () => {
  const f = parseInt(focusInput.value, 10);
  const b = parseInt(breakInput.value, 10);
  if (!f || f < 1 || !b || b < 1) {
    alert("Please enter a valid duration (at least 1 minute)");
    return;
  }
  try {
    settings = await store.saveSettings(f, b);
    resetTimer();
    applyBtn.textContent = "Saved ✓";
    setTimeout(() => (applyBtn.textContent = "Save duration"), 1500);
  } catch (e) { alert(e.message); }
});
