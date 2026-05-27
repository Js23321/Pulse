const AI_CONFIG = {
  enabled: true,
  endpoint: "/api/ai",
  model: "gemini-2.5-flash-lite",
  personality: {
    identity: "You are Pulse AI, a thoughtful personal productivity coach inside the Pulse app.",
    tone: "Be warm, clear, calm, and practical. Sound encouraging without sounding cheesy.",
    behavior: [
      "Keep responses concise and actionable.",
      "Prefer the next best step over long theory.",
      "Notice momentum, patterns, and gentle accountability opportunities.",
      "When the user seems overwhelmed, simplify and reduce the plan.",
      "Use plain language and avoid sounding robotic."
    ],
  },
};

const FIREBASE_AUTH = {
  enabled: true,
  sdkVersion: "12.13.0",
  config: {
    apiKey: "AIzaSyAB8SwN4pZ1RKR9UQQ9aUqz74Ho1kjXefA",
    authDomain: "pulse-tracker-7daa3.firebaseapp.com",
    projectId: "pulse-tracker-7daa3",
    appId: "1:447121012295:web:b6ae257d587c69bfc46362",
  },
};

function fmtDate(d) {
  return d.toISOString().split("T")[0];
}

function fmtLongDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getNow() {
  return new Date();
}

function getTodayStr() {
  return fmtDate(getNow());
}

function getUserKey(name) {
  return String(name || "").trim().toLowerCase();
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validateShortName(value, fieldName = "Username") {
  const clean = String(value || "").trim();
  if (clean.length < 3) return `${fieldName} must be at least 3 characters.`;
  if (clean.length > 20) return `${fieldName} must be 20 characters or fewer.`;
  return "";
}

let currentUser = null;
let authMode = "in";
let curPage = "dashboard";
let habFilter = "all";
let goalFilter = "all";
let noteFilter = "all";
let noteSearch = "";
let aiOpen = false;
let aiLoading = false;
let aiPanelMode = "page";
let aiPanelMsgs = [
  {
    role: "assistant",
    text: "I am Pulse AI. I can help with the page you are looking at right now.",
  },
];
let aiPageMsgs = [
  {
    role: "assistant",
    text: "I am Pulse AI. I can help across your full Pulse data, including habits, goals, activity notes, and your notebook.",
  },
];
let lastDashboardRingOffset = null;
let firebaseClient = null;
let firebaseAuthReady = null;
let saveTimer = null;

const PAGE_TITLES = {
  dashboard: "Home",
  habits: "Habits",
  goals: "Goals",
  workout: "Workout",
  study: "Study",
  notes: "Notebook",
  ai: "Pulse AI",
};

const PAGE_META = {
  dashboard: "Your daily pulse",
  habits: "Build consistency day by day",
  goals: "Track measurable progress",
  workout: "Training, recovery, and strength goals",
  study: "Learning plans, deep work, and study notes",
  notes: "Notebook and activity notes",
  ai: "Whole-account assistant",
};

const CATS = [
  { id: "lifestyle", label: "Lifestyle", emoji: "🌿", color: "#0c9b6b" },
  { id: "coding", label: "Coding", emoji: "💻", color: "#4b6ef6" },
  { id: "workout", label: "Workout", emoji: "💪", color: "#c77a18" },
  { id: "study", label: "Study", emoji: "📚", color: "#2c6de0" },
  { id: "general", label: "General", emoji: "📌", color: "#707885" },
];

function cat(id) {
  return CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
}

function catColor(id) {
  return cat(id).color;
}

function defaultState() {
  return {
    habits: [],
    goals: [],
    notes: [],
    settings: {
      name: "",
      theme: "light",
    },
  };
}

let S = defaultState();

function migrateState(state) {
  const rawNotes = state.notes || [];
  const legacyNotebookBits = rawNotes
    .filter((note) => !note.kind || note.kind === "notebook")
    .map((note) => {
      const title = note.title ? `${note.title}\n` : "";
      return `${title}${note.content || ""}`.trim();
    })
    .filter(Boolean);

  const existingNotebook = rawNotes.find((note) => note.kind === "notebook_doc");
  const notebookDoc = existingNotebook || {
    id: "notebook-main",
    kind: "notebook_doc",
    title: "Notebook",
    content: legacyNotebookBits.join("\n\n"),
    category: "general",
    goalId: "",
    goalName: "",
    createdAt: Date.now(),
  };

  const notes = [
    notebookDoc,
    ...rawNotes
      .filter((note) => note.kind === "activity")
      .map((note) => ({
        id: note.id || "n" + Date.now() + Math.random().toString(36).slice(2, 6),
        kind: "activity",
        title: note.title || "",
        content: note.content || "",
        category: note.category || "general",
        goalId: note.goalId || "",
        goalName: note.goalName || "",
        createdAt: note.createdAt || Date.now(),
      })),
  ];

  return {
    habits: state.habits || [],
    goals: state.goals || [],
    notes,
    settings: {
      name: state.settings?.name || "",
      theme: state.settings?.theme || "light",
    },
  };
}

function save() {
  if (!currentUser) return;
  if (isFirebaseConfigured()) {
    queueRemoteSave();
    return;
  }
  saveUD(currentUser.uid, S);
}

function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_AUTH.enabled &&
    FIREBASE_AUTH.config?.apiKey &&
    FIREBASE_AUTH.config.apiKey !== "PASTE_FIREBASE_API_KEY_HERE" &&
    FIREBASE_AUTH.config?.authDomain &&
    FIREBASE_AUTH.config.authDomain !== "YOUR_PROJECT.firebaseapp.com" &&
    FIREBASE_AUTH.config?.projectId &&
    FIREBASE_AUTH.config.projectId !== "YOUR_PROJECT_ID" &&
    FIREBASE_AUTH.config?.appId &&
    FIREBASE_AUTH.config.appId !== "YOUR_APP_ID"
  );
}

function mapFirebaseUser(user) {
  return {
    uid: user.uid,
    username: user.email || "User",
    email: user.email || "",
  };
}

function clearPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function sanitizeStateForSave(state) {
  return JSON.parse(JSON.stringify(state));
}

async function ensureFirebase() {
  if (!isFirebaseConfigured()) return null;
  if (firebaseClient) return firebaseClient;

  const version = FIREBASE_AUTH.sdkVersion || "11.10.0";
  const [{ initializeApp }, authMod, firestoreMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
  ]);

  const app = initializeApp(FIREBASE_AUTH.config);
  firebaseClient = {
    app,
    auth: authMod.getAuth(app),
    db: firestoreMod.getFirestore(app),
    authApi: authMod,
    dbApi: firestoreMod,
  };
  return firebaseClient;
}

async function loadRemoteState(uid) {
  const fb = await ensureFirebase();
  if (!fb) return defaultState();
  const { doc, getDoc } = fb.dbApi;
  const snap = await getDoc(doc(fb.db, "pulseUsers", uid));
  if (!snap.exists()) return defaultState();
  return migrateState(snap.data()?.state || defaultState());
}

async function saveRemoteStateNow() {
  const fb = await ensureFirebase();
  if (!fb || !currentUser) return;
  const { doc, setDoc, serverTimestamp } = fb.dbApi;
  await setDoc(doc(fb.db, "pulseUsers", currentUser.uid), {
    email: currentUser.email || "",
    username: currentUser.username || "",
    state: sanitizeStateForSave(S),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function queueRemoteSave() {
  clearPendingSave();
  saveTimer = setTimeout(() => {
    saveRemoteStateNow().catch(() => {
      toast("Cloud sync failed");
    });
  }, 250);
}

function syncAuthUI() {
  const label = document.getElementById("authUserLabel");
  const input = document.getElementById("authUser");
  const foot = document.getElementById("authFoot");
  const firebaseMode = isFirebaseConfigured();
  if (label) label.textContent = firebaseMode ? "Email" : "Username";
  if (input) {
    input.placeholder = firebaseMode ? "name@example.com" : "username";
    input.autocomplete = firebaseMode ? "email" : "username";
  }
  if (foot) {
    foot.textContent = firebaseMode
      ? "Your account and progress sync through Firebase so you can sign in across devices."
      : "Accounts are stored on this device for now, so you can start using Pulse right away.";
  }
}

async function hashPw(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem("pulse_users") || "[]");
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem("pulse_users", JSON.stringify(users));
}

function getSession() {
  return localStorage.getItem("pulse_session");
}

function setSession(uid) {
  localStorage.setItem("pulse_session", uid);
}

function clearSession() {
  localStorage.removeItem("pulse_session");
}

function loadUD(uid) {
  try {
    return JSON.parse(localStorage.getItem("pulse_d_" + uid) || "null");
  } catch {
    return null;
  }
}

function saveUD(uid, data) {
  localStorage.setItem("pulse_d_" + uid, JSON.stringify(data));
}

async function doSignUp(username, pw) {
  if (isFirebaseConfigured()) {
    try {
      const fb = await ensureFirebase();
      const clean = username.trim();
      const cred = await fb.authApi.createUserWithEmailAndPassword(fb.auth, clean, pw);
      return { uid: cred.user.uid, username: cred.user.email || clean, email: cred.user.email || clean };
    } catch (error) {
      return { error: firebaseAuthError(error) };
    }
  }

  const users = getUsers();
  const clean = username.trim();
  const nameError = validateShortName(clean, "Username");
  if (nameError) return { error: nameError };
  const key = getUserKey(clean);
  if (users.find((u) => (u.usernameKey || getUserKey(u.username)) === key)) return { error: "Username already taken." };
  if (pw.length < 6) return { error: "Password must be at least 6 characters." };
  const hash = await hashPw(pw);
  const uid = "u_" + Date.now();
  users.push({ username: clean, usernameKey: key, hash, uid });
  saveUsers(users);
  setSession(uid);
  return { uid, username: clean };
}

async function doSignIn(username, pw) {
  if (isFirebaseConfigured()) {
    try {
      const fb = await ensureFirebase();
      const cred = await fb.authApi.signInWithEmailAndPassword(fb.auth, username.trim(), pw);
      return { uid: cred.user.uid, username: cred.user.email || username.trim(), email: cred.user.email || username.trim() };
    } catch (error) {
      return { error: firebaseAuthError(error) };
    }
  }

  const users = getUsers();
  const key = getUserKey(username);
  const user = users.find((u) => (u.usernameKey || getUserKey(u.username)) === key);
  if (!user) return { error: "No account found with that username." };
  const hash = await hashPw(pw);
  if (hash !== user.hash) return { error: "Incorrect password." };
  setSession(user.uid);
  return { uid: user.uid, username: user.username };
}

function firebaseAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "An account with that email already exists.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/missing-password":
      return "Please enter a password.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/network-request-failed":
      return "Could not reach Firebase. Check your connection and try again.";
    default:
      return error?.message || "Authentication failed.";
  }
}

function switchTab(mode) {
  authMode = mode;
  document.getElementById("tabIn").classList.toggle("active", mode === "in");
  document.getElementById("tabUp").classList.toggle("active", mode === "up");
  document.getElementById("authBtn").textContent = mode === "in" ? "Sign in" : "Create account";
  document.getElementById("authErr").classList.add("hidden");
}

function togglePassVis() {
  const input = document.getElementById("authPass");
  input.type = input.type === "password" ? "text" : "password";
}

function showAuthErr(msg) {
  const el = document.getElementById("authErr");
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function submitAuth() {
  const username = document.getElementById("authUser").value.trim();
  const pw = document.getElementById("authPass").value;
  const btn = document.getElementById("authBtn");

  if (!username) return showAuthErr(isFirebaseConfigured() ? "Please enter your email." : "Please enter a username.");
  if (!pw) return showAuthErr("Please enter a password.");

  btn.disabled = true;
  btn.textContent = "Please wait...";

  const result = authMode === "up" ? await doSignUp(username, pw) : await doSignIn(username, pw);
  if (result.error) {
    showAuthErr(result.error);
    btn.disabled = false;
    btn.textContent = authMode === "in" ? "Sign in" : "Create account";
    return;
  }

  if (!isFirebaseConfigured()) {
    currentUser = result;
    S = migrateState(loadUD(currentUser.uid) || defaultState());
    showApp();
  }
  btn.disabled = false;
  btn.textContent = authMode === "in" ? "Sign in" : "Create account";
}

function showAuth() {
  syncAuthUI();
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appWrap").classList.add("hidden");
  document.getElementById("mobNav").classList.add("hidden");
}

function showApp() {
  syncAuthUI();
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appWrap").classList.remove("hidden");
  document.getElementById("mobNav").classList.remove("hidden");
  applyTheme(S.settings.theme || "light");
  syncUserUI();
  nav("dashboard");
}

async function signOut() {
  clearPendingSave();
  if (isFirebaseConfigured()) {
    try {
      const fb = await ensureFirebase();
      await fb.authApi.signOut(fb.auth);
    } catch {
      toast("Could not sign out right now");
      return;
    }
  }
  clearSession();
  currentUser = null;
  S = defaultState();
  aiOpen = false;
  document.getElementById("aiPanel").classList.remove("open");
  document.getElementById("appWrap").classList.remove("ai-open");
  closeModal();
  showAuth();
}

function syncUserUI() {
  const uname = S.settings.name || currentUser?.username || "there";
  document.getElementById("sidebarName").textContent = uname;
  document.getElementById("userAvatar").textContent = uname[0].toUpperCase();
  updateTopbarMeta();
}

function updateTopbarMeta() {
  const el = document.getElementById("topbarDate");
  if (!el) return;
  const base = fmtLongDate(getNow());
  el.textContent = curPage === "dashboard" ? `${base} • ${PAGE_META.dashboard}` : PAGE_META[curPage] || base;
}

function habitStreak(habit) {
  let streak = 0;
  let d = getNow();
  while (streak < 365) {
    const key = fmtDate(d);
    if (habit.logs && habit.logs[key]) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (key === getTodayStr() && streak === 0) {
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function appStreak() {
  let streak = 0;
  let d = getNow();
  while (streak < 365) {
    const key = fmtDate(d);
    const done = S.habits.some((h) => h.logs && h.logs[key]);
    if (done) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (key === getTodayStr() && streak === 0) {
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function goalCur(goal) {
  return (goal.logs || []).reduce((sum, log) => sum + log.value, 0);
}

function activityNotes() {
  return S.notes
    .filter((note) => note.kind === "activity")
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getNotebookDoc() {
  let notebook = S.notes.find((note) => note.kind === "notebook_doc");
  if (!notebook) {
    notebook = {
      id: "notebook-main",
      kind: "notebook_doc",
      title: "Notebook",
      content: "",
      category: "general",
      goalId: "",
      goalName: "",
      createdAt: Date.now(),
    };
    S.notes.unshift(notebook);
  }
  return notebook;
}

function noteMatchesFilter(note) {
  if (noteFilter === "all") return true;
  if (noteFilter === "notebook") return note.kind === "notebook_doc";
  return note.kind === noteFilter;
}

function renderCurrentPage(animated = false) {
  const wrap = document.getElementById("pageContent");
  wrap.innerHTML = "";
  const el = document.createElement("div");
  el.className = `page${animated ? " page-anim" : ""}`;
  el.innerHTML = PAGES[curPage]();
  wrap.appendChild(el);
  const topbarBtn = document.getElementById("aiTopbarBtn");
  if (topbarBtn) topbarBtn.classList.toggle("hidden", curPage === "ai");
  if (curPage === "ai" && aiOpen) {
    aiOpen = false;
    document.getElementById("aiPanel").classList.remove("open");
    document.getElementById("appWrap").classList.remove("ai-open");
  }
  animateDashboardRing();
  if (curPage === "ai") renderAIPageMsgs();
}

function animateDashboardRing() {
  const ring = document.querySelector(".dashboard-ring-progress");
  if (!ring) return;
  const finalOffset = ring.dataset.offset;
  const total = ring.dataset.circ;
  ring.style.strokeDashoffset = lastDashboardRingOffset ?? total;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = finalOffset;
    });
  });
  lastDashboardRingOffset = finalOffset;
}

function nav(page) {
  curPage = page;
  document.querySelectorAll("[data-page]").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });
  document.getElementById("topbarTitle").textContent = PAGE_TITLES[page] || page;
  updateTopbarMeta();
  renderCurrentPage(true);
}

function rerenderPage() {
  renderCurrentPage(false);
}

function categoryWorkspacePage(categoryId) {
  const category = cat(categoryId);
  const habits = S.habits.filter((h) => h.category === categoryId);
  const goals = S.goals.filter((g) => g.category === categoryId);
  const activeGoals = goals.filter((g) => goalCur(g) < g.target);
  const completedGoals = goals.filter((g) => goalCur(g) >= g.target);
  const notes = activityNotes().filter((note) => note.category === categoryId);
  const doneToday = habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
  const totalTarget = activeGoals.reduce((sum, g) => sum + g.target, 0);
  const totalDone = activeGoals.reduce((sum, g) => sum + goalCur(g), 0);
  const goalPct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;
  const latestNote = notes[0];

  return `
    <div class="page-toolbar">
      <div class="page-toolbar-copy">
        <div class="section-title">${category.emoji} ${category.label} hub</div>
        <div class="section-sub">Keep your ${category.label.toLowerCase()} habits, goals, and activity in one focused space without bouncing between pages.</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="openAddHabit()">+ Add habit</button>
        <button class="btn btn-primary" onclick="openAddGoal()">+ Add goal</button>
      </div>
    </div>

    <div class="dash-stats" style="margin-top:0;margin-bottom:18px">
      <div class="dash-stat">
        <div class="dash-stat-kicker">Today's habits</div>
        <div class="dash-stat-line">
          <div class="dash-stat-val">${doneToday}/${habits.length}</div>
          <div class="dash-stat-text">${habits.length ? "checked off" : "none yet"}</div>
        </div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-kicker">Active goals</div>
        <div class="dash-stat-line">
          <div class="dash-stat-val">${activeGoals.length}</div>
          <div class="dash-stat-text">${goalPct}% momentum</div>
        </div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-kicker">Recent activity</div>
        <div class="dash-stat-line">
          <div class="dash-stat-val">${notes.length}</div>
          <div class="dash-stat-text">${latestNote ? "notes logged" : "nothing logged yet"}</div>
        </div>
      </div>
    </div>

    ${
      habits.length
        ? `
      <div class="page-section">
        <div class="sec-hd">
          <div class="sec-label">${category.label} habits</div>
          <button class="sec-action" onclick="nav('habits')">Open all habits</button>
        </div>
        ${habits.map((h) => habitRow(h, false)).join("")}
      </div>
    `
        : `
      <div class="empty" style="margin-bottom:18px">
        <div class="empty-icon">${category.emoji}</div>
        <div class="empty-title">No ${category.label.toLowerCase()} habits yet</div>
        <div class="empty-text">Add a small repeatable habit to make this page feel alive right away.</div>
      </div>
    `
    }

    ${
      activeGoals.length || completedGoals.length
        ? `
      <div class="page-section">
        <div class="sec-hd">
          <div class="sec-label">${category.label} goals</div>
          <button class="sec-action" onclick="nav('goals')">Open all goals</button>
        </div>
        ${activeGoals.length ? `<div class="grid2">${activeGoals.map((g) => goalCard(g)).join("")}</div>` : ""}
        ${completedGoals.length ? `
          <div class="page-section">
            <div class="sec-hd">
              <div class="sec-label">Completed</div>
            </div>
            <div class="grid2">${completedGoals.map((g) => goalCard(g)).join("")}</div>
          </div>
        ` : ""}
      </div>
    `
        : `
      <div class="empty" style="margin-bottom:18px">
        <div class="empty-icon">+</div>
        <div class="empty-title">No ${category.label.toLowerCase()} goals yet</div>
        <div class="empty-text">Create a measurable target here and this workspace will start telling a clearer story.</div>
      </div>
    `
    }

    <div class="page-section">
      <div class="sec-hd">
        <div class="sec-label">${category.label} activity</div>
        <button class="sec-action" onclick="nav('notes')">Open notes</button>
      </div>
      ${
        notes.length
          ? `<div class="notes-stack">${notes.slice(0, 6).map((n) => noteRow(n)).join("")}</div>`
          : `<div class="empty"><div class="empty-icon">✎</div><div class="empty-title">No ${category.label.toLowerCase()} activity yet</div><div class="empty-text">Complete a goal and add a quick note to build a useful history here.</div></div>`
      }
    </div>
  `;
}

const PAGES = {
  dashboard() {
    const doneToday = S.habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
    const total = S.habits.length;
    const pct = total ? Math.round((doneToday / total) * 100) : 0;
    const hr = getNow().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const name = S.settings.name || currentUser?.username || "there";
    const streak = appStreak();
    const activeGoals = S.goals.filter((g) => goalCur(g) < g.target);
    const notebook = getNotebookDoc();
    const totalGoalTarget = activeGoals.reduce((sum, g) => sum + g.target, 0);
    const totalGoalDone = activeGoals.reduce((sum, g) => sum + goalCur(g), 0);
    const goalPct = totalGoalTarget ? Math.round((totalGoalDone / totalGoalTarget) * 100) : 0;
    const nextHabit = S.habits.find((h) => !(h.logs && h.logs[getTodayStr()]));
    const latestNote = notebook.content.trim();
    const focusLabel = pct >= 80 ? "Strong rhythm today" : pct >= 40 ? "Solid momentum building" : "A fresh start still counts";

    const r = 28;
    const circ = 2 * Math.PI * r;
    const offset = circ - circ * (pct / 100);
    const ringColor = pct === 100 ? "#0c9b6b" : "#4b6ef6";

    return `
      <div class="dash-layout">
        <div class="dash-main">
          <div class="dash-panel">
            <div class="dash-greeting">
              <div class="dash-greeting-name">${esc(greet)}, ${esc(name)}</div>
              <div class="dash-greeting-date">${fmtLongDate(getNow())}</div>
            </div>

            <div class="dash-ring-row">
              <div class="ring-wrap">
                <svg width="84" height="84" viewBox="0 0 72 72" aria-hidden="true">
                  <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--border)" stroke-width="6"></circle>
                  <circle
                    class="dashboard-ring-progress"
                    data-offset="${offset.toFixed(2)}"
                    data-circ="${circ.toFixed(2)}"
                    cx="36"
                    cy="36"
                    r="${r}"
                    fill="none"
                    stroke="${ringColor}"
                    stroke-width="6"
                    stroke-linecap="round"
                    stroke-dasharray="${circ.toFixed(2)}"
                    stroke-dashoffset="${offset.toFixed(2)}"
                    transform="rotate(-90 36 36)"
                    style="transition:stroke-dashoffset .7s ease"
                  ></circle>
                </svg>
                <div class="ring-center">
                  <strong>${doneToday}/${total}</strong>
                  <span>habits</span>
                </div>
              </div>

              <div class="dash-ring-info">
                <div class="dash-ring-title">Today's progress</div>
                <div class="dash-ring-val">${pct}%</div>
                <div class="dash-ring-sub">${focusLabel}</div>
                <div class="dash-stats">
                  <div class="dash-stat">
                    <div class="dash-stat-kicker">Streak</div>
                    <div class="dash-stat-line">
                      <div class="dash-stat-val">${streak}</div>
                      <div class="dash-stat-text">days active</div>
                    </div>
                  </div>
                  <div class="dash-stat">
                    <div class="dash-stat-kicker">Goals</div>
                    <div class="dash-stat-line">
                      <div class="dash-stat-val">${activeGoals.length}</div>
                      <div class="dash-stat-text">${goalPct}% moving</div>
                    </div>
                  </div>
                  <div class="dash-stat">
                    <div class="dash-stat-kicker">Notebook</div>
                    <div class="dash-stat-line">
                      <div class="dash-stat-val">${notebook.content.trim() ? 1 : 0}</div>
                      <div class="dash-stat-text">notebook ready</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          ${
            S.habits.length
              ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Today's habits</div>
                <button class="sec-action" onclick="nav('habits')">Open habits</button>
              </div>
              ${S.habits.map((h) => habitRow(h, true)).join("")}
            </div>
          `
              : ""
          }

          ${
            activeGoals.length
              ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Goals in progress</div>
                <button class="sec-action" onclick="nav('goals')">Open goals</button>
              </div>
              <div class="grid2">${activeGoals.slice(0, 4).map((g) => goalCard(g)).join("")}</div>
            </div>
          `
              : ""
          }

          ${
            notebook.content.trim()
              ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Notebook preview</div>
                <button class="sec-action" onclick="nav('notes')">Open notebook</button>
              </div>
              ${noteRow(notebook)}
            </div>
          `
              : ""
          }

          ${
            !S.habits.length && !S.goals.length && !S.notes.length
              ? `
            <div class="empty">
              <div class="empty-icon">+</div>
              <div class="empty-title">Welcome to Pulse</div>
              <div class="empty-text">Start with one habit, one goal, or one notebook entry. Pulse will turn the rest into a calmer daily rhythm.</div>
            </div>
          `
              : ""
          }
        </div>

        <aside class="dash-side">
          <div class="dash-side-card">
            <div class="dash-side-title">Pulse AI</div>
            <div class="dash-side-copy">Best placement: top bar on desktop and bottom navigation on mobile. That keeps it close without repeating headers or crowding the page.</div>
            <div class="dash-side-list">
              <div class="dash-mini-row">
                <div>
                  <strong>${nextHabit ? esc(nextHabit.name) : "All habits complete"}</strong>
                  <span>${nextHabit ? "Next habit to check off today" : "You cleared your list for today"}</span>
                </div>
                <div class="dash-mini-dot" style="background:${nextHabit ? catColor(nextHabit.category) : "var(--success)"}"></div>
              </div>
              <div class="dash-mini-row">
                <div>
                  <strong>${activeGoals[0] ? esc(activeGoals[0].name) : "No active goals yet"}</strong>
                  <span>${activeGoals[0] ? `${Math.min(100, Math.round((goalCur(activeGoals[0]) / activeGoals[0].target) * 100))}% complete` : "Add a goal to track measurable progress"}</span>
                </div>
                <div class="dash-mini-dot" style="background:${activeGoals[0] ? catColor(activeGoals[0].category) : "var(--border-strong)"}"></div>
              </div>
            </div>
          </div>

          <div class="dash-side-card">
            <div class="dash-side-title">Today at a glance</div>
            <div class="dash-side-list">
              <div class="dash-mini-row">
                <div>
                  <strong>${doneToday} habits done</strong>
                  <span>${Math.max(total - doneToday, 0)} remaining today</span>
                </div>
              </div>
              <div class="dash-mini-row">
                <div>
                  <strong>${goalPct}% goal momentum</strong>
                  <span>${activeGoals.length ? `${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""}` : "No active goals right now"}</span>
                </div>
              </div>
              <div class="dash-mini-row">
                <div>
                  <strong>${latestNote ? "Notebook has content" : "No notebook content yet"}</strong>
                  <span>${latestNote ? esc(latestNote.slice(0, 72)) : "Use the notebook as your running scratchpad"}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    `;
  },

  habits() {
    const filtered = habFilter === "all" ? S.habits : S.habits.filter((h) => h.category === habFilter);
    return `
      <div class="page-toolbar">
        <button class="btn btn-primary" onclick="openAddHabit()">+ Add habit</button>
      </div>

      <div class="filter-pills">
        <div class="fpill ${habFilter === "all" ? "active" : ""}" onclick="setHabFilter('all')">All</div>
        ${CATS.map((c) => `<div class="fpill ${habFilter === c.id ? "active" : ""}" onclick="setHabFilter('${c.id}')">${c.emoji} ${c.label}</div>`).join("")}
      </div>

      ${
        filtered.length
          ? filtered.map((h) => habitRow(h, false)).join("")
          : `<div class="empty"><div class="empty-icon">○</div><div class="empty-title">No habits yet</div><div class="empty-text">Add your first habit to begin building a steadier routine.</div></div>`
      }
    `;
  },

  goals() {
    const filtered = goalFilter === "all" ? S.goals : S.goals.filter((g) => g.category === goalFilter);
    const active = filtered.filter((g) => goalCur(g) < g.target);
    const completed = filtered.filter((g) => goalCur(g) >= g.target);

    return `
      <div class="page-toolbar">
        <button class="btn btn-primary" onclick="openAddGoal()">+ Add goal</button>
      </div>

      <div class="filter-pills">
        <div class="fpill ${goalFilter === "all" ? "active" : ""}" onclick="setGoalFilter('all')">All</div>
        ${CATS.map((c) => `<div class="fpill ${goalFilter === c.id ? "active" : ""}" onclick="setGoalFilter('${c.id}')">${c.emoji} ${c.label}</div>`).join("")}
      </div>

      ${
        !active.length && !completed.length
          ? `<div class="empty"><div class="empty-icon">◎</div><div class="empty-title">No goals yet</div><div class="empty-text">Set one measurable target and Pulse will help you keep it moving.</div></div>`
          : ""
      }

      ${active.length ? `<div class="grid2">${active.map((g) => goalCard(g)).join("")}</div>` : ""}

      ${
        completed.length
          ? `
        <div class="page-section">
          <div class="sec-hd">
            <div class="sec-label">Completed</div>
          </div>
          <div class="grid2">${completed.map((g) => goalCard(g)).join("")}</div>
        </div>
      `
          : ""
      }
    `;
  },

  workout() {
    return categoryWorkspacePage("workout");
  },

  study() {
    return categoryWorkspacePage("study");
  },

  notes() {
    let visible = [...S.notes].filter(noteMatchesFilter);
    if (noteSearch) {
      const q = noteSearch.toLowerCase();
      visible = visible.filter((n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.content || "").toLowerCase().includes(q) ||
        (n.goalName || "").toLowerCase().includes(q)
      );
    }
    visible.sort((a, b) => b.createdAt - a.createdAt);

    const notebook = getNotebookDoc();
    const notebookCount = notebook.content.trim() ? 1 : 0;
    const activityCount = activityNotes().length;

    return `
      <div class="notebook-composer surface-card">
        <div class="notebook-composer-title">Notebook</div>
        <div class="notebook-composer-sub">This stays as one continuous note. Edit it, close the app, come back another day, and keep writing in the same place.</div>
        <div class="form-group" style="margin-bottom:0">
          <textarea id="notebookBody" class="form-input notebook-body" placeholder="Start writing in your notebook...">${esc(notebook.content || "")}</textarea>
        </div>
        <div class="composer-actions">
          <button class="btn btn-primary" onclick="saveNotebook()">Save notebook</button>
        </div>
      </div>

      <div class="search-wrap">
        <svg class="search-ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="9" r="7"></circle><path d="m16 16-3.5-3.5"></path></svg>
        <input class="search-input" type="text" placeholder="Search notebook and activity notes..." value="${esc(noteSearch)}" oninput="noteSearch=this.value;rerenderPage()">
      </div>

      <div class="filter-pills">
        <div class="fpill ${noteFilter === "all" ? "active" : ""}" onclick="setNoteFilter('all')">All</div>
        <div class="fpill ${noteFilter === "notebook" ? "active" : ""}" onclick="setNoteFilter('notebook')">Notebook ${notebookCount}</div>
        <div class="fpill ${noteFilter === "activity" ? "active" : ""}" onclick="setNoteFilter('activity')">Activity ${activityCount}</div>
      </div>

      ${
        visible.length
          ? `<div class="notes-stack">${visible.map((n) => noteRow(n)).join("")}</div>`
          : `<div class="empty"><div class="empty-icon">✎</div><div class="empty-title">${noteSearch ? "No notes found" : "No notes yet"}</div><div class="empty-text">${noteSearch ? "Try a different phrase." : "Start with a notebook entry or complete a goal and add an activity note."}</div></div>`
      }
    `;
  },

  ai() {
    return `
      <div class="ai-page surface-card">
        <div id="aiPageMessages" class="ai-page-messages"></div>
        <div class="ai-page-input">
          <input id="aiPageInput" class="ai-input" type="text" placeholder="Ask about your full progress..." onkeydown="if(event.key==='Enter')sendAIPage()">
          <button class="ai-send" onclick="sendAIPage()">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
          </button>
        </div>
      </div>
    `;
  },
};

function habitRow(habit, dashMode) {
  const done = habit.logs && habit.logs[getTodayStr()];
  const streak = habitStreak(habit);
  const c = cat(habit.category);
  return `
    <div class="habit-item ${done ? "done" : ""}">
      <div
        class="hcheck ${done ? "checked" : ""}"
        style="${done ? `background:${c.color};border-color:${c.color}` : ""}"
        onclick="toggleHabit('${habit.id}')"
        title="${done ? "Mark undone" : "Mark done"}"
      >
        ${done ? "✓" : ""}
      </div>
      <div class="habit-emoji">${habit.icon}</div>
      <div class="habit-info">
        <div class="habit-name">${esc(habit.name)}</div>
        <div class="habit-meta">
          <span class="badge badge-${habit.category}">${c.emoji} ${c.label}</span>
          ${streak > 0 ? `<span class="streak-chip">${streak} day streak</span>` : ""}
        </div>
      </div>
      ${!dashMode ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="deleteHabit('${habit.id}')" title="Delete">×</button>` : ""}
    </div>
  `;
}

function renderEmojiPicker(inputId, emojis) {
  return `
    <div class="emoji-picker">
      ${emojis.map((emoji) => `<button class="emoji-chip" type="button" onclick="pickEmoji('${inputId}','${emoji}')">${emoji}</button>`).join("")}
    </div>
  `;
}

function pickEmoji(inputId, emoji) {
  const input = document.getElementById(inputId);
  if (input) input.value = emoji;
}

function goalCard(goal) {
  const cur = goalCur(goal);
  const pct = Math.min(100, Math.round((cur / goal.target) * 100));
  const c = cat(goal.category);
  const done = cur >= goal.target;
  return `
    <div class="goal-card ${done ? "done-card" : ""}">
      <div class="goal-top">
        <div style="min-width:0">
          <div class="goal-emoji">${goal.icon}</div>
          <div class="goal-name">${esc(goal.name)}</div>
          <div class="goal-prog-txt">${cur} / ${goal.target} ${esc(goal.unit)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="goal-pct">${pct}%</div>
          <span class="badge badge-${goal.category}" style="margin-top:6px">${c.emoji}</span>
        </div>
      </div>
      <div class="prog-track" style="margin-top:14px"><div class="prog-fill" style="width:${pct}%;background:${c.color}"></div></div>
      <div class="goal-actions">
        ${done ? `<span class="goal-complete">Completed</span>` : `<button class="btn btn-sm btn-outline" onclick="openLogGoal('${goal.id}')">+ Log</button>`}
        <button class="btn btn-ghost btn-icon btn-sm" onclick="openGoalDetail('${goal.id}')" title="History" style="margin-left:auto">i</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteGoal('${goal.id}')" title="Delete">×</button>
      </div>
    </div>
  `;
}

function noteRow(note) {
  if (note.kind === "activity") {
    const c = cat(note.category);
    return `
      <div class="activity-note-card" onclick="openEditNote('${note.id}')">
        <div class="activity-note-top">
          <span class="badge badge-${note.category}">${c.emoji} Activity</span>
          <span class="note-date">${fmtShortDate(note.createdAt)}</span>
        </div>
        <div class="activity-note-title">${esc(note.goalName || note.title || "Goal activity")}</div>
        <div class="note-preview">${esc(note.content || "")}</div>
      </div>
    `;
  }

  return `
    <div class="note-item notebook-entry" onclick="openEditNote('${note.id}')">
      <div class="note-title">Notebook</div>
      <div class="note-preview">${esc((note.content || "").slice(0, 220))}</div>
      <div class="note-footer">
        <span class="note-date">${note.content ? "Tap to continue writing" : "Start your notebook"}</span>
        <span class="badge badge-general">Notebook</span>
      </div>
    </div>
  `;
}

function setHabFilter(filter) {
  habFilter = filter;
  rerenderPage();
}

function toggleHabit(id) {
  const habit = S.habits.find((h) => h.id === id);
  if (!habit) return;
  if (!habit.logs) habit.logs = {};
  const today = getTodayStr();
  if (habit.logs[today]) {
    delete habit.logs[today];
    toast("Unchecked");
  } else {
    habit.logs[today] = true;
    toast("Habit done");
  }
  save();
  rerenderPage();
}

function openAddHabit() {
  const options = ["🏃", "💧", "📚", "🧘", "🥗", "😴", "📝", "🚶", "🧠", "☀️"];
  modal(`
    <div class="modal-title">Add habit</div>
    <div class="form-group"><label class="form-label">Name</label><input id="hName" class="form-input" placeholder="Morning run, Read 30 mins" autofocus></div>
    <div class="form-group"><label class="form-label">Category</label>
      <select id="hCat" class="form-input">${CATS.map((c) => `<option value="${c.id}">${c.emoji} ${c.label}</option>`).join("")}</select>
    </div>
    <div class="form-group"><label class="form-label">Icon</label><input id="hIcon" class="form-input" placeholder="🏃" style="font-size:20px;width:84px">${renderEmojiPicker("hIcon", options)}</div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveHabit()">Add habit</button>
    </div>
  `);
}

function saveHabit() {
  const name = document.getElementById("hName").value.trim();
  const category = document.getElementById("hCat").value;
  const icon = document.getElementById("hIcon").value.trim() || cat(category).emoji;
  if (!name) return toast("Enter a habit name");
  S.habits.push({ id: "h" + Date.now(), name, category, icon, logs: {}, createdAt: Date.now() });
  save();
  closeModal();
  rerenderPage();
  toast("Habit added");
}

function deleteHabit(id) {
  if (!confirm("Delete this habit and its history?")) return;
  S.habits = S.habits.filter((h) => h.id !== id);
  save();
  rerenderPage();
  toast("Deleted");
}

function setGoalFilter(filter) {
  goalFilter = filter;
  rerenderPage();
}

function openAddGoal() {
  const options = ["🎯", "💻", "📘", "🏋️", "🧪", "🏁", "📈", "🪴", "🧩", "🔥"];
  modal(`
    <div class="modal-title">Add goal</div>
    <div class="form-group"><label class="form-label">Goal name</label><input id="gName" class="form-input" placeholder="Finish React course, 100 pushups" autofocus></div>
    <div class="form-group"><label class="form-label">Category</label>
      <select id="gCat" class="form-input">${CATS.map((c) => `<option value="${c.id}">${c.emoji} ${c.label}</option>`).join("")}</select>
    </div>
    <div class="form-group"><label class="form-label">Icon</label><input id="gIcon" class="form-input" placeholder="🎯" style="font-size:20px;width:84px">${renderEmojiPicker("gIcon", options)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Target</label><input id="gTarget" class="form-input" type="number" placeholder="100" min="1" step="any"></div>
      <div class="form-group"><label class="form-label">Unit</label><input id="gUnit" class="form-input" placeholder="reps, hours, pages"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveGoal()">Add goal</button>
    </div>
  `);
}

function saveGoal() {
  const name = document.getElementById("gName").value.trim();
  const category = document.getElementById("gCat").value;
  const icon = document.getElementById("gIcon").value.trim() || cat(category).emoji;
  const target = parseFloat(document.getElementById("gTarget").value);
  const unit = document.getElementById("gUnit").value.trim() || "units";
  if (!name) return toast("Enter a goal name");
  if (!target || target <= 0) return toast("Enter a valid target");
  S.goals.push({ id: "g" + Date.now(), name, category, icon, target, unit, logs: [], createdAt: Date.now() });
  save();
  closeModal();
  rerenderPage();
  toast("Goal added");
}

function openLogGoal(id) {
  const goal = S.goals.find((g) => g.id === id);
  if (!goal) return;
  const cur = goalCur(goal);
  const pct = Math.min(100, Math.round((cur / goal.target) * 100));
  modal(`
    <div class="modal-title">${goal.icon} Log progress</div>
    <div class="info-box">
      <div class="info-box-sub">${esc(goal.name)}</div>
      <div class="info-box-val">${cur} <span style="font-size:14px;font-weight:600;color:var(--text2)">/ ${goal.target} ${esc(goal.unit)}</span></div>
      <div class="prog-track" style="margin-top:10px"><div class="prog-fill" style="width:${pct}%;background:${catColor(goal.category)}"></div></div>
      <div style="font-size:12px;color:var(--text3);margin-top:7px">${Math.max(0, goal.target - cur)} ${esc(goal.unit)} remaining</div>
    </div>
    <div class="form-group">
      <label class="form-label">How much did you complete? (${esc(goal.unit)})</label>
      <div class="num-row">
        <button class="num-btn" onclick="adjLog(-1)">-</button>
        <input id="logVal" class="form-input" type="number" value="1" min="0.1" step="any">
        <button class="num-btn" onclick="adjLog(1)">+</button>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Completion note (optional)</label><input id="logNote" class="form-input" placeholder="Only used as an activity note if this goal gets completed"></div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitLog('${id}')">Log it</button>
    </div>
  `);
}

function adjLog(delta) {
  const input = document.getElementById("logVal");
  input.value = Math.max(0.1, (parseFloat(input.value) || 0) + delta);
}

function submitLog(id) {
  const goal = S.goals.find((g) => g.id === id);
  if (!goal) return;
  const before = goalCur(goal);
  const value = parseFloat(document.getElementById("logVal").value);
  const note = document.getElementById("logNote").value.trim();
  if (!value || value <= 0) return toast("Enter a valid amount");
  if (!goal.logs) goal.logs = [];
  goal.logs.push({ date: getTodayStr(), value, note });
  const after = goalCur(goal);
  const justCompleted = before < goal.target && after >= goal.target;
  save();
  closeModal();
  if (justCompleted) {
    if (note) {
      addActivityNote(goal, note);
      rerenderPage();
      toast("Goal completed");
    } else {
      openCompletionNote(goal.id);
    }
    return;
  }
  rerenderPage();
  toast(`Logged ${value} ${goal.unit}`);
}

function openCompletionNote(goalId) {
  const goal = S.goals.find((g) => g.id === goalId);
  if (!goal) return;
  modal(`
    <div class="modal-title">Goal completed</div>
    <div class="form-group">
      <label class="form-label">Activity note</label>
      <textarea id="completionNoteBody" class="form-input" placeholder="Write a quick reflection about completing ${esc(goal.name)}"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="skipCompletionNote()">Skip</button>
      <button class="btn btn-primary" onclick="saveCompletionNote('${goal.id}')">Save note</button>
    </div>
  `);
}

function skipCompletionNote() {
  closeModal();
  rerenderPage();
  toast("Goal completed");
}

function saveCompletionNote(goalId) {
  const goal = S.goals.find((g) => g.id === goalId);
  if (!goal) return;
  const body = document.getElementById("completionNoteBody").value.trim();
  if (body) addActivityNote(goal, body);
  save();
  closeModal();
  rerenderPage();
  toast("Goal completed");
}

function addActivityNote(goal, content) {
  S.notes.unshift({
    id: "n" + Date.now(),
    kind: "activity",
    title: "",
    content,
    category: goal.category,
    goalId: goal.id,
    goalName: goal.name,
    createdAt: Date.now(),
  });
  save();
}

function openGoalDetail(id) {
  const goal = S.goals.find((g) => g.id === id);
  if (!goal) return;
  const cur = goalCur(goal);
  const logs = [...(goal.logs || [])].reverse();
  const pct = Math.min(100, Math.round((cur / goal.target) * 100));
  modal(`
    <div class="modal-title">${goal.icon} ${esc(goal.name)}</div>
    <div class="info-box" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <div class="info-box-sub">Total progress</div>
        <div class="info-box-val">${cur} <span style="font-size:13px;font-weight:600;color:var(--text2)">/ ${goal.target} ${esc(goal.unit)}</span></div>
      </div>
      <div style="font-size:24px;font-weight:800;color:${catColor(goal.category)}">${pct}%</div>
    </div>
    <div class="form-label" style="margin-bottom:8px">History</div>
    ${
      logs.length
        ? logs.map((log) => `
          <div class="log-row">
            <span class="log-date">${log.date}</span>
            ${log.note ? `<span class="log-note">${esc(log.note)}</span>` : "<span></span>"}
            <span class="log-val">+${log.value} ${esc(goal.unit)}</span>
          </div>
        `).join("")
        : `<p style="font-size:13px;color:var(--text3);padding:8px 0">No logs yet.</p>`
    }
    <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
  `);
}

function deleteGoal(id) {
  if (!confirm("Delete this goal?")) return;
  S.goals = S.goals.filter((g) => g.id !== id);
  save();
  rerenderPage();
  toast("Deleted");
}

function setNoteFilter(filter) {
  noteFilter = filter;
  rerenderPage();
}

function saveNotebook() {
  const bodyEl = document.getElementById("notebookBody");
  if (!bodyEl) return;
  const notebook = getNotebookDoc();
  notebook.content = bodyEl.value;
  save();
  rerenderPage();
  toast("Notebook saved");
}

function openEditNote(id) {
  const note = S.notes.find((n) => n.id === id);
  if (!note) return;
  if (note.kind === "notebook_doc") {
    nav("notes");
    return;
  }
  modal(`
    <div class="modal-title">${note.kind === "activity" ? "Edit activity note" : "Edit notebook entry"}</div>
    ${
      note.kind === "activity"
        ? `<div class="info-box" style="margin-bottom:16px">
            <div class="info-box-sub">Completed goal</div>
            <div class="info-box-val" style="font-size:18px">${esc(note.goalName || "Goal activity")}</div>
          </div>`
        : `<div class="form-group"><label class="form-label">Title</label><input id="nTitle" class="form-input" value="${esc(note.title || "")}" autofocus></div>`
    }
    <div class="form-group"><label class="form-label">Content</label><textarea id="nBody" class="form-input">${esc(note.content || "")}</textarea></div>
    <div class="modal-footer">
      <button class="btn btn-danger btn-sm" onclick="deleteNote('${id}')" style="margin-right:auto">Delete</button>
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateNote('${id}')">Save</button>
    </div>
  `);
}

function updateNote(id) {
  const note = S.notes.find((n) => n.id === id);
  if (!note) return;
  const content = document.getElementById("nBody").value.trim();
  if (!content) return toast("Write something first");
  if (note.kind === "notebook_doc") {
    note.title = document.getElementById("nTitle").value.trim();
  }
  note.content = content;
  save();
  closeModal();
  rerenderPage();
  toast("Note updated");
}

function deleteNote(id) {
  if (!confirm("Delete this note?")) return;
  S.notes = S.notes.filter((n) => n.id !== id);
  save();
  closeModal();
  rerenderPage();
  toast("Deleted");
}

function openSettings() {
  modal(`
    <div class="modal-title">Account & settings</div>
    <div class="form-group"><label class="form-label">Display name</label><input id="sName" class="form-input" value="${esc(S.settings.name || "")}" placeholder="${esc(currentUser?.username || "")}" maxlength="20" autofocus></div>
    <div class="divider"></div>
    <div class="form-label" style="margin-bottom:10px">Theme</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-outline btn-sm" onclick="applyTheme('light')">Light</button>
      <button class="btn btn-outline btn-sm" onclick="applyTheme('dark')">Dark</button>
    </div>
    <div class="divider"></div>
    <div class="form-label" style="margin-bottom:10px;color:var(--text3)">Account</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-danger btn-sm" onclick="clearAllData()">Clear all data</button>
      <button class="btn btn-outline btn-sm" onclick="signOut()">Sign out</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSettings()">Save</button>
    </div>
  `);
}

function saveSettings() {
  const value = document.getElementById("sName").value.trim();
  if (value) {
    const err = validateShortName(value, "Display name");
    if (err) return toast(err);
  }
  S.settings.name = value;
  save();
  closeModal();
  syncUserUI();
  rerenderPage();
  toast("Settings saved");
}

function clearAllData() {
  if (!confirm("Delete all your habits, goals, and notes? This cannot be undone.")) return;
  S = { ...defaultState(), settings: { ...S.settings } };
  save();
  closeModal();
  nav("dashboard");
  toast("Data cleared");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const sunPath = "M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z";
  const moonPath = "M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z";
  const themeIcon = document.getElementById("themeIcon");
  if (themeIcon) themeIcon.setAttribute("d", theme === "dark" ? sunPath : moonPath);
  S.settings.theme = theme;
  if (currentUser) save();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  applyTheme(isDark ? "light" : "dark");
}

function toggleAI() {
  aiOpen = !aiOpen;
  document.getElementById("aiPanel").classList.toggle("open", aiOpen);
  document.getElementById("appWrap").classList.toggle("ai-open", aiOpen);
  if (aiOpen) renderAIPanelMsgs();
}

function openPageAI() {
  if (curPage === "ai") return;
  aiPanelMode = "page";
  toggleAI();
}

function getAIConfig() {
  if (!AI_CONFIG.enabled) return null;
  if (location.protocol === "file:") return null;
  return AI_CONFIG;
}

function buildAISystemPrompt(scope) {
  const config = getAIConfig();
  const personality = config?.personality || {};
  const rules = Array.isArray(personality.behavior) ? personality.behavior.map((rule) => `- ${rule}`).join("\n") : "";
  return [
    personality.identity || "You are Pulse AI.",
    personality.tone || "Be helpful and practical.",
    rules ? `Behavior rules:\n${rules}` : "",
    `Current context: ${getAIContext(scope)}`,
  ].filter(Boolean).join("\n\n");
}

function getAIContext(scope = "global") {
  const doneToday = S.habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
  const streak = appStreak();
  const goals = S.goals.map((g) => `${g.name}: ${Math.round((goalCur(g) / g.target) * 100)}%`).join(", ") || "none";
  const habits = S.habits.map((h) => h.name).join(", ") || "none";
  const notebook = getNotebookDoc().content.slice(0, 180) || "none";
  if (scope === "page") {
    if (curPage === "habits") return `Current page: Habits. User: ${currentUser?.username}. Today: ${doneToday}/${S.habits.length} habits done. Habits: ${habits}.`;
    if (curPage === "goals") return `Current page: Goals. User: ${currentUser?.username}. Goals: ${goals}.`;
    if (curPage === "workout") return `Current page: Workout. User: ${currentUser?.username}. Workout habits: ${S.habits.filter((h) => h.category === "workout").map((h) => h.name).join(", ") || "none"}. Workout goals: ${S.goals.filter((g) => g.category === "workout").map((g) => `${g.name}: ${Math.round((goalCur(g) / g.target) * 100)}%`).join(", ") || "none"}.`;
    if (curPage === "study") return `Current page: Study. User: ${currentUser?.username}. Study habits: ${S.habits.filter((h) => h.category === "study").map((h) => h.name).join(", ") || "none"}. Study goals: ${S.goals.filter((g) => g.category === "study").map((g) => `${g.name}: ${Math.round((goalCur(g) / g.target) * 100)}%`).join(", ") || "none"}.`;
    if (curPage === "notes") return `Current page: Notebook. User: ${currentUser?.username}. Notebook: ${notebook}. Activity notes: ${activityNotes().length}.`;
    if (curPage === "dashboard") return `Current page: Dashboard. User: ${currentUser?.username}. Today: ${doneToday}/${S.habits.length} habits done. Streak: ${streak}. Goals: ${goals}. Notebook: ${notebook}.`;
  }
  return `User: ${currentUser?.username}. Today: ${doneToday}/${S.habits.length} habits done. Streak: ${streak} days. Habits: ${habits}. Goals: ${goals}. Notebook: ${notebook}. Activity notes: ${activityNotes().length}.`;
}

function renderAIPanelMsgs() {
  const wrap = document.getElementById("aiMessages");
  if (!wrap) return;
  wrap.innerHTML = "";
  const source = aiPanelMsgs;
  const introTitle = document.querySelector(".ai-intro-title");
  const introText = document.querySelector(".ai-intro-text");
  if (introTitle) introTitle.textContent = "Current page help";
  if (introText) introText.textContent = `Ask about the ${PAGE_TITLES[curPage] || "current"} page and Pulse AI will focus on what is visible here while still understanding your data.`;

  source.forEach((msg) => {
    const div = document.createElement("div");
    div.className = `ai-msg ${msg.role}`;
    div.textContent = msg.text;
    wrap.appendChild(div);
  });

  if (aiLoading) {
    const typing = document.createElement("div");
    typing.className = "ai-typing";
    typing.innerHTML = '<div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div>';
    wrap.appendChild(typing);
  }

  if (!getAIConfig() && !aiLoading) {
    const hint = document.createElement("div");
    hint.className = "ai-no-key";
    hint.innerHTML = 'Pulse AI needs the Vercel backend route. Add <b>GEMINI_API_KEY</b> in Vercel and open the app from localhost or your deployed site.';
    wrap.appendChild(hint);
  }

  wrap.scrollTop = wrap.scrollHeight;
}

function renderAIPageMsgs() {
  const wrap = document.getElementById("aiPageMessages");
  if (!wrap) return;
  wrap.innerHTML = "";

  aiPageMsgs.forEach((msg) => {
    const div = document.createElement("div");
    div.className = `ai-msg ${msg.role}`;
    div.textContent = msg.text;
    wrap.appendChild(div);
  });

  if (aiLoading && curPage === "ai") {
    const typing = document.createElement("div");
    typing.className = "ai-typing";
    typing.innerHTML = '<div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div>';
    wrap.appendChild(typing);
  }

  if (!getAIConfig() && !aiLoading) {
    const hint = document.createElement("div");
    hint.className = "ai-no-key";
    hint.innerHTML = 'Pulse AI needs the Vercel backend route. Add <b>GEMINI_API_KEY</b> in Vercel and open the app from localhost or your deployed site.';
    wrap.appendChild(hint);
  }

  wrap.scrollTop = wrap.scrollHeight;
}

async function callPulseAI(config, payload) {
  const resp = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("AI request failed");
  const data = await resp.json();
  return data.reply || "Sorry, something went wrong.";
}

async function runAIExchange({ inputId, scope, store, render }) {
  const input = document.getElementById(inputId);
  const text = input?.value.trim();
  if (!text || aiLoading) return;

  const config = getAIConfig();
  store.push({ role: "user", text });
  input.value = "";
  aiLoading = true;
  render();

  if (!config) {
    aiLoading = false;
    render();
    return;
  }

  const messages = [
    {
      role: "system",
      content: buildAISystemPrompt(scope),
    },
    ...store.slice(-8).map((m) => ({ role: m.role, content: m.text })),
  ];

  try {
    const reply = await callPulseAI(config, {
      model: config.model,
      messages,
    });
    store.push({ role: "assistant", text: reply });
  } catch {
    store.push({ role: "assistant", text: "Could not reach Pulse AI right now." });
  }

  aiLoading = false;
  render();
}

async function sendAI() {
  await runAIExchange({
    inputId: "aiInput",
    scope: "page",
    store: aiPanelMsgs,
    render: renderAIPanelMsgs,
  });
}

async function sendAIPage() {
  await runAIExchange({
    inputId: "aiPageInput",
    scope: "global",
    store: aiPageMsgs,
    render: renderAIPageMsgs,
  });
}

function modal(html) {
  document.getElementById("modalWrap").innerHTML = `
    <div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" onclick="event.stopPropagation()">${html}</div>
    </div>
  `;
}

function closeModal() {
  document.getElementById("modalWrap").innerHTML = "";
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function initFirebaseAuth() {
  let fb = null;
  try {
    fb = await ensureFirebase();
  } catch {
    return false;
  }
  if (!fb) return false;

  firebaseAuthReady = new Promise((resolve) => {
    let firstPass = true;
    fb.authApi.onAuthStateChanged(fb.auth, async (user) => {
      clearPendingSave();
      if (user) {
        currentUser = mapFirebaseUser(user);
        S = await loadRemoteState(user.uid);
        showApp();
      } else {
        currentUser = null;
        S = defaultState();
        aiOpen = false;
        document.getElementById("aiPanel").classList.remove("open");
        document.getElementById("appWrap").classList.remove("ai-open");
        closeModal();
        showAuth();
      }

      if (firstPass) {
        firstPass = false;
        resolve();
      }
    });
  });

  await firebaseAuthReady;
  return true;
}

async function init() {
  syncAuthUI();
  if (await initFirebaseAuth()) return;

  const uid = getSession();
  if (uid) {
    const users = getUsers();
    const user = users.find((u) => u.uid === uid);
    if (user) {
      currentUser = user;
      S = migrateState(loadUD(uid) || defaultState());
      showApp();
      return;
    }
  }
  showAuth();
}

init();
