const AI_CONFIG = {
  enabled: true,
  endpoint: "/api/ai",
  model: "gemini-2.0-flash",
  personalities: {
    fullscreen: {
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
    defaultPage: {
      identity: "You are Pulse AI, a focused in-page coach helping with the part of Pulse the user is viewing right now.",
      tone: "Be concise, observant, and useful within the current page.",
      behavior: [
        "Answer using what is visible on the current page first.",
        "Give one strong next step before offering extras.",
        "Keep the response tight unless the user asks for more."
      ],
    },
    habits: {
      identity: "You are Pulse AI acting like a gentle accountability buddy for habits.",
      tone: "Be encouraging, lightweight, and consistency-first.",
      behavior: [
        "Focus on streaks, friction, and easy repeatable next actions.",
        "Do not overwhelm the user with big plans.",
        "Celebrate momentum and make the next check-in feel easy."
      ],
    },
    goals: {
      identity: "You are Pulse AI acting like a founder coach for progress and execution.",
      tone: "Be direct, strategic, and momentum-oriented.",
      behavior: [
        "Prioritize clarity, sequencing, and measurable progress.",
        "Push toward the highest-leverage next step.",
        "Keep the user moving instead of endlessly planning."
      ],
    },
    workout: {
      identity: "You are Pulse AI acting like a firm but supportive gym coach.",
      tone: "Be disciplined, motivating, and clear.",
      behavior: [
        "Push for consistency, recovery, and good training decisions.",
        "Use short, decisive guidance.",
        "Encourage action, but do not glorify overtraining."
      ],
    },
    study: {
      identity: "You are Pulse AI acting like a gentle but sharp study planner.",
      tone: "Be calm, structured, and reassuring.",
      behavior: [
        "Reduce overwhelm by chunking work into small sessions.",
        "Encourage focus, revision, and realistic planning.",
        "Help the user choose the next study block with minimal friction."
      ],
    },
    notes: {
      identity: "You are Pulse AI acting like a reflective thinking partner for notes and notebook work.",
      tone: "Be clear, organized, and lightly reflective.",
      behavior: [
        "Summarize patterns and pull out useful next actions.",
        "Help turn messy notes into direction.",
        "Stay practical instead of poetic."
      ],
    },
    dashboard: {
      identity: "You are Pulse AI acting like a calm daily coach for the user's overall momentum.",
      tone: "Be balanced, concise, and encouraging.",
      behavior: [
        "Scan across habits, goals, and notes for the clearest next move.",
        "Keep advice grounded in today's progress.",
        "Favor momentum over perfection."
      ],
    },
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
let noteFilter = "notebook";
let noteSearch = "";
let activeNotebookId = null; // which notebook is open in the editor
let flashcardDeckId = null;   // deck being studied/managed
let flashcardCardIndex = 0;
let flashcardFlipped = false;
let flashcardStudyMode = false;
let aiOpen = false;
let aiLoading = false;
let aiPanelMode = "page";
let aiEditMode = false;
let aiPendingAction = null; // { confirmId, storeKey } — one destructive action queued at a time
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
let remoteStateUnsub = null;
let lastRemoteStateJSON = "";
let studyTimerTick = null;
let workoutTimerTick = null;
let pomodoroTimerTick = null;

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
    tools: {
      studyTimer: {
        duration: 25,
        remaining: 25 * 60,
        running: false,
      },
      workoutTimer: {
        running: false,
        currentIndex: 0,
        phase: "work",
        remaining: 300,
        exercises: [
          { name: "Warm-up", work: 300, rest: 30 },
          { name: "Main set", work: 45, rest: 60 },
          { name: "Cooldown", work: 180, rest: 0 },
        ],
      },
      pomodoroTimer: {
        duration: 25,
        shortBreak: 5,
        longBreak: 15,
        sessionsBeforeLong: 4,
        phase: "work",
        remaining: 25 * 60,
        completed: 0,
        running: false,
      },
      studyChecklist: [],
      flashcardDecks: [],
    },
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

  // Keep all existing notebook docs. For legacy users who had content in the old
  // single-notebook system, migrate it into one notebook_doc. New users start with zero.
  const existingNotebooks = rawNotes.filter((note) => note.kind === "notebook_doc");
  const notebookDocs = existingNotebooks.length > 0
    ? existingNotebooks
    : legacyNotebookBits.length > 0
      ? [{
          id: "notebook-main",
          kind: "notebook_doc",
          title: "Notebook",
          content: legacyNotebookBits.join("\n\n"),
          category: "general",
          goalId: "",
          goalName: "",
          createdAt: Date.now(),
        }]
      : []; // brand-new user — no notebooks until they create one

  const notes = [
    ...notebookDocs,
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

  const migrated = {
    habits: state.habits || [],
    goals: state.goals || [],
    notes,
    tools: {
      studyTimer: {
        duration: Math.max(1, Number(state.tools?.studyTimer?.duration) || 25),
        remaining: Math.max(1, Number(state.tools?.studyTimer?.remaining) || ((Number(state.tools?.studyTimer?.duration) || 25) * 60)),
        running: Boolean(state.tools?.studyTimer?.running),
      },
      workoutTimer: {
        running: Boolean(state.tools?.workoutTimer?.running),
        currentIndex: Math.max(0, Number(state.tools?.workoutTimer?.currentIndex) || 0),
        phase: state.tools?.workoutTimer?.phase === "rest" ? "rest" : "work",
        remaining: Math.max(1, Number(state.tools?.workoutTimer?.remaining) || 300),
        exercises: Array.isArray(state.tools?.workoutTimer?.exercises) && state.tools.workoutTimer.exercises.length
          ? state.tools.workoutTimer.exercises.map((exercise, index) => ({
              name: String(exercise?.name || `Exercise ${index + 1}`),
              work: Math.max(5, Number(exercise?.work) || 45),
              rest: Math.max(0, Number(exercise?.rest) || 0),
            }))
          : defaultState().tools.workoutTimer.exercises,
      },
      pomodoroTimer: {
        duration: Math.max(1, Number(state.tools?.pomodoroTimer?.duration) || 25),
        shortBreak: Math.max(1, Number(state.tools?.pomodoroTimer?.shortBreak) || 5),
        longBreak: Math.max(1, Number(state.tools?.pomodoroTimer?.longBreak) || 15),
        sessionsBeforeLong: Math.max(1, Number(state.tools?.pomodoroTimer?.sessionsBeforeLong) || 4),
        phase: ["work", "shortBreak", "longBreak"].includes(state.tools?.pomodoroTimer?.phase) ? state.tools.pomodoroTimer.phase : "work",
        remaining: Math.max(1, Number(state.tools?.pomodoroTimer?.remaining) || 25 * 60),
        completed: Math.max(0, Number(state.tools?.pomodoroTimer?.completed) || 0),
        running: Boolean(state.tools?.pomodoroTimer?.running),
      },
      studyChecklist: Array.isArray(state.tools?.studyChecklist)
        ? state.tools.studyChecklist.map((item) => ({
            id: item.id || ("cl" + Date.now() + Math.random().toString(36).slice(2, 5)),
            text: String(item.text || ""),
            done: false,
          }))
        : [],
      flashcardDecks: Array.isArray(state.tools?.flashcardDecks)
        ? state.tools.flashcardDecks.map((deck) => ({
            id: deck.id || ("fd" + Date.now() + Math.random().toString(36).slice(2, 5)),
            name: String(deck.name || "Untitled Deck"),
            createdAt: deck.createdAt || Date.now(),
            cards: Array.isArray(deck.cards)
              ? deck.cards.map((card) => ({
                  id: card.id || ("fc" + Date.now() + Math.random().toString(36).slice(2, 5)),
                  front: String(card.front || ""),
                  back: String(card.back || ""),
                }))
              : [],
          }))
        : [],
    },
    settings: {
      name: state.settings?.name || "",
      theme: state.settings?.theme || "light",
    },
  };

  // When the workout timer isn't actively running, snap remaining to the full
  // duration of the current exercise/phase so the display is always clean on load.
  // This prevents stale mid-countdown values from persisting across sessions.
  if (!migrated.tools.workoutTimer.running) {
    const wt = migrated.tools.workoutTimer;
    const ex = wt.exercises[Math.min(wt.currentIndex, wt.exercises.length - 1)];
    if (ex) wt.remaining = wt.phase === "rest" ? Math.max(1, ex.rest) : ex.work;
  }

  return migrated;
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

function serializeState(state) {
  return JSON.stringify(sanitizeStateForSave(state));
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
  if (!snap.exists()) {
    lastRemoteStateJSON = serializeState(defaultState());
    return defaultState();
  }
  const nextState = migrateState(snap.data()?.state || defaultState());
  lastRemoteStateJSON = serializeState(nextState);
  return nextState;
}

async function saveRemoteStateNow() {
  const fb = await ensureFirebase();
  if (!fb || !currentUser) return;
  const { doc, setDoc, serverTimestamp } = fb.dbApi;
  const cleanState = sanitizeStateForSave(S);
  // Must match exactly what the snapshot handler computes:
  // serializeState(migrateState(snap.data().state))
  // so our own writes don't look like "changed" remote state and trigger rerenderPage()
  lastRemoteStateJSON = serializeState(migrateState(cleanState));
  await setDoc(doc(fb.db, "pulseUsers", currentUser.uid), {
    email: currentUser.email || "",
    username: currentUser.username || "",
    state: cleanState,
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
      // Send verification email — Firebase handles delivery, no SMTP needed
      try { await fb.authApi.sendEmailVerification(cred.user); } catch {}
      return { uid: cred.user.uid, username: cred.user.email || clean, email: cred.user.email || clean, needsVerification: true };
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

function scrollToAuth(mode) {
  const section = document.getElementById("landingAuth");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  if (authMode !== mode) switchTab(mode);
}

function switchTab(mode) {
  if (authMode === mode) return;
  authMode = mode;
  document.getElementById("tabIn").classList.toggle("active", mode === "in");
  document.getElementById("tabUp").classList.toggle("active", mode === "up");
  document.getElementById("authBtn").textContent = mode === "in" ? "Sign in" : "Create account";
  document.getElementById("authErr").classList.add("hidden");

  const title = document.getElementById("authCardTitle");
  const sub = document.getElementById("authCardSubText");
  if (title) title.textContent = mode === "in" ? "Welcome back." : "Create your account.";
  if (sub) sub.textContent = mode === "in" ? "Sign in to continue with Pulse." : "Join Pulse and start building momentum.";

  const body = document.getElementById("authFormBody");
  if (body) {
    const dir = mode === "up" ? "slide-left" : "slide-right";
    body.classList.remove("slide-left", "slide-right");
    void body.offsetWidth;
    body.classList.add(dir);
    setTimeout(() => body.classList.remove("slide-left", "slide-right"), 300);
  }
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
  document.getElementById("bootScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appWrap").classList.add("hidden");
  document.getElementById("mobNav").classList.add("hidden");
  document.getElementById("verifyScreen")?.classList.add("hidden");
}

function showApp() {
  syncAuthUI();
  document.getElementById("bootScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appWrap").classList.remove("hidden");
  document.getElementById("mobNav").classList.remove("hidden");
  applyTheme(S.settings.theme || "light");
  syncUserUI();
  nav("dashboard");
  // Re-attach interval ticks for any timers that were running when state was loaded
  if (getPomodoroTimer().running) startPomodoroTimerTick();
  if (getWorkoutTimer().running) runWorkoutTimer();
  if (getStudyTimer().running) runStudyTimer();
}

function showVerifyScreen(email) {
  document.getElementById("bootScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appWrap").classList.add("hidden");
  document.getElementById("mobNav")?.classList.add("hidden");
  const vs = document.getElementById("verifyScreen");
  if (vs) vs.classList.remove("hidden");
  const emailEl = document.getElementById("verifyEmail");
  if (emailEl) emailEl.textContent = email || "";
}

async function checkVerification() {
  const fb = await ensureFirebase();
  if (!fb) return;
  const user = fb.auth.currentUser;
  if (!user) return showAuth();
  try {
    await user.reload();
    if (user.emailVerified) {
      currentUser = mapFirebaseUser(user);
      S = await startRemoteStateSync(user.uid);
      showApp();
    } else {
      toast("Not verified yet — check your inbox and click the link");
    }
  } catch {
    toast("Could not check verification — try again");
  }
}

async function resendVerification() {
  const fb = await ensureFirebase();
  if (!fb) return;
  const user = fb.auth.currentUser;
  if (!user) return;
  try {
    await fb.authApi.sendEmailVerification(user);
    toast("Verification email resent — check your inbox");
  } catch {
    toast("Could not resend — wait a minute and try again");
  }
}

async function signOut() {
  clearPendingSave();

  // ── Stop timers and save running:false BEFORE the session is torn down.
  // This prevents "auto-start on next login" caused by a previous save
  // (e.g. checking a habit) having captured running:true in storage.
  getPomodoroTimer().running = false;
  getStudyTimer().running  = false;
  getWorkoutTimer().running = false;
  clearStudyTimerTick();
  clearWorkoutTimerTick();
  clearPomodoroTimerTick();

  // Flush stopped state to storage while we still have a valid session
  if (currentUser) {
    if (!isFirebaseConfigured()) {
      saveUD(currentUser.uid, sanitizeStateForSave(S)); // synchronous localStorage write
    } else {
      try { await saveRemoteStateNow(); } catch {} // best-effort Firebase write
    }
  }

  stopRemoteStateSync();
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
  activeNotebookId = null;
  noteFilter = "notebook";
  flashcardDeckId = null;
  flashcardStudyMode = false;
  flashcardFlipped = false;
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

function applyRemoteState(nextState) {
  const serialized = serializeState(nextState);
  if (serialized === lastRemoteStateJSON) return;
  lastRemoteStateJSON = serialized;
  S = migrateState(nextState);
  if (!document.getElementById("appWrap").classList.contains("hidden")) {
    syncUserUI();
    rerenderPage();
  }
}

function stopRemoteStateSync() {
  if (remoteStateUnsub) {
    remoteStateUnsub();
    remoteStateUnsub = null;
  }
}

async function startRemoteStateSync(uid) {
  const fb = await ensureFirebase();
  if (!fb) return null;
  const { doc, onSnapshot } = fb.dbApi;
  stopRemoteStateSync();

  return new Promise((resolve) => {
    let firstPass = true;
    remoteStateUnsub = onSnapshot(doc(fb.db, "pulseUsers", uid), (snap) => {
      const nextState = snap.exists() ? migrateState(snap.data()?.state || defaultState()) : defaultState();
      const serialized = serializeState(nextState);
      const changed = serialized !== lastRemoteStateJSON;
      lastRemoteStateJSON = serialized;
      S = nextState;

      if (!firstPass && changed && !document.getElementById("appWrap").classList.contains("hidden")) {
        syncUserUI();
        rerenderPage();
      }

      if (firstPass) {
        firstPass = false;
        resolve(nextState);
      }
    }, () => {
      if (firstPass) {
        firstPass = false;
        resolve(defaultState());
      }
    });
  });
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
  // Returns the first notebook doc, or null if no notebooks exist yet.
  return S.notes.find((note) => note.kind === "notebook_doc") || null;
}

function getActiveNotebook() {
  // Returns the currently selected notebook by ID, falling back to the first one.
  if (activeNotebookId) {
    const nb = S.notes.find((n) => n.kind === "notebook_doc" && n.id === activeNotebookId);
    if (nb) return nb;
  }
  const first = S.notes.find((n) => n.kind === "notebook_doc");
  if (first) activeNotebookId = first.id;
  return first || null;
}

function noteMatchesFilter(note) {
  if (noteFilter === "notebook") return note.kind === "notebook_doc";
  if (noteFilter === "activity") return note.kind === "activity";
  return note.kind === "notebook_doc" || note.kind === "activity";
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
  syncStudyTimerUI();
  syncWorkoutTimerUI();
  syncPomodoroTimerUI();
  if (curPage === "ai") {
    renderAIPageMsgs();
    syncAIEditUI(); // restore toggle + badge state after page rebuild
  }
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

function fmtTimer(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getStudyTimer() {
  if (!S.tools) S.tools = defaultState().tools;
  if (!S.tools.studyTimer) S.tools.studyTimer = defaultState().tools.studyTimer;
  return S.tools.studyTimer;
}

function getWorkoutTimer() {
  if (!S.tools) S.tools = defaultState().tools;
  if (!S.tools.workoutTimer) S.tools.workoutTimer = defaultState().tools.workoutTimer;
  if (!Array.isArray(S.tools.workoutTimer.exercises) || !S.tools.workoutTimer.exercises.length) {
    S.tools.workoutTimer.exercises = defaultState().tools.workoutTimer.exercises;
  }
  return S.tools.workoutTimer;
}

function syncStudyTimerUI() {
  const timer = getStudyTimer();
  const display = document.getElementById("studyTimerDisplay");
  const status = document.getElementById("studyTimerStatus");
  const button = document.getElementById("studyTimerToggle");
  if (display) display.textContent = fmtTimer(timer.remaining);
  if (status) status.textContent = timer.running ? "Focus session running" : `Next session: ${timer.duration} min`;
  if (button) button.textContent = timer.running ? "Pause" : "Start";
}

function clearStudyTimerTick() {
  if (studyTimerTick) {
    clearInterval(studyTimerTick);
    studyTimerTick = null;
  }
}

function runStudyTimer() {
  clearStudyTimerTick();
  if (!getStudyTimer().running) return;
  studyTimerTick = setInterval(() => {
    const timer = getStudyTimer(); // fresh reference each tick
    if (!timer.running) {
      clearStudyTimerTick();
      return;
    }
    timer.remaining = Math.max(0, timer.remaining - 1);
    syncStudyTimerUI();
    if (timer.remaining <= 0) {
      timer.running = false;
      clearStudyTimerTick();
      save();
      syncStudyTimerUI();
      toast("Study session complete");
    }
  }, 1000);
}

function setStudyDuration(value) {
  const timer = getStudyTimer();
  const minutes = Math.max(1, Math.min(180, Number(value) || 25));
  timer.duration = minutes;
  if (!timer.running) timer.remaining = minutes * 60;
  save();
  syncStudyTimerUI();
}

function toggleStudyTimer() {
  const timer = getStudyTimer();
  timer.running = !timer.running;
  if (timer.running && timer.remaining <= 0) timer.remaining = timer.duration * 60;
  if (timer.running) runStudyTimer();
  else clearStudyTimerTick();
  save(); // persist running state so refresh restores it correctly
  syncStudyTimerUI();
}

function resetStudyTimer() {
  const timer = getStudyTimer();
  timer.running = false;
  timer.remaining = timer.duration * 60;
  clearStudyTimerTick();
  syncStudyTimerUI();
}

function getWorkoutTotalDuration(timer) {
  return timer.exercises.reduce((sum, ex) => sum + ex.work + (ex.rest || 0), 0);
}

function syncWorkoutTimerUI() {
  const timer = getWorkoutTimer();
  const current = timer.exercises[timer.currentIndex] || timer.exercises[0];
  const display = document.getElementById("workoutTimerDisplay");
  const intervalLabel = document.getElementById("workoutIntervalLabel");
  const status = document.getElementById("workoutTimerStatus");
  const currentLabel = document.getElementById("workoutCurrentLabel");
  const toggle = document.getElementById("workoutTimerToggle");
  const totalEl = document.getElementById("workoutTotalTime");
  if (display) display.textContent = fmtTimer(timer.remaining);
  if (intervalLabel) intervalLabel.textContent = timer.phase === "rest" ? "rest interval" : "work interval";
  if (status) {
    const stepNum = timer.currentIndex + 1;
    const stepTotal = timer.exercises.length;
    status.textContent = `Exercise ${stepNum} of ${stepTotal}`;
  }
  if (currentLabel) currentLabel.textContent = current ? current.name : "No exercise selected";
  if (toggle) toggle.textContent = timer.running ? "Pause" : "Start";
  if (totalEl) totalEl.textContent = `Total: ${fmtTimer(getWorkoutTotalDuration(timer))}`;
}

function clearWorkoutTimerTick() {
  if (workoutTimerTick) {
    clearInterval(workoutTimerTick);
    workoutTimerTick = null;
  }
}

function moveWorkoutTimerForward() {
  const timer = getWorkoutTimer();
  const current = timer.exercises[timer.currentIndex];
  if (!current) {
    timer.running = false;
    clearWorkoutTimerTick();
    syncWorkoutTimerUI();
    return;
  }

  if (timer.phase === "work" && current.rest > 0) {
    timer.phase = "rest";
    timer.remaining = current.rest;
    syncWorkoutTimerUI();
    return;
  }

  if (timer.currentIndex < timer.exercises.length - 1) {
    timer.currentIndex += 1;
    timer.phase = "work";
    timer.remaining = timer.exercises[timer.currentIndex].work;
    syncWorkoutTimerUI();
    return;
  }

  timer.running = false;
  timer.phase = "work";
  timer.currentIndex = 0;
  timer.remaining = timer.exercises[0]?.work || 45;
  clearWorkoutTimerTick();
  syncWorkoutTimerUI();
  toast("Workout timer complete");
}

function runWorkoutTimer() {
  clearWorkoutTimerTick();
  if (!getWorkoutTimer().running) return;
  workoutTimerTick = setInterval(() => {
    const timer = getWorkoutTimer(); // fresh reference each tick
    if (!timer.running) {
      clearWorkoutTimerTick();
      return;
    }
    timer.remaining = Math.max(0, timer.remaining - 1);
    syncWorkoutTimerUI();
    if (timer.remaining <= 0) moveWorkoutTimerForward();
  }, 1000);
}

function toggleWorkoutTimer() {
  const timer = getWorkoutTimer();
  timer.running = !timer.running;
  if (timer.running) runWorkoutTimer();
  else clearWorkoutTimerTick();
  save(); // persist running state so refresh restores it correctly
  syncWorkoutTimerUI();
}

function resetWorkoutTimer() {
  const timer = getWorkoutTimer();
  timer.running = false;
  timer.currentIndex = 0;
  timer.phase = "work";
  timer.remaining = timer.exercises[0]?.work || 300;
  clearWorkoutTimerTick();
  save(); // persist the reset so reload doesn't restore a stale mid-countdown value
  syncWorkoutTimerUI();
}

function nextWorkoutTimerStep() {
  moveWorkoutTimerForward();
}

function addWorkoutExercise() {
  const timer = getWorkoutTimer();
  timer.exercises.push({ name: `Exercise ${timer.exercises.length + 1}`, work: 45, rest: 60 });
  save();
  rerenderPage();
  // Animate only the newly added last row
  const rows = document.querySelectorAll(".workspace-plan-row");
  const lastRow = rows[rows.length - 1];
  if (lastRow) lastRow.classList.add("row-added");
}

function removeWorkoutExercise(index) {
  const timer = getWorkoutTimer();
  if (timer.exercises.length <= 1) return toast("Keep at least one exercise");

  const doRemove = () => {
    timer.exercises.splice(index, 1);
    timer.currentIndex = Math.min(timer.currentIndex, timer.exercises.length - 1);
    const current = timer.exercises[timer.currentIndex];
    timer.remaining = timer.phase === "rest" ? current.rest || 1 : current.work;
    save();
    rerenderPage();
  };

  const rows = document.querySelectorAll(".workspace-plan-row");
  const row = rows[index];
  if (row) {
    row.classList.add("workout-row-removing");
    setTimeout(doRemove, 220);
  } else {
    doRemove();
  }
}

function updateWorkoutExercise(index, field, value) {
  const timer = getWorkoutTimer();
  const exercise = timer.exercises[index];
  if (!exercise) return;
  if (field === "name") {
    exercise.name = value || `Exercise ${index + 1}`;
  } else if (field === "work") {
    exercise.work = Math.max(5, Number(value) || 45);
  } else if (field === "rest") {
    exercise.rest = Math.max(0, Number(value) || 0);
  }

  if (timer.currentIndex === index && timer.phase === "work" && !timer.running) timer.remaining = exercise.work;
  if (timer.currentIndex === index && timer.phase === "rest" && !timer.running) timer.remaining = Math.max(1, exercise.rest || 1);
  save();
  syncWorkoutTimerUI();
  // Update the mm:ss preview label for this row without a full re-render
  if (field === "work" || field === "rest") {
    const rows = document.querySelectorAll(".workspace-plan-row");
    const row = rows[index];
    if (row) {
      const previews = row.querySelectorAll(".workout-time-preview");
      if (previews[0]) previews[0].textContent = fmtTimer(exercise.work);
      if (previews[1]) previews[1].textContent = exercise.rest > 0 ? fmtTimer(exercise.rest) : "none";
    }
  }
}

function renderStudyTimerCard() {
  const timer = getStudyTimer();
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">Study timer</div>
          <div class="workspace-tool-sub">Use a simple focus block to start work without negotiating with yourself.</div>
        </div>
        <div class="workspace-timer-display" id="studyTimerDisplay">${fmtTimer(timer.remaining)}</div>
      </div>
      <div class="workspace-tool-row">
        <div class="workspace-tool-status" id="studyTimerStatus">${timer.running ? "Focus session running" : `Next session: ${timer.duration} min`}</div>
        <div class="workspace-tool-actions">
          <button class="btn btn-outline btn-sm" id="studyTimerToggle" onclick="toggleStudyTimer()">${timer.running ? "Pause" : "Start"}</button>
          <button class="btn btn-ghost btn-sm" onclick="resetStudyTimer()">Reset</button>
        </div>
      </div>
      <div class="workspace-tool-grid">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Focus minutes</label>
          <input class="form-input" type="number" min="1" max="180" value="${timer.duration}" onchange="setStudyDuration(this.value)">
        </div>
      </div>
    </div>
  `;
}

function renderWorkoutTimerCard() {
  const timer = getWorkoutTimer();
  const current = timer.exercises[timer.currentIndex] || timer.exercises[0];
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">Workout timer</div>
          <div class="workspace-tool-sub">Build a simple interval flow with exercise time and rest between sets.</div>
        </div>
        <div class="workout-display-wrap">
          <div class="workspace-timer-display" id="workoutTimerDisplay">${fmtTimer(timer.remaining)}</div>
          <div class="workout-interval-label" id="workoutIntervalLabel">${timer.phase === "rest" ? "rest interval" : "work interval"}</div>
        </div>
      </div>
      <div class="workspace-tool-row">
        <div>
          <div class="workspace-tool-status" id="workoutCurrentLabel">${current ? current.name : "No exercise selected"}</div>
          <div class="workspace-tool-meta" id="workoutTimerStatus">Exercise ${timer.currentIndex + 1} of ${timer.exercises.length}</div>
        </div>
        <div class="workout-tool-right">
          <div class="workout-total-time" id="workoutTotalTime">Total: ${fmtTimer(getWorkoutTotalDuration(timer))}</div>
          <div class="workspace-tool-actions">
            <button class="btn btn-outline btn-sm" id="workoutTimerToggle" onclick="toggleWorkoutTimer()">${timer.running ? "Pause" : "Start"}</button>
            <button class="btn btn-ghost btn-sm" onclick="nextWorkoutTimerStep()">Next</button>
            <button class="btn btn-ghost btn-sm" onclick="resetWorkoutTimer()">Reset</button>
          </div>
        </div>
      </div>
      <div class="workspace-plan">
        <div class="workspace-plan-header">
          <span>Exercise</span>
          <span>Work</span>
          <span>Rest</span>
          <span></span>
        </div>
        ${timer.exercises.map((exercise, index) => `
          <div class="workspace-plan-row ${index === timer.currentIndex ? "active" : ""}">
            <input class="form-input" value="${esc(exercise.name)}" oninput="updateWorkoutExercise(${index}, 'name', this.value)" placeholder="Exercise name">
            <div class="workout-time-cell">
              <input class="form-input" type="number" min="5" step="5" value="${exercise.work}" oninput="updateWorkoutExercise(${index}, 'work', this.value)" placeholder="45">
              <span class="workout-time-preview">${fmtTimer(exercise.work)}</span>
            </div>
            <div class="workout-time-cell">
              <input class="form-input" type="number" min="0" step="5" value="${exercise.rest}" oninput="updateWorkoutExercise(${index}, 'rest', this.value)" placeholder="0">
              <span class="workout-time-preview">${exercise.rest > 0 ? fmtTimer(exercise.rest) : "none"}</span>
            </div>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="removeWorkoutExercise(${index})" title="Remove">×</button>
          </div>
        `).join("")}
      </div>
      <div class="workspace-tool-actions" style="margin-top:14px">
        <button class="btn btn-outline btn-sm" onclick="addWorkoutExercise()">+ Add exercise</button>
      </div>
    </div>
  `;
}

function getPomodoroTimer() {
  if (!S.tools) S.tools = defaultState().tools;
  if (!S.tools.pomodoroTimer) S.tools.pomodoroTimer = defaultState().tools.pomodoroTimer;
  return S.tools.pomodoroTimer;
}

function syncPomodoroTimerUI() {
  const t = getPomodoroTimer();
  const display = document.getElementById("pomodoroDisplay");
  const status = document.getElementById("pomodoroStatus");
  const btn = document.getElementById("pomodoroToggle");
  const dotsEl = document.getElementById("pomodoroDots");
  const phaseLabels = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };
  if (display) display.textContent = fmtTimer(t.remaining);
  if (status) status.textContent = phaseLabels[t.phase] || "Focus";
  if (btn) btn.textContent = t.running ? "Pause" : "Start";
  if (dotsEl) {
    dotsEl.innerHTML = Array.from({ length: t.sessionsBeforeLong }, (_, i) =>
      `<span class="pomo-dot${i < t.completed ? " done" : ""}"></span>`
    ).join("");
  }
}

function clearPomodoroTimerTick() {
  if (pomodoroTimerTick) {
    clearInterval(pomodoroTimerTick);
    pomodoroTimerTick = null;
  }
}

function startPomodoroTimerTick() {
  clearPomodoroTimerTick();
  if (!getPomodoroTimer().running) return;
  pomodoroTimerTick = setInterval(() => {
    // Always read fresh state so S replacements (e.g. from remote sync) are respected
    const t = getPomodoroTimer();
    if (!t.running) { clearPomodoroTimerTick(); return; }
    t.remaining -= 1;
    if (t.remaining <= 0) {
      // Phase transition — advance to the next phase
      if (t.phase === "work") {
        t.completed += 1;
        if (t.completed >= t.sessionsBeforeLong) {
          t.phase = "longBreak";
          t.remaining = t.longBreak * 60;
        } else {
          t.phase = "shortBreak";
          t.remaining = t.shortBreak * 60;
        }
      } else {
        if (t.phase === "longBreak") t.completed = 0;
        t.phase = "work";
        t.remaining = t.duration * 60;
      }
      // Only save on phase transitions, not every second — prevents Firestore
      // snapshot storms that were replacing S and resetting running to false
      save();
    }
    syncPomodoroTimerUI();
  }, 1000);
}

function togglePomodoroTimer() {
  const t = getPomodoroTimer();
  t.running = !t.running;
  save();
  if (t.running) startPomodoroTimerTick();
  else clearPomodoroTimerTick();
  syncPomodoroTimerUI();
}

function resetPomodoroTimer() {
  clearPomodoroTimerTick();
  const t = getPomodoroTimer();
  t.running = false;
  t.phase = "work";
  t.completed = 0;
  t.remaining = t.duration * 60;
  save();
  syncPomodoroTimerUI();
}

// ── Study Checklist ──────────────────────────────────────────────────────────

function getStudyChecklist() {
  if (!S.tools.studyChecklist) S.tools.studyChecklist = [];
  return S.tools.studyChecklist;
}

function addChecklistItem() {
  const input = document.getElementById("checklistInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  const item = {
    id: "cl" + Date.now() + Math.random().toString(36).slice(2, 5),
    text,
    done: false,
  };
  getStudyChecklist().push(item);
  input.value = "";
  input.focus();
  save();
  appendChecklistItem(item);
}

function appendChecklistItem(item) {
  const container = document.getElementById("checklistItems");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "cl-item";
  div.id = "cli-" + item.id;
  div.innerHTML = `
    <button class="cl-check" onclick="completeChecklistItem('${item.id}')" aria-label="Complete task">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 6.5L5 9.5L11 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span class="cl-text">${esc(item.text)}</span>
  `;
  // trigger entrance animation
  requestAnimationFrame(() => div.classList.add("cl-item-in"));
  container.appendChild(div);
}

function completeChecklistItem(id) {
  const list = getStudyChecklist();
  const el = document.getElementById("cli-" + id);
  if (el) {
    el.classList.add("cl-completing");
    setTimeout(() => {
      const idx = list.findIndex((i) => i.id === id);
      if (idx !== -1) list.splice(idx, 1);
      save();
      el.remove();
    }, 380);
  }
}

function renderChecklistCard() {
  const list = getStudyChecklist();
  const items = list
    .map(
      (item) => `
    <div class="cl-item" id="cli-${item.id}">
      <button class="cl-check" onclick="completeChecklistItem('${item.id}')" aria-label="Complete task">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M2 6.5L5 9.5L11 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="cl-text">${esc(item.text)}</span>
    </div>`
    )
    .join("");
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-title">Study Checklist</div>
      <div class="workspace-tool-sub">Track tasks for this session. Items disappear when checked off.</div>
      <div class="cl-input-row">
        <input
          id="checklistInput"
          class="form-input cl-input"
          placeholder="Add a task…"
          onkeydown="if(event.key==='Enter')addChecklistItem()"
        />
        <button class="btn btn-primary btn-sm" onclick="addChecklistItem()">Add</button>
      </div>
      <div class="cl-list" id="checklistItems">${items}</div>
    </div>
  `;
}

// ── Flashcards ───────────────────────────────────────────────────────────────

function getFlashcardDecks() {
  if (!S.tools.flashcardDecks) S.tools.flashcardDecks = [];
  return S.tools.flashcardDecks;
}

function renderFlashcardWidget() {
  const decks = getFlashcardDecks();
  if (flashcardStudyMode) {
    const deck = decks.find((d) => d.id === flashcardDeckId);
    if (!deck || !deck.cards.length) { flashcardStudyMode = false; }
    else return renderFlashcardStudy(deck);
  }
  return renderFlashcardManage(decks);
}

function renderFlashcardManage(decks) {
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">Flashcards</div>
          <div class="workspace-tool-sub">Active recall to lock in what you learn.</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="openNewDeckModal()">+ New deck</button>
      </div>
      ${decks.length === 0 ? `
        <div class="fc-empty">No decks yet — create one to start studying.</div>
      ` : `
        <div class="fc-deck-list">
          ${decks.map((deck) => `
            <div class="fc-deck-row">
              <div class="fc-deck-info">
                <div class="fc-deck-name">${esc(deck.name)}</div>
                <div class="fc-deck-meta">${deck.cards.length} card${deck.cards.length !== 1 ? "s" : ""}</div>
              </div>
              <div class="fc-deck-actions">
                ${deck.cards.length > 0 ? `<button class="btn btn-outline btn-sm" onclick="startFlashcardStudy('${deck.id}')">Study →</button>` : ""}
                <button class="btn btn-ghost btn-sm" onclick="openAddCardModal('${deck.id}')">+ Card</button>
                <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteFlashcardDeck('${deck.id}')" title="Delete deck">×</button>
              </div>
            </div>
          `).join("")}
        </div>
      `}
    </div>
  `;
}

function renderFlashcardStudy(deck) {
  const card = deck.cards[flashcardCardIndex];
  const isLast = flashcardCardIndex === deck.cards.length - 1;
  const isFirst = flashcardCardIndex === 0;
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">${esc(deck.name)}</div>
          <div class="workspace-tool-sub">${flashcardCardIndex + 1} of ${deck.cards.length} cards</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="shuffleFlashcards('${deck.id}')">Shuffle</button>
          <button class="btn btn-ghost btn-sm" onclick="exitFlashcardStudy()">Exit</button>
        </div>
      </div>
      <div class="fc-card-wrap" onclick="flipFlashcard()">
        <div class="fc-card${flashcardFlipped ? " flipped" : ""}">
          <div class="fc-card-face fc-card-front">
            <div class="fc-card-label">Question</div>
            <div class="fc-card-text">${esc(card.front)}</div>
            <div class="fc-flip-hint">tap to reveal answer</div>
          </div>
          <div class="fc-card-face fc-card-back">
            <div class="fc-card-label">Answer</div>
            <div class="fc-card-text">${esc(card.back)}</div>
          </div>
        </div>
      </div>
      <div class="fc-nav">
        <button class="btn btn-ghost btn-sm" onclick="prevFlashcard()" ${isFirst ? "disabled" : ""}>← Prev</button>
        <button class="btn btn-ghost btn-sm" onclick="nextFlashcard('${deck.id}')" ${isLast ? "disabled" : ""}>Next →</button>
      </div>
    </div>
  `;
}

function openNewDeckModal() {
  modal(`
    <div class="modal-title">New flashcard deck</div>
    <div class="form-group">
      <label class="form-label">Deck name</label>
      <input id="newDeckName" class="form-input" placeholder="e.g. Biology Terms, Spanish Vocab" maxlength="60" autofocus>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createFlashcardDeck()">Create</button>
    </div>
  `);
}

function createFlashcardDeck() {
  const name = document.getElementById("newDeckName")?.value?.trim();
  if (!name) return toast("Enter a deck name");
  const deck = {
    id: "fd" + Date.now() + Math.random().toString(36).slice(2, 5),
    name,
    createdAt: Date.now(),
    cards: [],
  };
  getFlashcardDecks().push(deck);
  save();
  closeModal();
  rerenderPage();
  toast(`"${name}" created`);
}

function openAddCardModal(deckId) {
  modal(`
    <div class="modal-title">Add flashcard</div>
    <div class="form-group">
      <label class="form-label">Front — question or term</label>
      <textarea id="fcFront" class="form-input" rows="3" placeholder="What is photosynthesis?" autofocus></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Back — answer or definition</label>
      <textarea id="fcBack" class="form-input" rows="3" placeholder="The process plants use to convert light into energy…"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addFlashcard('${deckId}')">Add card</button>
    </div>
  `);
}

function addFlashcard(deckId) {
  const front = document.getElementById("fcFront")?.value?.trim();
  const back  = document.getElementById("fcBack")?.value?.trim();
  if (!front) return toast("Enter the front of the card");
  if (!back)  return toast("Enter the back of the card");
  const deck = getFlashcardDecks().find((d) => d.id === deckId);
  if (!deck) return;
  deck.cards.push({
    id: "fc" + Date.now() + Math.random().toString(36).slice(2, 5),
    front,
    back,
  });
  save();
  closeModal();
  rerenderPage();
  toast("Card added");
}

function deleteFlashcardDeck(id) {
  const deck = getFlashcardDecks().find((d) => d.id === id);
  if (!deck) return;
  if (!confirm(`Delete "${deck.name}" and all ${deck.cards.length} card${deck.cards.length !== 1 ? "s" : ""}?`)) return;
  S.tools.flashcardDecks = S.tools.flashcardDecks.filter((d) => d.id !== id);
  if (flashcardDeckId === id) { flashcardDeckId = null; flashcardStudyMode = false; }
  save();
  rerenderPage();
  toast("Deck deleted");
}

function startFlashcardStudy(deckId) {
  flashcardDeckId = deckId;
  flashcardCardIndex = 0;
  flashcardFlipped = false;
  flashcardStudyMode = true;
  rerenderPage();
}

function exitFlashcardStudy() {
  flashcardStudyMode = false;
  flashcardFlipped = false;
  rerenderPage();
}

function flipFlashcard() {
  flashcardFlipped = !flashcardFlipped;
  const card = document.querySelector(".fc-card");
  if (card) card.classList.toggle("flipped", flashcardFlipped);
  const hint = document.querySelector(".fc-flip-hint");
  if (hint) hint.style.opacity = "0";
}

function nextFlashcard(deckId) {
  const deck = getFlashcardDecks().find((d) => d.id === deckId);
  if (!deck || flashcardCardIndex >= deck.cards.length - 1) return;
  flashcardCardIndex++;
  flashcardFlipped = false;
  rerenderPage();
}

function prevFlashcard() {
  if (flashcardCardIndex <= 0) return;
  flashcardCardIndex--;
  flashcardFlipped = false;
  rerenderPage();
}

function shuffleFlashcards(deckId) {
  const deck = getFlashcardDecks().find((d) => d.id === deckId);
  if (!deck) return;
  for (let i = deck.cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]];
  }
  flashcardCardIndex = 0;
  flashcardFlipped = false;
  save();
  rerenderPage();
  toast("Deck shuffled");
}

function renderPomodoroTimerCard() {
  const t = getPomodoroTimer();
  const phaseLabels = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };
  const dots = Array.from({ length: t.sessionsBeforeLong }, (_, i) =>
    `<span class="pomo-dot${i < t.completed ? " done" : ""}"></span>`
  ).join("");
  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">Pomodoro</div>
          <div class="workspace-tool-sub">Work in focused sprints with built-in breaks. ${t.sessionsBeforeLong} sessions then a long rest.</div>
        </div>
        <div class="workspace-timer-display" id="pomodoroDisplay">${fmtTimer(t.remaining)}</div>
      </div>
      <div class="workspace-tool-row">
        <div>
          <div class="workspace-tool-status" id="pomodoroStatus">${phaseLabels[t.phase] || "Focus"}</div>
          <div class="workspace-tool-meta">Work ${t.duration}m · Break ${t.shortBreak}m · Long ${t.longBreak}m</div>
        </div>
        <div class="workspace-tool-actions">
          <button class="btn btn-outline btn-sm" id="pomodoroToggle" onclick="togglePomodoroTimer()">${t.running ? "Pause" : "Start"}</button>
          <button class="btn btn-ghost btn-sm" onclick="resetPomodoroTimer()">Reset</button>
        </div>
      </div>
      <div class="pomo-dots" id="pomodoroDots">${dots}</div>
    </div>
  `;
}

function categoryWorkspacePage(categoryId) {
  const category = cat(categoryId);
  const habits = S.habits.filter((h) => h.category === categoryId);
  const goals = S.goals.filter((g) => g.category === categoryId);
  const activeGoals = goals.filter((g) => goalCur(g) < g.target);
  const completedGoals = goals.filter((g) => goalCur(g) >= g.target);
  const notes = activityNotes().filter((note) => note.category === categoryId);
  const hasContent = habits.length || goals.length || notes.length;
  const doneToday = habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
  const totalTarget = activeGoals.reduce((sum, g) => sum + g.target, 0);
  const totalDone = activeGoals.reduce((sum, g) => sum + goalCur(g), 0);
  const goalPct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;
  const latestNote = notes[0];

  return `
    ${categoryId === "study" ? renderStudyTimerCard() : ""}
    ${categoryId === "study" ? renderPomodoroTimerCard() : ""}
    ${categoryId === "study" ? renderChecklistCard() : ""}
    ${categoryId === "study" ? renderFlashcardWidget() : ""}
    ${categoryId === "workout" ? renderWorkoutTimerCard() : ""}

    ${hasContent ? `
    <div class="dash-stats" style="margin-top:16px;margin-bottom:0">
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
    ` : ""}

    ${habits.length ? `
    <div class="page-section">
      <div class="sec-hd">
        <div class="sec-label">${category.label} habits</div>
        <button class="sec-action" onclick="nav('habits')">All habits</button>
      </div>
      ${habits.map((h) => habitRow(h, false)).join("")}
    </div>
    ` : ""}

    ${activeGoals.length || completedGoals.length ? `
    <div class="page-section">
      <div class="sec-hd">
        <div class="sec-label">${category.label} goals</div>
        <button class="sec-action" onclick="nav('goals')">All goals</button>
      </div>
      ${activeGoals.length ? `<div class="grid2">${activeGoals.map((g) => goalCard(g)).join("")}</div>` : ""}
      ${completedGoals.length ? `
        <div class="page-section">
          <div class="sec-hd"><div class="sec-label">Completed</div></div>
          <div class="grid2">${completedGoals.map((g) => goalCard(g)).join("")}</div>
        </div>
      ` : ""}
    </div>
    ` : ""}

    ${notes.length ? `
    <div class="page-section">
      <div class="sec-hd">
        <div class="sec-label">${category.label} activity</div>
        <button class="sec-action" onclick="nav('notes')">Open notes</button>
      </div>
      <div class="notes-stack">${notes.slice(0, 6).map((n) => noteRow(n)).join("")}</div>
    </div>
    ` : ""}
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
    const notebook = getNotebookDoc(); // may be null for new users
    const notebookCount = S.notes.filter((n) => n.kind === "notebook_doc").length;
    const totalGoalTarget = activeGoals.reduce((sum, g) => sum + g.target, 0);
    const totalGoalDone = activeGoals.reduce((sum, g) => sum + goalCur(g), 0);
    const goalPct = totalGoalTarget ? Math.round((totalGoalDone / totalGoalTarget) * 100) : 0;
    const nextHabit = S.habits.find((h) => !(h.logs && h.logs[getTodayStr()]));
    const latestNote = notebook?.content?.trim() || "";
    const focusLabel = pct >= 80 ? "Strong rhythm today" : pct >= 40 ? "Solid momentum building" : "A fresh start still counts";
    const aiCoachCopy = nextHabit
      ? `${Math.max(total - doneToday, 0)} habits are still open today. Start with ${nextHabit.name} and use Pulse AI if you want help sequencing the rest.`
      : activeGoals[0]
        ? `Your habit list is clear today. Pulse AI can help you choose the smartest next push on ${activeGoals[0].name}.`
        : latestNote
          ? "Pulse AI can turn your notes into one realistic next step if you're not sure what to tackle next."
          : "Use Pulse AI when you want a quick reset, a realistic next step, or a short recap across everything in Pulse.";

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
                    <div class="dash-stat-kicker">Notebooks</div>
                    <div class="dash-stat-line">
                      <div class="dash-stat-val">${notebookCount}</div>
                      <div class="dash-stat-text">${notebookCount === 1 ? "notebook" : notebookCount === 0 ? "none yet" : "notebooks"}</div>
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
            notebook?.content?.trim()
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
            <div class="dash-side-copy">${esc(aiCoachCopy)}</div>
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
                  <strong>${notebookCount > 0 ? `${notebookCount} notebook${notebookCount !== 1 ? "s" : ""}` : "No notebooks yet"}</strong>
                  <span>${latestNote ? esc(latestNote.slice(0, 72)) : "Create a notebook in the Notes tab to start writing"}</span>
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
    const notebookDocs = S.notes
      .filter((n) => n.kind === "notebook_doc")
      .sort((a, b) => b.createdAt - a.createdAt);
    const activities = activityNotes();
    const activeNb = getActiveNotebook();

    const tabsHtml = `
      <div class="filter-pills">
        <div class="fpill ${noteFilter === "notebook" ? "active" : ""}" onclick="setNoteFilter('notebook')">
          Notes ${notebookDocs.length > 0 ? `<span class="pill-count">${notebookDocs.length}</span>` : ""}
        </div>
        <div class="fpill ${noteFilter === "activity" ? "active" : ""}" onclick="setNoteFilter('activity')">
          Activity ${activities.length > 0 ? `<span class="pill-count">${activities.length}</span>` : ""}
        </div>
      </div>
    `;

    // ── NOTES (notebook) tab ────────────────────────────────────────────────
    if (noteFilter === "notebook") {
      if (notebookDocs.length === 0) {
        return `
          ${tabsHtml}
          <div class="empty">
            <div class="empty-icon">📓</div>
            <div class="empty-title">No notebooks yet</div>
            <div class="empty-text">Create your first notebook and start writing.</div>
            <button class="btn btn-primary" style="margin-top:18px" onclick="openNewNotebookModal()">+ New notebook</button>
          </div>
        `;
      }

      return `
        ${tabsHtml}
        <div class="notebook-composer surface-card">
          <div class="nb-editor-header">
            <div class="nb-editor-title" ondblclick="editNotebookTitle('${activeNb?.id}')" title="Double-click to rename">${esc(activeNb?.title || "")}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
              <button class="btn btn-ghost btn-sm" onclick="openNewNotebookModal()">+ New</button>
              ${activeNb ? `<button class="btn btn-danger btn-sm" onclick="deleteNotebook('${activeNb.id}')">Delete</button>` : ""}
            </div>
          </div>
          ${activeNb ? `
            <div class="form-group" style="margin-bottom:0">
              <textarea id="notebookBody" class="form-input notebook-body" placeholder="Start writing...">${esc(activeNb.content || "")}</textarea>
            </div>
            <div class="composer-actions">
              <button class="btn btn-primary" onclick="saveNotebook()">Save notebook</button>
            </div>
          ` : `<div class="nb-select-prompt">Select a notebook below to open it.</div>`}
        </div>

        <div class="nb-list">
          ${notebookDocs.map((nb) => `
            <div class="nb-entry${nb.id === activeNb?.id ? " active" : ""}" onclick="switchNotebook('${nb.id}')">
              <div class="nb-entry-info">
                <div class="nb-entry-title">${esc(nb.title)}</div>
                <div class="nb-entry-preview">${esc((nb.content || "").slice(0, 90)) || "Empty notebook"}</div>
              </div>
              <div class="nb-entry-date">${fmtShortDate(nb.createdAt)}</div>
            </div>
          `).join("")}
        </div>
      `;
    }

    // ── ACTIVITY tab ────────────────────────────────────────────────────────
    let visibleActivity = [...activities];
    if (noteSearch) {
      const q = noteSearch.toLowerCase();
      visibleActivity = visibleActivity.filter((n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.content || "").toLowerCase().includes(q) ||
        (n.goalName || "").toLowerCase().includes(q)
      );
    }

    return `
      ${tabsHtml}
      <div class="search-wrap">
        <svg class="search-ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="9" r="7"></circle><path d="m16 16-3.5-3.5"></path></svg>
        <input class="search-input" type="text" placeholder="Search activity notes..." value="${esc(noteSearch)}" oninput="noteSearch=this.value;rerenderPage()">
      </div>
      ${visibleActivity.length
        ? `<div class="notes-stack">${visibleActivity.map((n) => noteRow(n)).join("")}</div>`
        : `<div class="empty"><div class="empty-icon">✎</div><div class="empty-title">${noteSearch ? "No notes found" : "No activity notes yet"}</div><div class="empty-text">${noteSearch ? "Try a different phrase." : "Activity notes are created automatically when you log goal progress."}</div></div>`
      }
    `;
  },

  ai() {
    return `
      <div class="ai-page surface-card">
        <div class="ai-page-header">
          <div class="ai-page-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z"/><path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z"/></svg>
            Pulse AI
            <span class="ai-edit-badge" id="aiEditBadgePage" style="display:none">EDIT</span>
          </div>
          <div class="ai-mode-row ai-mode-row--page">
            <div class="ai-mode-label">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
              Edit mode
            </div>
            <label class="ai-toggle" title="Enable Pulse AI edit mode">
              <input type="checkbox" id="aiEditTogglePage" onchange="onAIEditToggle(this)">
              <span class="ai-toggle-slider"></span>
            </label>
          </div>
        </div>
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
    <div class="habit-item ${done ? "done" : ""}" data-habit-id="${habit.id}">
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
    <div class="goal-card ${done ? "done-card" : ""}" data-goal-id="${goal.id}">
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
    <div class="note-item notebook-entry" onclick="switchNotebook('${note.id}');setNoteFilter('notebook');nav('notes')">
      <div class="note-title">${esc(note.title || "Notebook")}</div>
      <div class="note-preview">${esc((note.content || "").slice(0, 220)) || "Empty notebook"}</div>
      <div class="note-footer">
        <span class="note-date">${fmtShortDate(note.createdAt)}</span>
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
  const wasDone = !!habit.logs[today];
  if (wasDone) {
    delete habit.logs[today];
    toast("Unchecked");
  } else {
    habit.logs[today] = true;
    toast("Habit done ✓");
  }
  save();

  // Targeted DOM update — avoids full re-render which causes the double hover-lift flash
  const el = document.querySelector(`.habit-item[data-habit-id="${id}"]`);
  if (el) {
    const done = !wasDone;
    const c = cat(habit.category);
    el.classList.toggle("done", done);
    const check = el.querySelector(".hcheck");
    if (check) {
      check.className = `hcheck${done ? " checked" : ""}`;
      check.style.cssText = done ? `background:${c.color};border-color:${c.color}` : "";
      check.textContent = done ? "✓" : "";
      check.title = done ? "Mark undone" : "Mark done";
      // Fire the pop animation once when checking — remove the class after it finishes
      // so it doesn't replay on subsequent re-renders
      if (done) {
        check.classList.add("check-pop");
        setTimeout(() => check.classList.remove("check-pop"), 320);
      }
    }
    // Update streak chip
    const meta = el.querySelector(".habit-meta");
    if (meta) {
      const existing = meta.querySelector(".streak-chip");
      if (existing) existing.remove();
      const streak = habitStreak(habit);
      if (streak > 0) meta.insertAdjacentHTML("beforeend", `<span class="streak-chip">${streak} day streak</span>`);
    }
    // Dashboard ring still needs a re-render for the progress circle
    if (curPage === "dashboard") rerenderPage();
  } else {
    rerenderPage();
  }
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
      toast("🎉 Goal completed!");
      finalizeCompletedGoal(goal.id);
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
      <button class="btn btn-outline" onclick="skipCompletionNote('${goal.id}')">Skip</button>
      <button class="btn btn-primary" onclick="saveCompletionNote('${goal.id}')">Save note</button>
    </div>
  `);
}

function skipCompletionNote(goalId) {
  closeModal();
  rerenderPage();
  toast("🎉 Goal completed!");
  if (goalId) finalizeCompletedGoal(goalId);
}

function saveCompletionNote(goalId) {
  const goal = S.goals.find((g) => g.id === goalId);
  if (!goal) return;
  const body = document.getElementById("completionNoteBody").value.trim();
  if (body) addActivityNote(goal, body);
  save();
  closeModal();
  rerenderPage();
  toast("🎉 Goal completed!");
  finalizeCompletedGoal(goalId);
}

function finalizeCompletedGoal(goalId) {
  const card = document.querySelector(`.goal-card[data-goal-id="${goalId}"]`);
  if (card) {
    card.classList.add("goal-removing");
  }
  setTimeout(() => {
    const idx = S.goals.findIndex((g) => g.id === goalId);
    if (idx !== -1) S.goals.splice(idx, 1);
    save();
    rerenderPage();
  }, 420);
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
  const nb = getActiveNotebook();
  if (!nb) return toast("No notebook selected");
  nb.content = bodyEl.value;
  save();
  toast("Saved");
}

function openNewNotebookModal() {
  modal(`
    <div class="modal-title">New notebook</div>
    <div class="form-group">
      <label class="form-label">Title</label>
      <input id="newNbTitle" class="form-input" placeholder="e.g. Work ideas, Personal journal, Study notes" maxlength="60" autofocus>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createNotebook()">Create</button>
    </div>
  `);
}

function createNotebook() {
  const title = document.getElementById("newNbTitle")?.value?.trim();
  if (!title) return toast("Enter a title for your notebook");
  const nb = {
    id: "nb" + Date.now() + Math.random().toString(36).slice(2, 5),
    kind: "notebook_doc",
    title,
    content: "",
    category: "general",
    goalId: "",
    goalName: "",
    createdAt: Date.now(),
  };
  S.notes.unshift(nb);
  activeNotebookId = nb.id;
  save();
  closeModal();
  rerenderPage();
  toast(`"${title}" created`);
}

function switchNotebook(id) {
  activeNotebookId = id;
  rerenderPage();
}

function editNotebookTitle(id) {
  const nb = S.notes.find((n) => n.id === id && n.kind === "notebook_doc");
  if (!nb) return;
  const titleEl = document.querySelector(".nb-editor-title");
  if (!titleEl || titleEl.dataset.editing) return;
  titleEl.dataset.editing = "1";

  const original = nb.title;
  const input = document.createElement("input");
  input.className = "nb-title-input";
  input.value = original;
  input.maxLength = 60;

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newTitle = input.value.trim() || original;
    nb.title = newTitle;
    save();
    delete titleEl.dataset.editing;
    titleEl.textContent = newTitle;
    // Also update the matching entry in the list below
    document.querySelectorAll(".nb-entry.active .nb-entry-title").forEach((el) => {
      el.textContent = newTitle;
    });
  }

  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = original; input.blur(); }
  };

  titleEl.textContent = "";
  titleEl.appendChild(input);
  input.select();
  input.focus();
}

function deleteNotebook(id) {
  const nb = S.notes.find((n) => n.id === id && n.kind === "notebook_doc");
  if (!nb) return;
  if (!confirm(`Delete "${nb.title}" and all its content?`)) return;
  S.notes = S.notes.filter((n) => n.id !== id);
  if (activeNotebookId === id) {
    const remaining = S.notes.find((n) => n.kind === "notebook_doc");
    activeNotebookId = remaining?.id || null;
  }
  save();
  rerenderPage();
  toast("Notebook deleted");
}

function openEditNote(id) {
  const note = S.notes.find((n) => n.id === id);
  if (!note) return;
  if (note.kind === "notebook_doc") {
    activeNotebookId = note.id;
    noteFilter = "notebook";
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
  const personalities = config?.personalities || {};
  const personality = scope === "global"
    ? (personalities.fullscreen || {})
    : (personalities[curPage] || personalities.defaultPage || personalities.fullscreen || {});
  const rules = Array.isArray(personality.behavior) ? personality.behavior.map((rule) => `- ${rule}`).join("\n") : "";

  const context = aiEditMode ? getAIContextRich(scope) : getAIContext(scope);

  const modeBlock = aiEditMode
    ? `\n\nEDIT MODE ACTIVE — You have tools to modify the user's data.
Rules:
- Only call tools the user explicitly asked for.
- Max 5 tool calls per response. Never batch-delete — only one delete per response.
- Never modify past logs or streak history.
- For delete tools: call them normally; the app will ask the user to confirm before executing.
- Do not invent IDs — only use IDs present in the context data above.
- If asked for something outside your tools, explain you cannot do it in edit mode.`
    : `\n\nASK MODE — You can only read and discuss the user's data. You cannot create, modify, or delete anything. If the user asks you to make changes, tell them to enable Edit Mode using the toggle below.`;

  return [
    personality.identity || "You are Pulse AI.",
    personality.tone || "Be helpful and practical.",
    rules ? `Behavior rules:\n${rules}` : "",
    `Current context:\n${context}`,
    modeBlock,
  ].filter(Boolean).join("\n\n");
}

// Rich context with IDs — used in edit mode so the AI can reference specific items
function getAIContextRich(scope) {
  const today = getTodayStr();
  const page = curPage;
  const isGlobal = scope === "global";

  const allHabits = S.habits.map((h) => ({
    id: h.id,
    name: h.name,
    icon: h.icon,
    category: h.category,
    done_today: !!(h.logs && h.logs[today]),
    streak: habitStreak(h),
  }));
  const relevantHabits = isGlobal
    ? allHabits
    : allHabits.filter((h) => ["dashboard", "habits"].includes(page) || h.category === page);

  const allGoals = S.goals.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    category: g.category,
    current: goalCur(g),
    target: g.target,
    unit: g.unit,
    pct: Math.round((goalCur(g) / g.target) * 100),
  }));
  const relevantGoals = isGlobal
    ? allGoals
    : allGoals.filter((g) => ["dashboard", "goals"].includes(page) || g.category === page);

  const checklist = (isGlobal || page === "study")
    ? getStudyChecklist().map((i) => ({ id: i.id, text: i.text }))
    : [];

  const timers = {};
  if (isGlobal || page === "workout") {
    const wt = getWorkoutTimer();
    timers.workout = {
      running: wt.running,
      phase: wt.phase,
      exercises: wt.exercises.map((e, i) => ({ index: i, name: e.name, work_s: e.work, rest_s: e.rest })),
    };
  }
  if (isGlobal || page === "study") {
    const st = getStudyTimer();
    timers.study = { running: st.running, duration_mins: st.duration, remaining_secs: st.remaining };
    const pt = getPomodoroTimer();
    timers.pomodoro = { running: pt.running, phase: pt.phase, work_mins: pt.duration, break_mins: pt.shortBreak };
  }

  const notes = (isGlobal || page === "notes")
    ? activityNotes().slice(0, 8).map((n) => ({ id: n.id, goal: n.goalName || n.title, preview: (n.content || "").slice(0, 80) }))
    : [];

  const parts = [
    `User: ${currentUser?.username || "User"}`,
    `Page: ${PAGE_TITLES[page] || page}`,
    `Date: ${today}`,
    relevantHabits.length ? `Habits: ${JSON.stringify(relevantHabits)}` : null,
    relevantGoals.length ? `Goals: ${JSON.stringify(relevantGoals)}` : null,
    checklist.length ? `Study checklist: ${JSON.stringify(checklist)}` : null,
    Object.keys(timers).length ? `Timers: ${JSON.stringify(timers)}` : null,
    notes.length ? `Activity notes: ${JSON.stringify(notes)}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

function getAIContext(scope = "global") {
  const doneToday = S.habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
  const streak = appStreak();
  const goals = S.goals.map((g) => `${g.name}: ${Math.round((goalCur(g) / g.target) * 100)}%`).join(", ") || "none";
  const habits = S.habits.map((h) => h.name).join(", ") || "none";
  const notebookDocs = S.notes.filter((n) => n.kind === "notebook_doc");
  const notebook = notebookDocs.length
    ? notebookDocs.map((nb) => `[${nb.title}] ${nb.content.slice(0, 150)}`).filter((s) => s.slice(s.indexOf("]") + 2)).join(" | ") || "none"
    : "none";
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

// Builds one chat bubble — handles plain text, action chips, and confirm cards
function buildAIMsgEl(msg) {
  const div = document.createElement("div");
  div.className = `ai-msg ${msg.role}`;

  if (msg.text) {
    const t = document.createElement("span");
    t.className = "ai-msg-text";
    t.textContent = msg.text;
    div.appendChild(t);
  }

  if (msg.actions && msg.actions.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "ai-actions-wrap";

    for (const action of msg.actions) {
      const card = document.createElement("div");

      if (action.status === "pending_confirm") {
        card.className = "ai-confirm-card";
        const msgEl = document.createElement("div");
        msgEl.className = "ai-confirm-msg";
        msgEl.textContent = "⚠ " + getDestructiveDescription(action.name, action.args);
        const btns = document.createElement("div");
        btns.className = "ai-confirm-btns";
        const yes = document.createElement("button");
        yes.className = "ai-confirm-yes";
        yes.textContent = "Confirm";
        yes.onclick = () => executeAIPendingAction(action.confirmId);
        const no = document.createElement("button");
        no.className = "ai-confirm-cancel";
        no.textContent = "Cancel";
        no.onclick = () => cancelAIPendingAction(action.confirmId);
        btns.appendChild(yes);
        btns.appendChild(no);
        card.appendChild(msgEl);
        card.appendChild(btns);
      } else if (action.status === "confirmed" || action.status === "done") {
        card.className = "ai-action-chip done";
        card.textContent = "✓ " + (action.resultText || "Done");
      } else if (action.status === "cancelled") {
        card.className = "ai-action-chip cancelled";
        card.textContent = "✗ Cancelled";
      } else if (action.status === "error") {
        card.className = "ai-action-chip error";
        card.textContent = "✗ " + (action.resultText || "Error");
      }

      if (card.children.length || card.textContent) wrap.appendChild(card);
    }

    if (wrap.children.length) div.appendChild(wrap);
  }

  return div;
}

function renderAIPanelMsgs() {
  const wrap = document.getElementById("aiMessages");
  if (!wrap) return;
  wrap.innerHTML = "";
  const introTitle = document.querySelector(".ai-intro-title");
  const introText = document.querySelector(".ai-intro-text");
  if (introTitle) introTitle.textContent = aiEditMode ? "Edit mode active" : "Current page help";
  if (introText) introText.textContent = aiEditMode
    ? `Pulse AI can create and edit your ${PAGE_TITLES[curPage] || "current page"} data. Destructive actions will ask for confirmation.`
    : `Ask about the ${PAGE_TITLES[curPage] || "current"} page and Pulse AI will focus on what is visible here.`;

  aiPanelMsgs.forEach((msg) => wrap.appendChild(buildAIMsgEl(msg)));

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

  aiPageMsgs.forEach((msg) => wrap.appendChild(buildAIMsgEl(msg)));

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("AI request failed");
  const data = await resp.json();
  // Returns { reply: string|null, actions: [{name, args}] }
  return {
    reply: data.reply || null,
    actions: Array.isArray(data.actions) ? data.actions : [],
  };
}

async function runAIExchange({ inputId, scope, storeKey, store, render }) {
  const input = document.getElementById(inputId);
  const text = input?.value.trim();
  if (!text || aiLoading) return;

  // Block new messages while a destructive action is awaiting confirmation
  if (aiPendingAction) {
    toast("Please confirm or cancel the pending action first");
    return;
  }

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

  const tools = aiEditMode ? getAIToolDeclarations(scope) : [];

  const messages = [
    { role: "system", content: buildAISystemPrompt(scope) },
    // Map history — for action-only messages substitute a results summary so Gemini
    // doesn't receive empty content while keeping conversation alternation intact
    ...store.slice(-10).map((m) => {
      const text = m.text || "";
      const actionSummary = m.actions && m.actions.length > 0
        ? m.actions.map((a) => a.resultText || a.name).filter(Boolean).join(", ")
        : "";
      return { role: m.role, content: text || (actionSummary ? `[${actionSummary}]` : "(no text)") };
    }),
  ];

  try {
    const { reply, actions } = await callPulseAI(config, {
      model: config.model,
      messages,
      tools,
    });

    const msgActions = [];
    let destructiveQueued = false;

    // Process up to 5 actions; only 1 destructive per response
    for (const action of (actions || []).slice(0, 5)) {
      if (isDestructiveAction(action.name, action.args)) {
        if (destructiveQueued) continue; // skip extra destructive actions
        const confirmId = "conf-" + Date.now() + Math.random().toString(36).slice(2, 5);
        msgActions.push({ name: action.name, args: action.args, status: "pending_confirm", confirmId });
        aiPendingAction = { confirmId, storeKey };
        destructiveQueued = true;
      } else {
        const result = executeAIAction(action.name, action.args);
        msgActions.push({
          name: action.name,
          args: action.args,
          status: result.success ? "done" : "error",
          resultText: result.success ? result.message : ("Error: " + result.error),
        });
      }
    }

    store.push({
      role: "assistant",
      text: reply || (msgActions.length > 0 ? null : "Done."),
      actions: msgActions.length > 0 ? msgActions : undefined,
    });
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
    storeKey: "panel",
    store: aiPanelMsgs,
    render: renderAIPanelMsgs,
  });
}

async function sendAIPage() {
  await runAIExchange({
    inputId: "aiPageInput",
    scope: "global",
    storeKey: "page",
    store: aiPageMsgs,
    render: renderAIPageMsgs,
  });
}

// ─── AI EDIT MODE ─────────────────────────────────────────────────────────────

function onAIEditToggle(checkbox) {
  if (checkbox.checked) {
    // Show confirmation before enabling — sync OTHER toggle first so they match
    const otherId = checkbox.id === "aiEditTogglePanel" ? "aiEditTogglePage" : "aiEditTogglePanel";
    const other = document.getElementById(otherId);
    if (other) other.checked = false; // will be re-synced on confirm

    modal(`
      <div style="padding:28px 24px;text-align:center">
        <div style="font-size:26px;margin-bottom:14px">✦</div>
        <div class="modal-title" style="margin-bottom:8px">Enable Edit Mode?</div>
        <div class="modal-sub" style="margin-bottom:22px;max-width:320px;margin-left:auto;margin-right:auto">
          Edit mode gives Pulse AI the ability to <strong>create, modify, and delete</strong> your habits, goals, timers, and notes.
          All destructive actions will always show a confirmation before executing.
        </div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-ghost" onclick="cancelAIEditMode()">Cancel</button>
          <button class="btn btn-primary" onclick="confirmAIEditMode()">Enable edit mode</button>
        </div>
      </div>
    `);
  } else {
    aiEditMode = false;
    aiPendingAction = null;
    syncAIEditUI();
    renderAIPanelMsgs();
    renderAIPageMsgs();
  }
}

function confirmAIEditMode() {
  aiEditMode = true;
  closeModal();
  syncAIEditUI();
  renderAIPanelMsgs();
  renderAIPageMsgs();
  toast("Edit mode on ✦");
}

function cancelAIEditMode() {
  // Uncheck whichever toggle triggered this
  ["aiEditTogglePanel", "aiEditTogglePage"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  closeModal();
}

function syncAIEditUI() {
  // Keep both toggles in sync
  ["aiEditTogglePanel", "aiEditTogglePage"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = aiEditMode;
  });
  // Show/hide edit badges
  ["aiEditBadgePanel", "aiEditBadgePage"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = aiEditMode ? "inline-flex" : "none";
  });
  // Update input placeholders
  const panel = document.getElementById("aiInput");
  if (panel) panel.placeholder = aiEditMode ? "Tell Pulse AI what to do…" : "Ask about your progress…";
  const page = document.getElementById("aiPageInput");
  if (page) page.placeholder = aiEditMode ? "Tell Pulse AI what to do…" : "Ask about your full progress…";
}

// ─── DESTRUCTIVE ACTION HELPERS ────────────────────────────────────────────────

function isDestructiveAction(toolName, args) {
  if (["control_workout_timer", "control_study_timer", "control_pomodoro"].includes(toolName)) {
    return args.action === "reset";
  }
  return ["delete_habit", "delete_goal", "delete_exercise", "delete_note"].includes(toolName);
}

function getDestructiveDescription(toolName, args) {
  switch (toolName) {
    case "delete_habit":     return `Delete habit "${args.habit_name}"? This cannot be undone.`;
    case "delete_goal":      return `Delete goal "${args.goal_name}"? This cannot be undone.`;
    case "delete_exercise":  return `Remove "${args.exercise_name}" from workout? This cannot be undone.`;
    case "delete_note":      return `Delete "${args.note_description}"? This cannot be undone.`;
    case "control_workout_timer": return "Reset the workout timer? All current progress will be cleared.";
    case "control_study_timer":   return "Reset the study timer? Current session will be cleared.";
    case "control_pomodoro":      return "Reset the Pomodoro timer? Current session will be cleared.";
    default: return "Are you sure you want to do this? This cannot be undone.";
  }
}

// ─── PENDING CONFIRMATION ──────────────────────────────────────────────────────

function executeAIPendingAction(confirmId) {
  if (!aiPendingAction || aiPendingAction.confirmId !== confirmId) return;

  const storeKey = aiPendingAction.storeKey;
  const store = storeKey === "page" ? aiPageMsgs : aiPanelMsgs;
  const render = storeKey === "page" ? renderAIPageMsgs : renderAIPanelMsgs;

  // Find the action in the store
  let found = null;
  for (const msg of store) {
    if (!msg.actions) continue;
    for (const action of msg.actions) {
      if (action.confirmId === confirmId) { found = action; break; }
    }
    if (found) break;
  }

  if (!found) { aiPendingAction = null; return; }

  const result = executeAIAction(found.name, found.args);
  found.status = result.success ? "confirmed" : "error";
  found.resultText = result.success ? result.message : ("Error: " + result.error);
  aiPendingAction = null;
  render();
}

function cancelAIPendingAction(confirmId) {
  if (!aiPendingAction || aiPendingAction.confirmId !== confirmId) return;

  const storeKey = aiPendingAction.storeKey;
  const store = storeKey === "page" ? aiPageMsgs : aiPanelMsgs;
  const render = storeKey === "page" ? renderAIPageMsgs : renderAIPanelMsgs;

  for (const msg of store) {
    if (!msg.actions) continue;
    for (const action of msg.actions) {
      if (action.confirmId === confirmId) { action.status = "cancelled"; break; }
    }
  }

  aiPendingAction = null;
  render();
}

// ─── TOOL DECLARATIONS (Gemini function calling format) ────────────────────────

function getAIToolDeclarations(scope) {
  if (!aiEditMode) return [];

  const page = curPage;
  const isGlobal = scope === "global";
  const CATS = ["lifestyle", "coding", "workout", "study", "general"];
  const today = getTodayStr();

  const relevantHabits = S.habits.filter((h) =>
    isGlobal || ["dashboard", "habits"].includes(page) || h.category === page
  );
  const relevantGoals = S.goals.filter((g) =>
    isGlobal || ["dashboard", "goals"].includes(page) || g.category === page
  );

  const habitList = relevantHabits.map((h) => `${h.name}→${h.id}`).join(", ") || "none";
  const goalList = relevantGoals.map((g) => `${g.name}→${g.id}`).join(", ") || "none";

  const tools = [];

  // ── HABITS ────────────────────────────────────────────────────────────────────
  if (relevantHabits.length > 0 && (isGlobal || ["dashboard", "habits", "workout", "study"].includes(page))) {
    tools.push({
      name: "toggle_habit",
      description: `Check or uncheck a habit for today. Habits: ${habitList}`,
      parameters: { type: "OBJECT", properties: {
        habit_id: { type: "STRING", description: "Habit ID from the list" },
        done: { type: "BOOLEAN", description: "true = mark done, false = mark undone" },
      }, required: ["habit_id", "done"] },
    });
  }

  if (isGlobal || page === "habits") {
    tools.push({
      name: "create_habit",
      description: "Create a new habit",
      parameters: { type: "OBJECT", properties: {
        name: { type: "STRING" },
        icon: { type: "STRING", description: "Single emoji" },
        category: { type: "STRING", description: CATS.join(" | ") },
      }, required: ["name", "icon", "category"] },
    });

    if (relevantHabits.length > 0) {
      tools.push({
        name: "delete_habit",
        description: `Delete a habit permanently. Requires user confirmation. Habits: ${habitList}`,
        parameters: { type: "OBJECT", properties: {
          habit_id: { type: "STRING" },
          habit_name: { type: "STRING", description: "Name shown in confirmation" },
        }, required: ["habit_id", "habit_name"] },
      });
    }
  }

  // ── GOALS ─────────────────────────────────────────────────────────────────────
  if (relevantGoals.length > 0 && (isGlobal || ["dashboard", "goals", "workout", "study"].includes(page))) {
    tools.push({
      name: "log_goal",
      description: `Log progress on a goal. Goals: ${goalList}`,
      parameters: { type: "OBJECT", properties: {
        goal_id: { type: "STRING" },
        value: { type: "NUMBER" },
        note: { type: "STRING", description: "Optional activity note (optional)" },
      }, required: ["goal_id", "value"] },
    });

    tools.push({
      name: "add_goal_note",
      description: `Add an activity note to a goal. Goals: ${goalList}`,
      parameters: { type: "OBJECT", properties: {
        goal_id: { type: "STRING" },
        content: { type: "STRING" },
      }, required: ["goal_id", "content"] },
    });
  }

  if (isGlobal || page === "goals") {
    tools.push({
      name: "create_goal",
      description: "Create a new goal with a numeric target",
      parameters: { type: "OBJECT", properties: {
        name: { type: "STRING" },
        icon: { type: "STRING", description: "Single emoji" },
        category: { type: "STRING", description: CATS.join(" | ") },
        target: { type: "NUMBER" },
        unit: { type: "STRING", description: "e.g. km, pages, sessions" },
      }, required: ["name", "icon", "category", "target", "unit"] },
    });

    if (relevantGoals.length > 0) {
      tools.push({
        name: "delete_goal",
        description: `Delete a goal permanently. Requires user confirmation. Goals: ${goalList}`,
        parameters: { type: "OBJECT", properties: {
          goal_id: { type: "STRING" },
          goal_name: { type: "STRING" },
        }, required: ["goal_id", "goal_name"] },
      });
    }
  }

  // ── WORKOUT TIMER ─────────────────────────────────────────────────────────────
  if (isGlobal || page === "workout") {
    const wt = getWorkoutTimer();
    const exList = wt.exercises.map((e, i) => `${i}:${e.name}`).join(", ");

    tools.push({
      name: "control_workout_timer",
      description: "Start, pause, or reset the workout interval timer",
      parameters: { type: "OBJECT", properties: {
        action: { type: "STRING", description: "start | pause | reset (reset requires confirmation)" },
      }, required: ["action"] },
    });

    tools.push({
      name: "add_exercise",
      description: "Add an exercise to the workout plan",
      parameters: { type: "OBJECT", properties: {
        name: { type: "STRING" },
        work_seconds: { type: "NUMBER" },
        rest_seconds: { type: "NUMBER" },
      }, required: ["name", "work_seconds", "rest_seconds"] },
    });

    if (wt.exercises.length > 1) {
      tools.push({
        name: "delete_exercise",
        description: `Remove an exercise. Requires confirmation. Exercises: ${exList}`,
        parameters: { type: "OBJECT", properties: {
          exercise_index: { type: "NUMBER" },
          exercise_name: { type: "STRING" },
        }, required: ["exercise_index", "exercise_name"] },
      });
    }
  }

  // ── STUDY TIMERS ──────────────────────────────────────────────────────────────
  if (isGlobal || page === "study") {
    tools.push({
      name: "control_study_timer",
      description: "Start, pause, or reset the study deep-work timer",
      parameters: { type: "OBJECT", properties: {
        action: { type: "STRING", description: "start | pause | reset (reset requires confirmation)" },
      }, required: ["action"] },
    });

    tools.push({
      name: "control_pomodoro",
      description: "Start, pause, or reset the Pomodoro timer",
      parameters: { type: "OBJECT", properties: {
        action: { type: "STRING", description: "start | pause | reset (reset requires confirmation)" },
      }, required: ["action"] },
    });

    tools.push({
      name: "set_timer_minutes",
      description: "Set a timer duration in minutes",
      parameters: { type: "OBJECT", properties: {
        timer_type: { type: "STRING", description: "study | pomodoro_work | pomodoro_break" },
        minutes: { type: "NUMBER", description: "1–180" },
      }, required: ["timer_type", "minutes"] },
    });

    tools.push({
      name: "add_checklist_item",
      description: "Add an item to the study checklist",
      parameters: { type: "OBJECT", properties: {
        text: { type: "STRING" },
      }, required: ["text"] },
    });

    const cl = getStudyChecklist();
    if (cl.length > 0) {
      tools.push({
        name: "complete_checklist_item",
        description: `Mark a study checklist item done and remove it. Items: ${cl.map((i) => `${i.text}→${i.id}`).join(", ")}`,
        parameters: { type: "OBJECT", properties: {
          item_id: { type: "STRING" },
        }, required: ["item_id"] },
      });
    }
  }

  // ── NOTES ─────────────────────────────────────────────────────────────────────
  if (isGlobal || page === "notes") {
    tools.push({
      name: "write_notebook",
      description: "Write or append content to the notebook",
      parameters: { type: "OBJECT", properties: {
        content: { type: "STRING" },
      }, required: ["content"] },
    });

    const noteList = activityNotes().map((n) => `${n.goalName || n.title}→${n.id}`).join(", ");
    if (noteList) {
      tools.push({
        name: "delete_note",
        description: `Delete a note permanently. Requires confirmation. Notes: ${noteList}`,
        parameters: { type: "OBJECT", properties: {
          note_id: { type: "STRING" },
          note_description: { type: "STRING", description: "Description for confirmation message" },
        }, required: ["note_id", "note_description"] },
      });

      tools.push({
        name: "edit_activity_note",
        description: `Edit an activity note's content. Notes: ${noteList}`,
        parameters: { type: "OBJECT", properties: {
          note_id: { type: "STRING" },
          content: { type: "STRING" },
        }, required: ["note_id", "content"] },
      });
    }
  }

  return tools;
}

// ─── ACTION EXECUTOR ──────────────────────────────────────────────────────────

function executeAIAction(toolName, args) {
  try {
    const VALID_CATS = ["lifestyle", "coding", "workout", "study", "general"];
    switch (toolName) {

      // ── HABITS ────────────────────────────────────────────────────────────────
      case "toggle_habit": {
        const habit = S.habits.find((h) => h.id === args.habit_id);
        if (!habit) return { success: false, error: "Habit not found" };
        const today = getTodayStr();
        const currentlyDone = !!(habit.logs && habit.logs[today]);
        if (currentlyDone !== Boolean(args.done)) toggleHabit(args.habit_id);
        return { success: true, message: `${args.done ? "✓ Checked" : "Unchecked"} "${habit.name}"` };
      }

      case "create_habit": {
        const category = VALID_CATS.includes(args.category) ? args.category : "general";
        const icon = String(args.icon || cat(category).emoji).slice(0, 4);
        S.habits.push({ id: "h" + Date.now(), name: String(args.name || "Habit").slice(0, 60), category, icon, logs: {}, createdAt: Date.now() });
        save(); rerenderPage();
        return { success: true, message: `Created habit "${args.name}" ${icon}` };
      }

      case "delete_habit": {
        const idx = S.habits.findIndex((h) => h.id === args.habit_id);
        if (idx === -1) return { success: false, error: "Habit not found" };
        S.habits.splice(idx, 1);
        save(); rerenderPage();
        return { success: true, message: `Deleted "${args.habit_name}"` };
      }

      // ── GOALS ─────────────────────────────────────────────────────────────────
      case "log_goal": {
        const goal = S.goals.find((g) => g.id === args.goal_id);
        if (!goal) return { success: false, error: "Goal not found" };
        if (!goal.logs) goal.logs = [];
        goal.logs.push({ value: Number(args.value) || 0, date: new Date().toISOString(), note: args.note || "" });
        save(); rerenderPage();
        return { success: true, message: `Logged ${args.value} ${goal.unit || ""} for "${goal.name}"`.trim() };
      }

      case "create_goal": {
        const category = VALID_CATS.includes(args.category) ? args.category : "general";
        const icon = String(args.icon || cat(category).emoji).slice(0, 4);
        S.goals.push({ id: "g" + Date.now(), name: String(args.name || "Goal").slice(0, 60), category, icon, target: Math.max(1, Number(args.target) || 1), unit: String(args.unit || "units").slice(0, 30), logs: [], createdAt: Date.now() });
        save(); rerenderPage();
        return { success: true, message: `Created goal "${args.name}" — target: ${args.target} ${args.unit}` };
      }

      case "delete_goal": {
        const idx = S.goals.findIndex((g) => g.id === args.goal_id);
        if (idx === -1) return { success: false, error: "Goal not found" };
        S.goals.splice(idx, 1);
        save(); rerenderPage();
        return { success: true, message: `Deleted goal "${args.goal_name}"` };
      }

      case "add_goal_note": {
        const goal = S.goals.find((g) => g.id === args.goal_id);
        if (!goal) return { success: false, error: "Goal not found" };
        S.notes.push({ id: "n" + Date.now() + Math.random().toString(36).slice(2, 6), kind: "activity", title: goal.name, content: String(args.content || ""), category: goal.category, goalId: goal.id, goalName: goal.name, createdAt: Date.now() });
        save();
        return { success: true, message: `Added note to "${goal.name}"` };
      }

      // ── WORKOUT TIMER ─────────────────────────────────────────────────────────
      case "control_workout_timer": {
        const wt = getWorkoutTimer();
        if (args.action === "start")  { if (!wt.running) { wt.running = true; runWorkoutTimer(); syncWorkoutTimerUI(); save(); } }
        else if (args.action === "pause") { if (wt.running)  { wt.running = false; clearWorkoutTimerTick(); syncWorkoutTimerUI(); save(); } }
        else if (args.action === "reset") { resetWorkoutTimer(); save(); }
        const wtLabel = { start: "started", pause: "paused", reset: "reset" }[args.action] || args.action;
        return { success: true, message: `Workout timer ${wtLabel}` };
      }

      case "add_exercise": {
        const wt = getWorkoutTimer();
        wt.exercises.push({ name: String(args.name || "Exercise").slice(0, 50), work: Math.max(5, Math.min(3600, Number(args.work_seconds) || 45)), rest: Math.max(0, Math.min(3600, Number(args.rest_seconds) || 30)) });
        save(); rerenderPage();
        requestAnimationFrame(() => {
          const rows = document.querySelectorAll(".workspace-plan-row");
          const last = rows[rows.length - 1];
          if (last) last.classList.add("row-added");
        });
        return { success: true, message: `Added exercise "${args.name}"` };
      }

      case "delete_exercise": {
        removeWorkoutExercise(Number(args.exercise_index));
        return { success: true, message: `Removed "${args.exercise_name}"` };
      }

      // ── STUDY TIMERS ──────────────────────────────────────────────────────────
      case "control_study_timer": {
        const st = getStudyTimer();
        if (args.action === "start")  { if (!st.running) { st.running = true; runStudyTimer(); syncStudyTimerUI(); save(); } }
        else if (args.action === "pause") { if (st.running)  { st.running = false; clearStudyTimerTick(); syncStudyTimerUI(); save(); } }
        else if (args.action === "reset") { resetStudyTimer(); save(); }
        const stLabel = { start: "started", pause: "paused", reset: "reset" }[args.action] || args.action;
        return { success: true, message: `Study timer ${stLabel}` };
      }

      case "control_pomodoro": {
        const pt = getPomodoroTimer();
        if (args.action === "start")  { if (!pt.running) { pt.running = true; startPomodoroTimerTick(); syncPomodoroTimerUI(); save(); } }
        else if (args.action === "pause") { if (pt.running)  { pt.running = false; clearPomodoroTimerTick(); syncPomodoroTimerUI(); save(); } }
        else if (args.action === "reset") { resetPomodoroTimer(); save(); }
        const ptLabel = { start: "started", pause: "paused", reset: "reset" }[args.action] || args.action;
        return { success: true, message: `Pomodoro ${ptLabel}` };
      }

      case "set_timer_minutes": {
        const mins = Math.max(1, Math.min(180, Number(args.minutes) || 25));
        if (args.timer_type === "study") {
          const st = getStudyTimer();
          st.duration = mins;
          if (!st.running) st.remaining = mins * 60;
          save(); syncStudyTimerUI();
        } else if (args.timer_type === "pomodoro_work") {
          const pt = getPomodoroTimer();
          pt.duration = mins;
          if (!pt.running && pt.phase === "work") pt.remaining = mins * 60;
          save(); syncPomodoroTimerUI();
        } else if (args.timer_type === "pomodoro_break") {
          const pt = getPomodoroTimer();
          pt.shortBreak = mins;
          save(); syncPomodoroTimerUI();
        }
        return { success: true, message: `Set ${args.timer_type} to ${mins} min` };
      }

      // ── CHECKLIST ─────────────────────────────────────────────────────────────
      case "add_checklist_item": {
        const item = { id: "cl" + Date.now() + Math.random().toString(36).slice(2, 5), text: String(args.text || "").slice(0, 200), done: false };
        getStudyChecklist().push(item);
        save();
        appendChecklistItem(item);
        return { success: true, message: `Added "${args.text}" to checklist` };
      }

      case "complete_checklist_item": {
        const item = getStudyChecklist().find((i) => i.id === args.item_id);
        if (!item) return { success: false, error: "Item not found" };
        const name = item.text;
        completeChecklistItem(args.item_id);
        return { success: true, message: `Completed "${name}" ✓` };
      }

      // ── NOTES ─────────────────────────────────────────────────────────────────
      case "write_notebook": {
        let doc = getActiveNotebook();
        if (!doc) {
          // Auto-create a notebook if none exists yet
          doc = {
            id: "nb" + Date.now() + Math.random().toString(36).slice(2, 5),
            kind: "notebook_doc", title: "Notebook", content: "",
            category: "general", goalId: "", goalName: "", createdAt: Date.now(),
          };
          S.notes.unshift(doc);
          activeNotebookId = doc.id;
        }
        const addition = String(args.content || "");
        doc.content = doc.content ? doc.content + "\n\n" + addition : addition;
        save();
        rerenderPage();
        return { success: true, message: `Added to "${doc.title}"` };
      }

      case "delete_note": {
        const idx = S.notes.findIndex((n) => n.id === args.note_id);
        if (idx === -1) return { success: false, error: "Note not found" };
        S.notes.splice(idx, 1);
        save(); rerenderPage();
        return { success: true, message: `Deleted "${args.note_description}"` };
      }

      case "edit_activity_note": {
        const note = S.notes.find((n) => n.id === args.note_id);
        if (!note) return { success: false, error: "Note not found" };
        note.content = String(args.content || "");
        save();
        return { success: true, message: "Note updated" };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err?.message || "Execution error" };
  }
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
        // Block unverified users — show verify screen instead of the app
        if (!user.emailVerified) {
          showVerifyScreen(user.email || "");
        } else {
          currentUser = mapFirebaseUser(user);
          S = await startRemoteStateSync(user.uid);
          showApp();
        }
      } else {
        stopRemoteStateSync();
        currentUser = null;
        S = defaultState();
        lastRemoteStateJSON = "";
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
