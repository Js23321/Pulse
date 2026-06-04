const AI_CONFIG = {
  enabled: true,
  endpoint: "/api/ai",
  model: "gemini-3.1-flash-lite",
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
let openHabitCalendarId = null;
let goalFilter = "all";
let noteFilter = "notebook";
let noteSearch = "";
let notebookSearch = "";
let activeNotebookId = null; // which notebook is open in the editor
let historyDate = "";
let historyYear = null;
let historyMonth = null;
let notebookBodyHeight = null; // persists user-resized textarea height across re-renders
let flashcardDeckId = null;     // deck being studied/managed
let flashcardCardIndex = 0;
let flashcardFlipped = false;
let flashcardStudyMode = false;
let flashcardAnswers = {};      // { [cardIndex]: true=correct, false=wrong }
let flashcardSessionDone = false;
let flashcardStartTime = null;
let flashcardSubset = null;     // null=all cards, array of indices=retry subset
let aiOpen = false;
let aiLoading = false;
let aiPanelMode = "page";
let aiEditMode = false;
let aiPendingAction = null; // { confirmId, storeKey } — one destructive action queued at a time

// ── Popup panel: one isolated chat per page ─────────────────────────────────
// aiPanelChats[pageName] = [messages]
// aiPanelAnimatedPages[pageName] = number of messages already animated
let aiPanelChats = {};
let aiPanelAnimatedPages = {};

// ── Full-screen AI page: multiple saved chats ───────────────────────────────
function _makeAIChat(id) {
  const messages = [
    { role: "assistant", text: "I am Pulse AI. I can help across your full Pulse data, including habits, goals, activity notes, and your notebook." },
  ];
  return {
    id: id || ("chat-" + Date.now()),
    title: "New chat",
    isNew: true,
    // Pre-mark initial messages as already seen so they don't animate when a
    // new chat is created — only user-driven messages should animate.
    _animatedCount: messages.length,
    messages,
  };
}
let aiPageChats = [_makeAIChat("chat-default")];
let activePageChatId = aiPageChats[0].id;
let lastCreatedChatId = null; // used to animate only the newly added tab
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
  history: "History",
  ai: "Pulse AI",
};

const PAGE_META = {
  dashboard: "Your daily pulse",
  habits: "Build consistency day by day",
  goals: "Track measurable progress",
  workout: "Training, recovery, and strength goals",
  study: "Learning plans, deep work, and study notes",
  notes: "Notebook and activity notes",
  history: "See what happened on any day",
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
        sessionLog: [], // [{ date: "YYYY-MM-DD", sessions: N, focusMinutes: N }]
      },
      studyChecklist: [],
      flashcardDecks: [],
      focusTimer: { duration: 30, remaining: 30 * 60, running: false },
      studyGoal: { dailyMinutes: 0 }, // 0 = no goal set
      studySubject: "",               // currently selected subject label
      water: { target: 8, log: {} }, // log: { "YYYY-MM-DD": glasses }
      mood: [],                        // [{ date, rating:1-5, note }]
      scratchpad: "",                  // quick-capture dashboard note
    },
    settings: {
      name: "",
      theme: "",
      darkSchedule: { enabled: false, from: "20:00", to: "07:00" },
      reminderTime: "",
      // Draggable dashboard widget layout: [{ id, size, hidden }]
      dashboardWidgets: null, // null = use default order
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
        sessionLog: Array.isArray(state.tools?.pomodoroTimer?.sessionLog)
          ? state.tools.pomodoroTimer.sessionLog
          : [],
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
      focusTimer: {
        duration: Math.max(1, Number(state.tools?.focusTimer?.duration) || 30),
        remaining: Math.max(1, Number(state.tools?.focusTimer?.remaining) || 30 * 60),
        running: false, // never persist running state for focus timer
      },
      studyGoal: { dailyMinutes: Math.max(0, Number(state.tools?.studyGoal?.dailyMinutes) || 0) },
      studySubject: String(state.tools?.studySubject || ""),
      water: {
        target: Math.max(1, Number(state.tools?.water?.target) || 8),
        log: (state.tools?.water?.log && typeof state.tools.water.log === "object") ? state.tools.water.log : {},
      },
      mood: Array.isArray(state.tools?.mood) ? state.tools.mood : [],
      scratchpad: String(state.tools?.scratchpad || ""),
      workoutLog: Array.isArray(state.tools?.workoutLog) ? state.tools.workoutLog : [],
      personalRecords: (state.tools?.personalRecords && typeof state.tools.personalRecords === "object") ? state.tools.personalRecords : {},
    },
    settings: {
      name: state.settings?.name || "",
      theme: state.settings?.theme ?? "",
      darkSchedule: {
        enabled: Boolean(state.settings?.darkSchedule?.enabled),
        from: state.settings?.darkSchedule?.from || "20:00",
        to:   state.settings?.darkSchedule?.to   || "07:00",
      },
      reminderTime: String(state.settings?.reminderTime || ""),
      dashboardWidgets: Array.isArray(state.settings?.dashboardWidgets) ? state.settings.dashboardWidgets : null,
    },
  };

  // NOTE: Do NOT snap studyTimer.remaining here — that caused pause-resets via
  // Firestore echo. setStudyDuration() already handles the "wrong remaining on
  // duration change" case.

  // Same reason as study timer: don't snap workout remaining on load.
  // resetWorkoutTimer() / the timer tick handles clean state explicitly.

  return migrated;
}

function save() {
  if (!currentUser) return;
  S._savedAt = Date.now();
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
      // Send verification email via Resend + Firebase Admin (better deliverability)
      // Falls back to Firebase's built-in sender if the endpoint isn't available
      let emailSent = false;
      let emailError = null;
      try {
        const resp = await fetch("/api/send-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cred.user.email, type: "verify" }),
        });
        const data = await resp.json();
        if (data.sent) {
          emailSent = true;
        } else {
          throw new Error(data.error || "send-verification returned no error");
        }
      } catch (e) {
        emailError = e?.message || String(e);
        console.error("Verification email failed:", emailError);
      }
      return { uid: cred.user.uid, username: cred.user.email || clean, email: cred.user.email || clean, needsVerification: true, emailSent, emailError };
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

  // Restore anything showForgotPassword() or showResetSentInline() may have hidden
  document.getElementById("authPassGroup")?.classList.remove("hidden");
  document.getElementById("forgotPassWrap")?.classList.remove("hidden");
  document.getElementById("authFields")?.classList.remove("hidden");
  document.getElementById("resetSuccessMsg")?.classList.add("hidden");
  const toggle = document.querySelector(".auth-toggle");
  if (toggle) toggle.style.visibility = "";
  const foot = document.getElementById("authFoot");
  if (foot) foot.textContent = isFirebaseConfigured()
    ? "Your account and progress sync through Firebase so you can sign in across devices."
    : "Accounts are stored on this device for now, so you can start using Pulse right away.";

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

function showForgotPassword() {
  authMode = "forgot";
  document.getElementById("authPassGroup")?.classList.add("hidden");
  document.getElementById("forgotPassWrap")?.classList.add("hidden");
  const toggle = document.querySelector(".auth-toggle");
  if (toggle) toggle.style.visibility = "hidden";
  const title = document.getElementById("authCardTitle");
  const sub = document.getElementById("authCardSubText");
  if (title) title.textContent = "Reset your password.";
  if (sub) sub.textContent = "Enter your email and we'll send a reset link.";
  document.getElementById("authBtn").textContent = "Send reset link";
  document.getElementById("authErr").classList.add("hidden");
  const foot = document.getElementById("authFoot");
  if (foot) foot.innerHTML = `<button type="button" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;color:var(--accent-text);padding:0" onclick="switchTab('in')">← Back to sign in</button>`;
}

async function sendPasswordReset() {
  const email = document.getElementById("authUser").value.trim();
  if (!email) return showAuthErr("Enter your email address first.");
  const btn = document.getElementById("authBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const resp = await fetch("/api/send-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    if (!data.sent) throw new Error(data.error || "Failed");
    showResetSentInline(email);
  } catch {
    showAuthErr("Couldn't send reset email — try again in a moment.");
    btn.disabled = false;
    btn.textContent = "Send reset link";
  }
}

function showResetSentInline(email) {
  // Stay on the landing page — just swap auth card content
  const toggle = document.querySelector(".auth-toggle");
  if (toggle) toggle.style.visibility = "hidden";
  const titleEl = document.getElementById("authCardTitle");
  const subEl   = document.getElementById("authCardSubText");
  if (titleEl) titleEl.textContent = "Check your inbox.";
  if (subEl)   subEl.textContent   = "";
  document.getElementById("authFields")?.classList.add("hidden");
  const success = document.getElementById("resetSuccessMsg");
  if (success) {
    document.getElementById("resetSuccessEmail").textContent = email;
    success.classList.remove("hidden");
  }
}

function showResetSentScreen(email) {
  document.getElementById("bootScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("verifyScreen")?.classList.add("hidden");
  document.getElementById("appWrap").classList.add("hidden");
  document.getElementById("mobNav")?.classList.add("hidden");
  const rs = document.getElementById("resetScreen");
  if (rs) rs.classList.remove("hidden");
  const emailEl = document.getElementById("resetEmail");
  if (emailEl) emailEl.textContent = email || "";
}

async function submitAuth() {
  if (authMode === "forgot") { await sendPasswordReset(); return; }

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
  } else if (result.needsVerification) {
    // onAuthStateChanged will call showVerifyScreen — just surface email status
    if (result.emailError) {
      toast("Account created but couldn't send verification email: " + result.emailError);
    }
    // emailSent === true is the happy path — verify screen appears via onAuthStateChanged
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
  document.getElementById("resetScreen")?.classList.add("hidden");
  initLandingReveal();
}

function initLandingReveal() {
  if (!window.IntersectionObserver) return;
  const els = document.querySelectorAll("#authScreen [data-reveal]");
  if (!els.length) return;
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("revealed");
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.1 }
  );
  els.forEach((el) => obs.observe(el));
}

function showApp() {
  syncAuthUI();
  document.getElementById("bootScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("verifyScreen")?.classList.add("hidden");
  document.getElementById("resetScreen")?.classList.add("hidden");
  document.getElementById("appWrap").classList.remove("hidden");
  document.getElementById("mobNav").classList.remove("hidden");
  applyTheme(S.settings.theme);
  syncUserUI();
  nav("dashboard");

  // Show toast if user just verified their email via the link
  const _params = new URLSearchParams(window.location.search);
  if (_params.get("verified") === "1") {
    setTimeout(() => toast("✅ Email verified — welcome to Pulse!"), 600);
    history.replaceState({}, "", window.location.pathname);
  }

  // Re-attach interval ticks for any timers that were running when state was loaded.
  // Compensate for time elapsed while the page was closed.
  const elapsed = S._savedAt ? Math.floor((Date.now() - S._savedAt) / 1000) : 0;
  if (elapsed > 0) {
    const pomo = getPomodoroTimer();
    if (pomo.running) pomo.remaining = Math.max(0, pomo.remaining - elapsed);
    const work = getWorkoutTimer();
    if (work.running) work.remaining = Math.max(0, work.remaining - elapsed);
    const study = getStudyTimer();
    if (study.running) study.remaining = Math.max(0, study.remaining - elapsed);
  }
  if (getPomodoroTimer().running) startPomodoroTimerTick();
  if (getWorkoutTimer().running) runWorkoutTimer();
  if (getStudyTimer().running) runStudyTimer();

  startReminderCheck();
  checkWeeklyDigest();

  // Feature 11: Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Ignore when typing in inputs / textareas / contenteditable
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    // Ignore modifier combos
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const PAGE_KEYS = { "1": "dashboard", "2": "habits", "3": "goals", "4": "workout", "5": "study", "6": "notes", "7": "ai" };
    if (PAGE_KEYS[e.key]) { e.preventDefault(); nav(PAGE_KEYS[e.key]); }
    else if (e.key === "a" || e.key === "A") { e.preventDefault(); toggleAI(); }
    else if (e.key === "?") { e.preventDefault(); showKeyboardHelp(); }
    else if (e.key === "Escape") { closeModal(); if (aiOpen) toggleAI(); }
  });

  // Feature 15: Dark mode schedule — start the schedule check
  startDarkScheduleCheck();
}

// Feature 15: Dark mode schedule
let darkScheduleTimer = null;

// Feature 16: Browser notification reminder
let reminderTimer = null;

function startReminderCheck() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminder, 60000);
}

function checkReminder() {
  const time = S.settings?.reminderTime;
  if (!time || Notification?.permission !== "granted") return;
  const now = getNow();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (hhmm === time) {
    const doneToday = S.habits.filter(h => h.logs && h.logs[getTodayStr()]).length;
    const total = S.habits.length;
    new Notification("Pulse check-in", {
      body: total > 0
        ? `${doneToday}/${total} habits done today. Keep the streak going! 🔥`
        : "Time to check in on your goals and habits.",
      icon: "/icon.svg",
    });
  }
}

async function requestNotificationAndSaveTime() {
  const timeInput = document.getElementById("reminderTimeInput");
  const timeVal = timeInput?.value || "";
  if (!timeVal) {
    S.settings.reminderTime = "";
    save();
    toast("Reminder removed");
    return;
  }
  if (Notification?.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Notification permission denied");
  }
  if (Notification?.permission !== "granted") return toast("Notifications not available");
  S.settings.reminderTime = timeVal;
  save();
  toast(`Daily reminder set for ${timeVal} ✓`);
}

// Feature 19: Weekly Digest
function checkWeeklyDigest() {
  const now = getNow();
  if (now.getDay() !== 1) return; // Only Monday
  const weekKey = `digest-${fmtDate(now)}`;
  const shown = sessionStorage.getItem(weekKey);
  if (shown) return;
  sessionStorage.setItem(weekKey, "1");
  // Show after a small delay so the UI has settled
  setTimeout(showWeeklyDigest, 1200);
}

function showWeeklyDigest() {
  const now = getNow();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (7 - i));
    return fmtDate(d);
  });
  const total = S.habits.length;
  let perfectDays = 0, totalChecks = 0;
  days.forEach(key => {
    const done = S.habits.filter(h => h.logs && h.logs[key] && h.logs[key] !== "skip").length;
    if (total > 0 && done === total) perfectDays++;
    totalChecks += done;
  });
  const completionRate = total > 0 ? Math.round((totalChecks / (total * 7)) * 100) : 0;
  const pomLog = S.tools?.pomodoroTimer?.sessionLog || [];
  const weekStudy = days.reduce((sum, key) => {
    const e = pomLog.find(e => e.date === key);
    return sum + (e?.focusMinutes || 0);
  }, 0);
  const grade = completionRate >= 80 ? "🌟 Outstanding week!" : completionRate >= 60 ? "💪 Strong week!" : completionRate >= 40 ? "📈 Building momentum" : "🌱 Every week is a fresh start";
  modal(`
    <div style="text-align:center;padding:8px 0 16px">
      <div style="font-size:32px;margin-bottom:8px">📊</div>
      <div class="modal-title">Weekly Review</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px">${grade}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
      <div class="week-stat-chip">
        <div class="week-stat-val">${completionRate}%</div>
        <div class="week-stat-label">Habit completion</div>
      </div>
      <div class="week-stat-chip">
        <div class="week-stat-val">${perfectDays}</div>
        <div class="week-stat-label">Perfect days</div>
      </div>
      <div class="week-stat-chip">
        <div class="week-stat-val">${weekStudy >= 60 ? Math.floor(weekStudy/60) + "h" : weekStudy + "m"}</div>
        <div class="week-stat-label">Study time</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal()">Start this week strong →</button>
    </div>
  `);
}

function startDarkScheduleCheck() {
  if (darkScheduleTimer) clearInterval(darkScheduleTimer);
  applyDarkSchedule();
  darkScheduleTimer = setInterval(applyDarkSchedule, 60000); // check every minute
}

function applyDarkSchedule() {
  const s = S.settings?.darkSchedule;
  if (!s?.enabled) return;
  const now = getNow();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const from = s.from || "20:00";
  const to   = s.to   || "07:00";
  let isDark;
  if (from > to) {
    // Crosses midnight (e.g., 20:00 → 07:00)
    isDark = hhmm >= from || hhmm < to;
  } else {
    isDark = hhmm >= from && hhmm < to;
  }
  const current = document.documentElement.getAttribute("data-theme");
  const target = isDark ? "dark" : "light";
  if (current !== target) document.documentElement.setAttribute("data-theme", target);
}

function showKeyboardHelp() {
  modal(`
    <div class="modal-title">Keyboard shortcuts</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 20px;align-items:center;font-size:13px;margin-bottom:16px">
      <kbd class="shortcut-key">1</kbd><span>Dashboard</span>
      <kbd class="shortcut-key">2</kbd><span>Habits</span>
      <kbd class="shortcut-key">3</kbd><span>Goals</span>
      <kbd class="shortcut-key">4</kbd><span>Workout</span>
      <kbd class="shortcut-key">5</kbd><span>Study</span>
      <kbd class="shortcut-key">6</kbd><span>Notebook</span>
      <kbd class="shortcut-key">7</kbd><span>Pulse AI</span>
      <kbd class="shortcut-key">A</kbd><span>Toggle AI panel</span>
      <kbd class="shortcut-key">?</kbd><span>This help screen</span>
      <kbd class="shortcut-key">Esc</kbd><span>Close modal / AI panel</span>
    </div>
    <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
  `);
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
    const resp = await fetch("/api/send-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, type: "verify" }),
    });
    const data = await resp.json();
    if (data.sent) {
      toast("Verification email resent — check your inbox");
    } else {
      throw new Error(data.error || "Failed");
    }
  } catch {
    toast("Could not resend — try again in a minute");
  }
}

async function deleteAccount() {
  if (!currentUser) return toast("Not signed in");
  if (!confirm("Permanently delete your account and ALL your data?\n\nThis cannot be undone.")) return;
  if (!confirm("Last chance — are you absolutely sure? Everything will be gone.")) return;
  try {
    const fb = await ensureFirebase();
    if (!fb) return toast("Not connected to Firebase");
    const idToken = await fb.authApi.getIdToken(fb.auth.currentUser);
    const resp = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Delete failed");
    toast("Account deleted");
    // onAuthStateChanged will fire with null and handle the signout flow
  } catch (err) {
    toast("Could not delete account: " + (err.message || "Unknown error"));
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
  if (darkScheduleTimer) { clearInterval(darkScheduleTimer); darkScheduleTimer = null; }
  if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
  if (stopwatchTick) { clearInterval(stopwatchTick); stopwatchTick = null; }
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
  aiPanelChats = {};
  aiPanelAnimatedPages = {};
  aiPageChats = [_makeAIChat("chat-default")];
  activePageChatId = aiPageChats[0].id;
  activeNotebookId = null;
  noteFilter = "notebook";
  notebookSearch = "";
  stopwatchRunning = false;
  stopwatchSeconds = 0;
  clearInterval(stopwatchTick);
  stopwatchTick = null;
  dashEditMode = false;
  dashDragSrc = null;
  flashcardDeckId = null;
  flashcardStudyMode = false;
  flashcardFlipped = false;
  flashcardAnswers = {};
  flashcardSessionDone = false;
  flashcardStartTime = null;
  flashcardSubset = null;
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

function habitLongestStreak(habit) {
  if (!habit.logs) return 0;
  const dates = Object.keys(habit.logs).filter(k => habit.logs[k]).sort();
  if (!dates.length) return 0;
  let longest = 1, current = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i-1]);
    const curr = new Date(dates[i]);
    const diff = Math.round((curr - prev) / 86400000);
    if (diff === 1) { current++; longest = Math.max(longest, current); }
    else if (diff > 1) current = 1;
  }
  return longest;
}

function habitTotalDone(habit) {
  if (!habit.logs) return 0;
  return Object.values(habit.logs).filter(v => v && v !== "skip").length;
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

function goalDueLabel(due) {
  if (!due) return "";
  // Compare by splitting into year/month/day to avoid timezone drift
  const todayStr = getTodayStr(); // YYYY-MM-DD
  const diff = Math.round((new Date(due) - new Date(todayStr)) / 86400000);
  if (diff < 0) return `<span style="color:var(--danger,#e5534b)">⚠ ${Math.abs(diff)}d overdue</span>`;
  if (diff === 0) return `<span style="color:var(--warning)">Due today</span>`;
  if (diff <= 3) return `<span style="color:var(--warning)">${diff}d left</span>`;
  return `${diff}d left`;
}

function goalCur(goal) {
  return (goal.logs || []).reduce((sum, log) => sum + log.value, 0);
}

function goalSparkline(goal) {
  const DAYS = 14;
  const today = new Date();
  const data = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    const dayVal = (goal.logs || [])
      .filter((l) => (l.date || "").startsWith(ds))
      .reduce((s, l) => s + (Number(l.value) || 0), 0);
    data.push(dayVal);
  }
  if (data.every((v) => v === 0)) return "";
  const max = Math.max(...data, 0.001);
  const W = 100, H = 28;
  const pts = data.map((v, i) => {
    const x = ((i / (DAYS - 1)) * W).toFixed(1);
    const y = (H - (v / max) * (H - 6) - 3).toFixed(1);
    return `${x},${y}`;
  }).join(" ");
  const area = `0,${H} ${pts} ${W},${H}`;
  const uid = goal.id.replace(/\W/g, "");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="goal-sparkline" aria-hidden="true">
    <defs>
      <linearGradient id="spk${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#spk${uid})"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
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
    requestAnimationFrame(() => { lastCreatedChatId = null; });
  }
  // Re-render the panel intro text so it reflects the new page context
  if (aiOpen) renderAIPanelMsgs();
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

function navDay(dir) {
  const base = historyDate || getTodayStr();
  const d = new Date(base + "T00:00:00");
  d.setDate(d.getDate() + dir);
  historyDate = fmtDate(d);
  rerenderPage();
}

function jumpToToday() {
  historyDate = "";
  historyYear = null;
  historyMonth = null;
  rerenderPage();
}

function navMonth(dir) {
  const now = new Date();
  let y = historyYear !== null ? historyYear : now.getFullYear();
  let m = historyMonth !== null ? historyMonth : now.getMonth();
  m += dir;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  historyYear = y;
  historyMonth = m;
  rerenderPage();
}

function rerenderPage() {
  // Preserve the notebook textarea's unsaved content and user-resized height
  // across re-renders triggered by onSnapshot (Firebase sync echo) or saves.
  const nbEl = document.getElementById("notebookBody");
  const savedContent    = nbEl ? nbEl.value : null;
  const savedHeight     = nbEl ? nbEl.style.height : null;
  // Read the notebook ID from the DOM attribute — NOT from activeNotebookId.
  // switchNotebook() sets activeNotebookId to the NEW id before calling us,
  // so using the DOM attribute is the only way to know which notebook was
  // showing before the render and avoid bleeding unsaved content across notebooks.
  const savedNotebookId = nbEl ? (nbEl.dataset.notebookId || null) : null;
  if (savedHeight) notebookBodyHeight = savedHeight;

  // Preserve scratchpad textarea mid-typing
  const spEl = document.querySelector(".scratch-pad");
  const savedScratch = spEl ? spEl.value : null;

  renderCurrentPage(false);

  const nbElAfter = document.getElementById("notebookBody");
  if (nbElAfter) {
    if (savedContent !== null && savedNotebookId === activeNotebookId) {
      nbElAfter.value = savedContent;
    }
    if (notebookBodyHeight) nbElAfter.style.height = notebookBodyHeight;
  }

  // Restore scratchpad content (debounce save means it may not yet be in S)
  const spAfter = document.querySelector(".scratch-pad");
  if (spAfter && savedScratch !== null) spAfter.value = savedScratch;
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

// Feature 14: Log completed workout session + personal records
function logCompletedWorkout() {
  const timer = getWorkoutTimer();
  const totalSecs = getWorkoutTotalDuration(timer);
  const today = getTodayStr();
  if (!S.tools.workoutLog) S.tools.workoutLog = [];
  S.tools.workoutLog.push({
    date: today,
    exercises: timer.exercises.map(e => ({ name: e.name, work: e.work })),
    totalSeconds: totalSecs,
  });
  // Check for personal record (fastest total time for this exercise set)
  const prKey = timer.exercises.map(e => e.name).join("|");
  if (!S.tools.personalRecords) S.tools.personalRecords = {};
  const prevPR = S.tools.personalRecords[prKey];
  if (!prevPR || totalSecs <= prevPR.totalSeconds) {
    S.tools.personalRecords[prKey] = { totalSeconds: totalSecs, date: today };
    if (!prevPR) {
      toast("Workout logged! First time tracking this routine 🏋️");
    } else {
      celebrateToast("🏆 Personal record! Fastest time for this routine!");
    }
  } else {
    toast(`Workout logged! PR is ${fmtTimer(prevPR.totalSeconds)} (${prevPR.date})`);
  }
  save();
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


// ── Feature 2: Stopwatch (Focus Timer) ──────────────────────────────────────
let stopwatchRunning = false;
let stopwatchSeconds = 0;
let stopwatchTick = null;

function startStopwatch() {
  stopwatchRunning = true;
  stopwatchTick = setInterval(() => {
    stopwatchSeconds++;
    const el = document.getElementById("stopwatchDisplay");
    if (el) el.textContent = fmtTimer(stopwatchSeconds);
  }, 1000);
  rerenderPage();
}

function pauseStopwatch() {
  stopwatchRunning = false;
  clearInterval(stopwatchTick);
  stopwatchTick = null;
  rerenderPage();
}

function resetStopwatch() {
  stopwatchRunning = false;
  stopwatchSeconds = 0;
  clearInterval(stopwatchTick);
  stopwatchTick = null;
  rerenderPage();
}

function renderStopwatchCard() {
  const fmtSec = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
                 : `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  // Feature 3: Daily study goal progress
  const goalMins = S.tools?.studyGoal?.dailyMinutes || 0;
  const todayEntry = (S.tools.pomodoroTimer?.sessionLog || []).find(e => e.date === getTodayStr());
  const studiedMins = (todayEntry?.focusMinutes || 0) + Math.floor(stopwatchSeconds / 60);
  const goalPct = goalMins > 0 ? Math.min(100, Math.round((studiedMins / goalMins) * 100)) : 0;

  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">Stopwatch</div>
          <div class="workspace-tool-sub">Track open-ended sessions. No pressure, just time.</div>
        </div>
        <div class="workspace-timer-display" id="stopwatchDisplay">${fmtSec(stopwatchSeconds)}</div>
      </div>
      <div class="workspace-tool-row">
        <div class="workspace-tool-status">${stopwatchRunning ? "Counting…" : stopwatchSeconds > 0 ? `Paused at ${fmtSec(stopwatchSeconds)}` : "Ready"}</div>
        <div class="workspace-tool-actions">
          ${stopwatchRunning
            ? `<button class="btn btn-outline btn-sm" onclick="pauseStopwatch()">Pause</button>`
            : `<button class="btn btn-outline btn-sm" onclick="startStopwatch()">Start</button>`}
          <button class="btn btn-ghost btn-sm" onclick="resetStopwatch()">Reset</button>
        </div>
      </div>
      ${goalMins > 0 ? `
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:var(--text2)">Daily goal: ${goalMins} min</span>
            <span style="font-size:12px;font-weight:700;color:${goalPct>=100?"var(--success)":"var(--accent)"}">${studiedMins}/${goalMins} min · ${goalPct}%</span>
          </div>
          <div class="prog-track"><div class="prog-fill" style="width:${goalPct}%;background:${goalPct>=100?"var(--success)":"var(--accent)"}"></div></div>
        </div>
      ` : `
        <div style="margin-top:10px;font-size:12px;color:var(--text3)">
          Set a daily study goal in
          <button class="btn btn-ghost btn-sm" style="font-size:12px;padding:0 4px;height:auto" onclick="openStudyGoalModal()">settings</button>
        </div>
      `}
    </div>
  `;
}

function openStudyGoalModal() {
  const current = S.tools?.studyGoal?.dailyMinutes || 0;
  modal(`
    <div class="modal-title">Daily study goal</div>
    <div class="form-group">
      <label class="form-label">Target minutes per day</label>
      <input id="studyGoalInput" class="form-input" type="number" min="0" max="600" value="${current}" placeholder="e.g. 60">
      <div class="form-hint">Set to 0 to remove the goal. Tracks combined Pomodoro + Stopwatch time.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveStudyGoal()">Save</button>
    </div>
  `);
}

function saveStudyGoal() {
  const val = Math.max(0, parseInt(document.getElementById("studyGoalInput").value) || 0);
  if (!S.tools.studyGoal) S.tools.studyGoal = { dailyMinutes: 0 };
  S.tools.studyGoal.dailyMinutes = val;
  save();
  closeModal();
  rerenderPage();
  toast(val > 0 ? `Daily goal set: ${val} min` : "Study goal removed");
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
            <button class="btn btn-outline btn-sm" onclick="logCompletedWorkout()" title="Log this session as complete">Log</button>
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
        // Record completed focus session (include current subject if set)
        const today = getTodayStr();
        if (!Array.isArray(t.sessionLog)) t.sessionLog = [];
        const entry = t.sessionLog.find((e) => e.date === today);
        const subject = S.tools.studySubject || "";
        if (entry) {
          entry.sessions += 1;
          entry.focusMinutes += t.duration;
          if (subject) {
            if (!entry.subjects) entry.subjects = {};
            entry.subjects[subject] = (entry.subjects[subject] || 0) + t.duration;
          }
        } else {
          const newEntry = { date: today, sessions: 1, focusMinutes: t.duration };
          if (subject) newEntry.subjects = { [subject]: t.duration };
          t.sessionLog.push(newEntry);
        }
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
  if (flashcardSessionDone) return renderFlashcardSummary(deck);

  const cards = flashcardSubset
    ? flashcardSubset.map((i) => deck.cards[i]).filter(Boolean)
    : deck.cards;
  const card = cards[flashcardCardIndex];
  if (!card) { flashcardSessionDone = true; return renderFlashcardSummary(deck); }

  const isFirst = flashcardCardIndex === 0;
  const isLast  = flashcardCardIndex === cards.length - 1;
  const answered = flashcardAnswers[flashcardCardIndex] !== undefined;
  const correctSoFar = Object.values(flashcardAnswers).filter(v => v === 2).length;
  const wrongSoFar   = Object.values(flashcardAnswers).filter(v => v === 0).length;
  const progressPct  = Math.round((flashcardCardIndex / cards.length) * 100);

  return `
    <div class="workspace-tool surface-card">
      <div class="workspace-tool-head">
        <div>
          <div class="workspace-tool-title">${esc(deck.name)}${flashcardSubset ? ' <span style="font-size:11px;color:var(--accent);font-weight:600">RETRY</span>' : ""}</div>
          <div class="workspace-tool-sub">${flashcardCardIndex + 1} / ${cards.length} &nbsp;·&nbsp; <span style="color:#0c9b6b">✓ ${correctSoFar}</span> &nbsp;<span style="color:#e05252">✗ ${wrongSoFar}</span></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="shuffleFlashcards('${deck.id}')">Shuffle</button>
          <button class="btn btn-ghost btn-sm" onclick="exitFlashcardStudy()">Exit</button>
        </div>
      </div>
      <div class="fc-progress-wrap">
        <div class="fc-progress-bar" style="width:${progressPct}%"></div>
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
        ${answered
          ? `<button class="btn btn-outline btn-sm" onclick="${isLast ? "flashcardShowSummary()" : `nextFlashcard('${deck.id}')`}">
               ${isLast ? "See results →" : "Next →"}
             </button>`
          : `<div class="fc-answer-btns">
               <button class="btn fc-missed-btn" onclick="answerFlashcard('${deck.id}',0)" title="Didn't know it">✗ Missed</button>
               <button class="btn fc-almost-btn" onclick="answerFlashcard('${deck.id}',1)" title="Almost had it">~ Almost</button>
               <button class="btn fc-correct-btn" onclick="answerFlashcard('${deck.id}',2)" title="Knew it confidently">✓ Know it</button>
             </div>`
        }
      </div>
    </div>
  `;
}

function renderFlashcardSummary(deck) {
  const cards = flashcardSubset
    ? flashcardSubset.map((i) => deck.cards[i]).filter(Boolean)
    : deck.cards;
  const total   = cards.length;
  const correct = Object.values(flashcardAnswers).filter(v => v === 2).length;
  const almost  = Object.values(flashcardAnswers).filter(v => v === 1).length;
  const pct   = total ? Math.round((correct / total) * 100) : 0;
  const grade = pct === 100 ? "Perfect! 🎉" : pct >= 80 ? "Great work! 🙌" : pct >= 60 ? "Good effort 💪" : pct >= 40 ? "Keep at it 📖" : "Needs practice 🔁";

  const elapsed = flashcardStartTime ? Math.round((Date.now() - flashcardStartTime) / 1000) : 0;
  const timeStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  const correctCards = cards.filter((_, i) => flashcardAnswers[i] === 2);
  const almostCards  = cards.filter((_, i) => flashcardAnswers[i] === 1);
  const wrongCards   = cards.filter((_, i) => flashcardAnswers[i] === 0);
  const wrong        = wrongCards.length; // referenced in fc-stat template below

  return `
    <div class="workspace-tool surface-card">
      <div class="fc-summary">
        <div class="fc-summary-grade">${grade}</div>
        <div class="fc-summary-score">${correct}<span class="fc-summary-denom">/${total}</span></div>
        <div class="fc-summary-pct">${pct}% correct &nbsp;·&nbsp; ${timeStr} &nbsp;·&nbsp; ${total} card${total !== 1 ? "s" : ""}</div>
        <div class="fc-summary-bar-wrap">
          <div class="fc-summary-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="fc-summary-stats">
          <div class="fc-stat fc-stat-correct">
            <div class="fc-stat-num">${correct}</div>
            <div class="fc-stat-label">Correct</div>
          </div>
          <div class="fc-stat fc-stat-wrong">
            <div class="fc-stat-num">${wrong}</div>
            <div class="fc-stat-label">Wrong</div>
          </div>
          <div class="fc-stat">
            <div class="fc-stat-num">${pct}%</div>
            <div class="fc-stat-label">Score</div>
          </div>
          <div class="fc-stat">
            <div class="fc-stat-num">${timeStr}</div>
            <div class="fc-stat-label">Time</div>
          </div>
        </div>
        ${wrongCards.length > 0 ? `
          <div class="fc-summary-section">
            <div class="fc-summary-section-hd fc-section-wrong">✗ Missed (${wrongCards.length})</div>
            <div class="fc-summary-items">
              ${wrongCards.map((c) => `<div class="fc-summary-item fc-item-wrong">${esc(c.front)}</div>`).join("")}
            </div>
          </div>
        ` : ""}
        ${almostCards.length > 0 ? `
          <div class="fc-summary-section">
            <div class="fc-summary-section-hd" style="color:var(--warning)">~ Almost (${almostCards.length})</div>
            <div class="fc-summary-items">
              ${almostCards.map((c) => `<div class="fc-summary-item" style="background:rgba(194,122,24,0.08);color:var(--warning)">${esc(c.front)}</div>`).join("")}
            </div>
          </div>
        ` : ""}
        ${correctCards.length > 0 ? `
          <div class="fc-summary-section">
            <div class="fc-summary-section-hd fc-section-correct">✓ Know it (${correctCards.length})</div>
            <div class="fc-summary-items">
              ${correctCards.map((c) => `<div class="fc-summary-item fc-item-correct">${esc(c.front)}</div>`).join("")}
            </div>
          </div>
        ` : ""}
        <div class="fc-summary-actions">
          ${wrongCards.length > 0 ? `<button class="btn btn-primary btn-sm" onclick="retryWrongCards('${deck.id}')">Retry wrong (${wrongCards.length})</button>` : ""}
          <button class="btn btn-outline btn-sm" onclick="startFlashcardStudy('${deck.id}')">Restart deck</button>
          <button class="btn btn-ghost btn-sm" onclick="exitFlashcardStudy()">Exit</button>
        </div>
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
  if (flashcardDeckId === id) {
    flashcardDeckId = null; flashcardStudyMode = false;
    flashcardAnswers = {}; flashcardSessionDone = false;
    flashcardStartTime = null; flashcardSubset = null;
  }
  save();
  rerenderPage();
  toast("Deck deleted");
}

function startFlashcardStudy(deckId) {
  flashcardDeckId    = deckId;
  flashcardCardIndex = 0;
  flashcardFlipped   = false;
  flashcardStudyMode = true;
  flashcardAnswers   = {};
  flashcardSessionDone = false;
  flashcardStartTime = Date.now();
  flashcardSubset    = null;
  rerenderPage();
}

function exitFlashcardStudy() {
  flashcardStudyMode   = false;
  flashcardFlipped     = false;
  flashcardAnswers     = {};
  flashcardSessionDone = false;
  flashcardStartTime   = null;
  flashcardSubset      = null;
  rerenderPage();
}

function flashcardShowSummary() {
  flashcardSessionDone = true;
  rerenderPage();
}

// confidence: 0=missed, 1=almost, 2=know it  (old boolean also accepted for back-compat)
function answerFlashcard(deckId, confidence) {
  const conf = confidence === true ? 2 : confidence === false ? 0 : Number(confidence);
  flashcardAnswers[flashcardCardIndex] = conf; // 0/1/2
  const deck = getFlashcardDecks().find((d) => d.id === deckId);
  if (!deck) return;
  const cards = flashcardSubset
    ? flashcardSubset.map((i) => deck.cards[i]).filter(Boolean)
    : deck.cards;
  if (flashcardCardIndex >= cards.length - 1) {
    flashcardSessionDone = true;
  } else {
    flashcardCardIndex++;
    flashcardFlipped = false;
  }
  rerenderPage();
}

function retryWrongCards(deckId) {
  const deck = getFlashcardDecks().find((d) => d.id === deckId);
  if (!deck) return;
  // Retry missed (0) and almost (1) cards
  const wrongIdxs = Object.keys(flashcardAnswers)
    .filter((i) => flashcardAnswers[Number(i)] < 2)
    .map(Number);
  // Map back through any existing subset so we keep original deck indices
  flashcardSubset      = flashcardSubset ? wrongIdxs.map((i) => flashcardSubset[i]).filter((v) => v !== undefined) : wrongIdxs;
  flashcardCardIndex   = 0;
  flashcardAnswers     = {};
  flashcardFlipped     = false;
  flashcardSessionDone = false;
  flashcardStartTime   = Date.now();
  rerenderPage();
  toast(`Retrying ${wrongIdxs.length} card${wrongIdxs.length !== 1 ? "s" : ""}`);
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
  if (!deck) return;
  const cards = flashcardSubset ? flashcardSubset.map((i) => deck.cards[i]).filter(Boolean) : deck.cards;
  if (flashcardCardIndex >= cards.length - 1) return;
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
  flashcardCardIndex   = 0;
  flashcardFlipped     = false;
  flashcardAnswers     = {};
  flashcardSessionDone = false;
  flashcardStartTime   = Date.now();
  flashcardSubset      = null;
  save();
  rerenderPage();
  toast("Deck shuffled — fresh session started");
}

function renderPomodoroTimerCard() {
  const t = getPomodoroTimer();
  const phaseLabels = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };
  const dots = Array.from({ length: t.sessionsBeforeLong }, (_, i) =>
    `<span class="pomo-dot${i < t.completed ? " done" : ""}"></span>`
  ).join("");

  // Session history — last 7 days
  const log = Array.isArray(t.sessionLog) ? t.sessionLog : [];
  const today = getTodayStr();
  const todayEntry = log.find((e) => e.date === today);
  const todaySessions = todayEntry?.sessions || 0;
  const todayMins = todayEntry?.focusMinutes || 0;

  const sevenDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const ds = fmtDate(d);
    const entry = log.find((e) => e.date === ds);
    return { ds, sessions: entry?.sessions || 0, mins: entry?.focusMinutes || 0,
             label: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()] };
  });
  const weekSessions = sevenDays.reduce((s, d) => s + d.sessions, 0);
  const weekMins = sevenDays.reduce((s, d) => s + d.mins, 0);
  const maxSessions = Math.max(...sevenDays.map((d) => d.sessions), 1);

  const fmtMins = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;

  const historyHtml = `
    <div class="pomo-history">
      <div class="pomo-history-stats">
        <div class="pomo-hstat">
          <div class="pomo-hstat-val">${todaySessions}</div>
          <div class="pomo-hstat-label">Today${todayMins ? ` · ${fmtMins(todayMins)}` : ""}</div>
        </div>
        <div class="pomo-hstat">
          <div class="pomo-hstat-val">${weekSessions}</div>
          <div class="pomo-hstat-label">This week${weekMins ? ` · ${fmtMins(weekMins)}` : ""}</div>
        </div>
      </div>
      <div class="pomo-bar-chart">
        ${sevenDays.map((d) => `
          <div class="pomo-bar-col">
            <div class="pomo-bar-wrap">
              <div class="pomo-bar-fill${d.ds === today ? " today" : ""}" style="height:${d.sessions ? Math.max(8, Math.round((d.sessions / maxSessions) * 52)) : 0}px" title="${d.sessions} session${d.sessions !== 1 ? "s" : ""}"></div>
            </div>
            <div class="pomo-bar-label">${d.label}</div>
          </div>`).join("")}
      </div>
    </div>
  `;

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

      <!-- Subject tag selector -->
      <div class="pomo-subject-row">
        <span class="pomo-subject-label">Studying:</span>
        ${["General","Maths","Science","Coding","History","Languages","Other"].map(s =>
          `<button class="pomo-subject-chip${(S.tools.studySubject||"General")===s?" active":""}" onclick="setStudySubject('${s}')">${s}</button>`
        ).join("")}
      </div>

      ${weekSessions > 0 || todaySessions > 0 ? historyHtml : ""}

      ${(()=>{
        // Subject breakdown for today
        const subjects = todayEntry?.subjects || {};
        const keys = Object.keys(subjects);
        if (!keys.length) return "";
        return `<div class="pomo-subject-breakdown">
          <div class="pomo-subject-breakdown-title">Today's focus breakdown</div>
          ${keys.sort((a,b)=>subjects[b]-subjects[a]).map(k=>
            `<div class="pomo-subject-row-item">
              <span class="pomo-subject-name">${esc(k)}</span>
              <div class="pomo-subject-bar-wrap">
                <div class="pomo-subject-bar" style="width:${Math.round((subjects[k]/Math.max(...Object.values(subjects)))*100)}%"></div>
              </div>
              <span class="pomo-subject-mins">${fmtMins(subjects[k])}</span>
            </div>`
          ).join("")}
        </div>`;
      })()}
    </div>
  `;
}

// Feature 6: Water tracker
function logWater(glasses) {
  if (!S.tools.water) S.tools.water = { target: 8, log: {} };
  if (!S.tools.water.log) S.tools.water.log = {};
  const today = getTodayStr();
  S.tools.water.log[today] = glasses;
  save();
  rerenderPage();
  if (glasses >= S.tools.water.target) celebrateToast("💧 Hydration goal reached!");
}

// Feature 7: Mood journal
// Feature 18: Scratchpad
let scratchpadTimer = null;
function saveScratchpad(value) {
  clearTimeout(scratchpadTimer);
  scratchpadTimer = setTimeout(() => {
    if (!S.tools) S.tools = defaultState().tools;
    S.tools.scratchpad = value;
    save();
  }, 800); // debounce 800ms so we don't hammer Firestore while typing
}

function logMood(rating) {
  if (!S.tools.mood) S.tools.mood = [];
  const today = getTodayStr();
  const existing = S.tools.mood.find(m => m.date === today);
  if (existing) {
    existing.rating = rating;
  } else {
    S.tools.mood.push({ date: today, rating, note: "" });
  }
  save();
  rerenderPage();
  const labels = ["Rough","Low","Okay","Good","Great"];
  toast(`Mood logged: ${labels[rating-1]}`);
}

function setStudySubject(subject) {
  if (!S.tools) S.tools = {};
  S.tools.studySubject = subject;
  save();
  rerenderPage();
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

  const catHeroHtml = `
    <div class="cat-hero" style="--cat-color:${category.color}">
      <div class="cat-hero-icon">${category.emoji}</div>
      <div class="cat-hero-body">
        <div class="cat-hero-title">${category.label}</div>
        <div class="cat-hero-sub">${doneToday} of ${habits.length} habit${habits.length !== 1 ? "s" : ""} done today · ${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""}</div>
      </div>
      <div class="cat-hero-kpis">
        <div class="page-kpi"><div class="page-kpi-val" style="color:var(--cat-color)">${doneToday}/${habits.length}</div><div class="page-kpi-label">Today</div></div>
        <div class="page-kpi"><div class="page-kpi-val">${goalPct}%</div><div class="page-kpi-label">Goals</div></div>
      </div>
    </div>
  `;

  // ── Study: two-column layout ─────────────────────────────────────────────
  if (categoryId === "study") {
    return `
      ${catHeroHtml}
      <div class="page-layout" style="align-items:start">
        <div class="page-main">
          ${renderPomodoroTimerCard()}
          ${renderFlashcardWidget()}
        </div>
        <aside class="page-side">
          ${renderStopwatchCard()}
          ${renderStudyTimerCard()}
          ${renderChecklistCard()}
          ${habits.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Study habits</span>
                <button class="sec-action" style="margin:0" onclick="nav('habits')">All →</button>
              </div>
              ${habits.map((h) => habitRow(h, false)).join("")}
            </div>
          ` : ""}
          ${activeGoals.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Goals · ${goalPct}%</span>
                <button class="sec-action" style="margin:0" onclick="nav('goals')">All →</button>
              </div>
              <div class="dash-side-list">
                ${activeGoals.slice(0, 4).map((g) => `
                  <div class="dash-mini-row">
                    <div>
                      <strong>${esc(g.icon)} ${esc(g.name)}</strong>
                      <span>${goalCur(g)} / ${g.target} ${esc(g.unit)}</span>
                    </div>
                    <span style="font-weight:800;font-size:13px;color:var(--accent)">${Math.round((goalCur(g) / g.target) * 100)}%</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
          ${notes.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Recent activity</span>
                <button class="sec-action" style="margin:0" onclick="nav('notes')">Notes →</button>
              </div>
              <div class="dash-side-list">
                ${notes.slice(0, 3).map((n) => `
                  <div class="dash-mini-row">
                    <strong style="font-size:12px">${esc(n.title || n.goalName || "Activity note")}</strong>
                    <span>${n.date || ""}</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
        </aside>
      </div>
    `;
  }

  // ── Workout: two-column layout ──────────────────────────────────────────
  if (categoryId === "workout") {
    return `
      ${catHeroHtml}
      <div class="page-layout" style="align-items:start">
        <div class="page-main">
          ${renderWorkoutTimerCard()}
        </div>
        <aside class="page-side">
          ${hasContent ? `
            <div class="page-side-card">
              <div class="page-side-kicker">Today</div>
              <div class="dash-side-list">
                <div class="dash-mini-row">
                  <strong>Habits done</strong>
                  <span>${doneToday} / ${habits.length}</span>
                </div>
                <div class="dash-mini-row">
                  <strong>Active goals</strong>
                  <span>${activeGoals.length}${goalPct ? ` · ${goalPct}%` : ""}</span>
                </div>
                ${notes.length ? `
                  <div class="dash-mini-row">
                    <strong>Activity logged</strong>
                    <span>${notes.length} note${notes.length !== 1 ? "s" : ""}</span>
                  </div>` : ""}
              </div>
            </div>
          ` : ""}
          ${habits.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Workout habits</span>
                <button class="sec-action" style="margin:0" onclick="nav('habits')">All →</button>
              </div>
              ${habits.map((h) => habitRow(h, false)).join("")}
            </div>
          ` : ""}
          ${activeGoals.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Goals · ${goalPct}%</span>
                <button class="sec-action" style="margin:0" onclick="nav('goals')">All →</button>
              </div>
              <div class="dash-side-list">
                ${activeGoals.slice(0, 4).map((g) => `
                  <div class="dash-mini-row">
                    <div>
                      <strong>${esc(g.icon)} ${esc(g.name)}</strong>
                      <span>${goalCur(g)} / ${g.target} ${esc(g.unit)}</span>
                    </div>
                    <span style="font-weight:800;font-size:13px;color:var(--accent)">${Math.round((goalCur(g) / g.target) * 100)}%</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
          ${notes.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker" style="display:flex;justify-content:space-between;align-items:center">
                <span>Recent activity</span>
                <button class="sec-action" style="margin:0" onclick="nav('notes')">Notes →</button>
              </div>
              <div class="dash-side-list">
                ${notes.slice(0, 3).map((n) => `
                  <div class="dash-mini-row">
                    <strong style="font-size:12px">${esc(n.title || n.goalName || "Activity note")}</strong>
                    <span>${n.date || ""}</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
        </aside>
      </div>
    `;
  }

  // ── Other categories: flat layout ────────────────────────────────────────
  return `
    ${catHeroHtml}

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

// ─── MINI RING SVG UTILITY ────────────────────────────────────────────────────
// Returns an inline SVG progress ring. size = diameter in px.
function miniRing(pct, color, size = 36, strokeWidth = 3.5) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const safeP = Math.min(100, Math.max(0, pct));
  const offset = circ - (circ * safeP / 100);
  const c = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeWidth}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
      stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${c} ${c})"
      style="transition:stroke-dashoffset .6s ease"/>
  </svg>`;
}

// ─── DASHBOARD WIDGET SYSTEM — 2-column Apple-style grid ─────────────────────
//
// Each widget: { id, col, row, w, h, hidden }
//   col  : 1 or 2 (grid column start)
//   row  : 1‥N    (grid row start — explicit so any widget can sit anywhere)
//   w    : 1=half-width  2=full-width
//   h    : always 1 (height is content-driven)
//   hidden: bool
//
// COLS = 2 — matches CSS grid-template-columns: 1fr 1fr

const WIDGET_DEFS = [
  { id: "ring",      label: "Progress"          },
  { id: "habits",    label: "Today's habits"    },
  { id: "score",     label: "Today's score"     },
  { id: "goals",     label: "Goals in progress" },
  { id: "quote",     label: "Quote of the day"  },
  { id: "water",     label: "Hydration"         },
  { id: "mood",      label: "Mood check-in"     },
  { id: "notebook",  label: "Notebook preview"  },
  { id: "scratchpad",label: "Quick notes"       },
  { id: "ai",        label: "Pulse AI"          },
  { id: "glance",    label: "Today at a glance" },
];

// Default grid layout — tweak rows to taste
const DEFAULT_WIDGET_LAYOUT = [
  { id: "ring",       col: 1, row: 1, w: 2, h: 1, hidden: false },
  { id: "habits",     col: 1, row: 2, w: 1, h: 1, hidden: false },
  { id: "score",      col: 2, row: 2, w: 1, h: 1, hidden: false },
  { id: "goals",      col: 1, row: 3, w: 1, h: 1, hidden: false },
  { id: "quote",      col: 2, row: 3, w: 1, h: 1, hidden: false },
  { id: "water",      col: 1, row: 4, w: 1, h: 1, hidden: false },
  { id: "mood",       col: 2, row: 4, w: 1, h: 1, hidden: false },
  { id: "notebook",   col: 1, row: 5, w: 2, h: 1, hidden: false },
  { id: "scratchpad", col: 1, row: 6, w: 1, h: 1, hidden: false },
  { id: "ai",         col: 2, row: 6, w: 1, h: 1, hidden: false },
  { id: "glance",     col: 1, row: 7, w: 2, h: 1, hidden: false },
];

function getDashWidgets() {
  const saved = S.settings?.dashboardWidgets;
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_WIDGET_LAYOUT.map(w => ({ ...w }));
  const known = new Set(saved.map(w => w.id));
  // Add any newly-defined widgets below saved ones
  const extras = DEFAULT_WIDGET_LAYOUT
    .filter(w => !known.has(w.id))
    .map((w, i) => {
      // Place new widgets at the bottom of the grid
      const maxRow = saved.reduce((m, sw) => Math.max(m, (sw.row || 1) + (sw.h || 1) - 1), 1);
      return { ...w, row: maxRow + 1 + i };
    });
  // Normalise old entries (migrate from span/size format)
  const normalised = saved.map(w => ({
    id: w.id,
    col: w.col ?? 1,
    row: w.row ?? 1,
    w:   w.w ?? w.span ?? w.size ?? 1,
    h:   w.h ?? 1,
    hidden: !!w.hidden,
  }));
  return [...normalised, ...extras];
}

// ─── DAILY QUOTE (Feature 5) ─────────────────────────────────────────────────
const DAILY_QUOTES = [
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["Small daily improvements over time lead to stunning results.", "Robin Sharma"],
  ["Don't watch the clock; do what it does. Keep going.", "Sam Levenson"],
  ["The only way to do great work is to love what you do.", "Steve Jobs"],
  ["Discipline is choosing between what you want now and what you want most.", "Abraham Lincoln"],
  ["Success is the sum of small efforts, repeated day in and day out.", "Robert Collier"],
  ["You don't have to be great to start, but you have to start to be great.", "Zig Ziglar"],
  ["Motivation is what gets you started. Habit is what keeps you going.", "Jim Ryun"],
  ["We are what we repeatedly do. Excellence is not an act, but a habit.", "Aristotle"],
  ["It does not matter how slowly you go as long as you do not stop.", "Confucius"],
  ["The future depends on what you do today.", "Mahatma Gandhi"],
  ["Consistency is the key to achieving and maintaining momentum.", "Darren Hardy"],
  ["Progress, not perfection.", "Unknown"],
  ["One day or day one. You decide.", "Unknown"],
  ["Show up. Even when you don't feel like it.", "Unknown"],
  ["A little progress each day adds up to big results.", "Satya Nani"],
  ["Your habits will determine your future.", "Jack Canfield"],
  ["The difference between ordinary and extraordinary is that little extra.", "Jimmy Johnson"],
  ["Hard work beats talent when talent doesn't work hard.", "Tim Notke"],
  ["Fall seven times, stand up eight.", "Japanese Proverb"],
  ["You are one decision away from a completely different life.", "Unknown"],
  ["The pain of discipline is far less than the pain of regret.", "Unknown"],
  ["Success is not final; failure is not fatal. It is the courage to continue.", "Winston Churchill"],
  ["Do something today that your future self will thank you for.", "Unknown"],
  ["Every master was once a disaster.", "T. Harv Eker"],
  ["The best time to plant a tree was 20 years ago. The second best time is now.", "Chinese Proverb"],
  ["Believe you can and you're halfway there.", "Theodore Roosevelt"],
  ["Your only limit is your mind.", "Unknown"],
  ["Dream big. Start small. Act now.", "Unknown"],
  ["The journey of a thousand miles begins with a single step.", "Lao Tzu"],
];

function getDailyQuote() {
  // Pick a quote based on the day of year so it stays consistent all day
  const d = getNow();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}

// ─── WEEK STRIP ───────────────────────────────────────────────────────────────
// Returns a 7-day Mon→today completion strip for the dashboard panel.
function weekStrip() {
  if (!S.habits.length) return "";
  const total = S.habits.length;
  const now = getNow();
  const todayKey = getTodayStr(); // uses fmtDate (UTC ISO) — same as habit log keys
  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = fmtDate(d); // UTC — consistent with how habit logs are stored
    const done = S.habits.filter(h => h.logs && h.logs[key] === true).length;
    const pct = Math.round((done / total) * 100);
    // Level 0 = nothing, 1 = some (<40%), 2 = half (40-74%), 3 = most (75-99%), 4 = full (100%)
    const level = done === 0 ? 0 : pct >= 100 ? 4 : pct >= 75 ? 3 : pct >= 40 ? 2 : 1;
    days.push({ label: DAY_LABELS[d.getDay()], key, pct, done, total, isToday: key === todayKey, level });
  }
  return `
    <div class="week-strip">
      <div class="week-strip-label">This week</div>
      <div class="week-strip-days">
        ${days.map(d => `
          <div class="week-day${d.isToday ? " week-day--today" : ""}">
            <div class="week-dot week-dot--${d.level}" title="${d.done}/${d.total} habits · ${d.key}"></div>
            <div class="week-day-label">${d.label}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ─── DASHBOARD WIDGET SYSTEM ──────────────────────────────────────────────────
let dashEditMode = false;
let dashDragSrc = null;

function toggleWidgetEditMode() {
  dashEditMode = !dashEditMode;
  const btn = document.getElementById("dashCustomizeBtn");
  if (btn) btn.title = dashEditMode ? "Done customizing" : "Customize home layout";
  rerenderPage();
}

function toggleWidgetSize(id) {
  const widgets = getDashWidgets();
  const wid = widgets.find(w => w.id === id);
  if (!wid) return;
  if (wid.w === 1) {
    // Expand to full-width: move to col 1
    wid.w = 2; wid.col = 1;
  } else {
    // Shrink to half: keep col 1
    wid.w = 1;
  }
  S.settings.dashboardWidgets = widgets;
  save();
  rerenderPage();
}

function hideWidget(id) {
  const widgets = getDashWidgets();
  const wid = widgets.find(w => w.id === id);
  if (wid) wid.hidden = true;
  S.settings.dashboardWidgets = widgets;
  save();
  rerenderPage();
}

function showWidgetById(id) {
  const widgets = getDashWidgets();
  const wid = widgets.find(w => w.id === id);
  if (wid) wid.hidden = false;
  S.settings.dashboardWidgets = widgets;
  save();
  rerenderPage();
}

// ── 2-D pointer drag ─────────────────────────────────────────────────────────
let gridDrag = null;
// { id, el, clone, offsetX, offsetY, targetId }

function startWidgetDrag(e, id) {
  if (!dashEditMode) return;
  e.preventDefault();
  const el = document.querySelector(`.dash-widget[data-widget-id="${id}"]`);
  if (!el) return;
  const rect = el.getBoundingClientRect();

  // Floating clone that follows the cursor
  const clone = el.cloneNode(true);
  clone.removeAttribute("data-widget-id");
  Object.assign(clone.style, {
    position: "fixed",
    left: rect.left + "px", top: rect.top + "px",
    width: rect.width + "px",
    pointerEvents: "none",
    opacity: "0.88",
    zIndex: "9999",
    boxShadow: "0 28px 72px rgba(0,0,0,0.32)",
    transform: "scale(1.03) rotate(1deg)",
    transition: "transform 0.12s",
    borderRadius: "24px",
    willChange: "left,top",
  });
  document.body.appendChild(clone);

  // Dim the original in place
  el.classList.add("widget-dragging");

  gridDrag = {
    id, el, clone,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    targetId: null,
  };

  document.addEventListener("pointermove", onWidgetPointerMove, { passive: false });
  document.addEventListener("pointerup",   onWidgetPointerUp);
}

function onWidgetPointerMove(e) {
  if (!gridDrag) return;
  e.preventDefault();
  const { clone, offsetX, offsetY, id } = gridDrag;

  // Move clone
  clone.style.left = (e.clientX - offsetX) + "px";
  clone.style.top  = (e.clientY - offsetY) + "px";

  // Find what's under the cursor — clone is pointer-events:none so we see through
  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const targetEl = under.find(
    el => el.classList.contains("dash-widget") && el.dataset.widgetId && el.dataset.widgetId !== id
  );

  // Highlight target
  document.querySelectorAll(".dash-widget--drop-target").forEach(el =>
    el.classList.remove("dash-widget--drop-target"));

  if (targetEl) {
    targetEl.classList.add("dash-widget--drop-target");
    gridDrag.targetId = targetEl.dataset.widgetId;
  } else {
    gridDrag.targetId = null;
    // Also detect which grid CELL the cursor is in for empty-cell drops
    const grid = document.querySelector(".dash-widget-grid");
    if (grid) {
      const gr = grid.getBoundingClientRect();
      const relX = e.clientX - gr.left;
      const relY = e.clientY - gr.top;
      gridDrag.dropCol = relX < gr.width / 2 ? 1 : 2;
      // Determine row by scanning widget positions
      gridDrag.dropRow = estimateDropRow(e.clientY);
    }
  }
}

function estimateDropRow(clientY) {
  // Find the nearest widget row by scanning existing widget els
  let bestRow = 1, bestDist = Infinity;
  document.querySelectorAll(".dash-widget[data-widget-id]").forEach(el => {
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const dist = Math.abs(clientY - mid);
    if (dist < bestDist) {
      bestDist = dist;
      const id = el.dataset.widgetId;
      const widgets = getDashWidgets();
      const wid = widgets.find(w => w.id === id);
      if (wid) bestRow = wid.row;
    }
  });
  return bestRow;
}

function onWidgetPointerUp(e) {
  if (!gridDrag) return;
  const { id, el, clone, targetId, dropCol, dropRow } = gridDrag;

  clone.remove();
  el.classList.remove("widget-dragging");
  document.querySelectorAll(".dash-widget--drop-target").forEach(el =>
    el.classList.remove("dash-widget--drop-target"));
  document.removeEventListener("pointermove", onWidgetPointerMove);
  document.removeEventListener("pointerup",   onWidgetPointerUp);
  gridDrag = null;

  const widgets = getDashWidgets();
  const src = widgets.find(w => w.id === id);
  if (!src) return;

  if (targetId) {
    // Swap grid positions with target widget
    const tgt = widgets.find(w => w.id === targetId);
    if (tgt) {
      const tmp = { col: src.col, row: src.row, w: src.w };
      src.col = tgt.col; src.row = tgt.row;
      // When sizes differ, each widget takes the other's spot but keeps its own width
      // Clamp col so a w=2 widget always starts at col 1
      if (src.w === 2) src.col = 1;
      tgt.col = tmp.col; tgt.row = tmp.row;
      if (tgt.w === 2) tgt.col = 1;
      S.settings.dashboardWidgets = widgets;
      save();
      rerenderPage();
    }
  } else if (dropCol !== undefined && dropRow !== undefined) {
    // Move to empty cell
    src.col = src.w === 2 ? 1 : dropCol;
    src.row = dropRow;
    S.settings.dashboardWidgets = widgets;
    save();
    rerenderPage();
  }
}

// ─── Old aliases kept so nothing breaks ─────────────────────────────────────
function dashWidgetDragStart() {}
function dashWidgetDragEnd() {}
function dashWidgetDragOver() {}
function dashWidgetDrop() {}

// Individual widget HTML renderers — receive pre-computed dash context
function renderWidget(id, ctx) {
  const { doneToday, total, pct, goalPct, activeGoals, nextHabit, notebookCount, latestNote, aiCoachCopy,
          streak, focusLabel, greet, name, notebook } = ctx;
  const today = getTodayStr();

  // ── Main content widgets ──────────────────────────────────────────────────
  if (id === "ring") {
    const r = 28, circ = +(2 * Math.PI * r).toFixed(2);
    const offset = +(circ - circ * (pct / 100)).toFixed(2);
    const ringColor = pct === 100 ? "#0c9b6b" : "#4b6ef6";
    return `<div class="dash-panel">
      <div class="dash-greeting">
        <div class="dash-greeting-name">${esc(greet)}, ${esc(name)}</div>
        <div class="dash-greeting-date">${fmtLongDate(getNow())}</div>
      </div>
      <div class="dash-ring-row">
        <div class="ring-wrap">
          <svg width="84" height="84" viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--border)" stroke-width="6"></circle>
            <circle class="dashboard-ring-progress" data-offset="${offset}" data-circ="${circ}"
              cx="36" cy="36" r="${r}" fill="none" stroke="${ringColor}" stroke-width="6"
              stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
              transform="rotate(-90 36 36)" style="transition:stroke-dashoffset .7s ease"></circle>
          </svg>
          <div class="ring-center"><strong>${pct}%</strong><span>${doneToday}/${total}</span></div>
        </div>
        <div class="dash-ring-info">
          <div class="dash-ring-title">Today's progress</div>
          <div class="dash-ring-val">${pct}%</div>
          <div class="dash-ring-sub">${focusLabel}</div>
          <div class="dash-stats">
            <div class="dash-stat"><div class="dash-stat-kicker">Streak</div><div class="dash-stat-line"><div class="dash-stat-val">${streak}</div><div class="dash-stat-text">days active</div></div></div>
            <div class="dash-stat"><div class="dash-stat-kicker">Goals</div><div class="dash-stat-line"><div class="dash-stat-val">${activeGoals.length}</div><div class="dash-stat-text">${goalPct}% moving</div></div></div>
            <div class="dash-stat"><div class="dash-stat-kicker">Notebooks</div><div class="dash-stat-line"><div class="dash-stat-val">${notebookCount}</div><div class="dash-stat-text">${notebookCount===1?"notebook":notebookCount===0?"none yet":"notebooks"}</div></div></div>
          </div>
        </div>
      </div>
      ${weekStrip()}
    </div>`;
  }

  if (id === "habits") {
    if (!total) return `<div class="dash-side-card"><div class="dash-side-title">Today's habits</div><div style="font-size:13px;color:var(--text3);margin-top:8px">No habits yet — <button class="btn btn-ghost btn-sm" style="font-size:13px;padding:0 4px" onclick="nav('habits')">add one →</button></div></div>`;
    return `<div class="dash-side-card">
      <div class="dash-side-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Today's habits</span>
        <button class="sec-action" onclick="nav('habits')">All habits →</button>
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
        ${ctx.S_habits.map(h => habitRow(h, true)).join("")}
      </div>
    </div>`;
  }

  if (id === "goals") {
    if (!activeGoals.length) return `<div class="dash-side-card"><div class="dash-side-title">Goals in progress</div><div style="font-size:13px;color:var(--text3);margin-top:8px">No active goals — <button class="btn btn-ghost btn-sm" style="font-size:13px;padding:0 4px" onclick="nav('goals')">add one →</button></div></div>`;
    return `<div class="dash-side-card">
      <div class="dash-side-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Goals in progress</span>
        <button class="sec-action" onclick="nav('goals')">All goals →</button>
      </div>
      <div class="grid2" style="margin-top:10px">${activeGoals.slice(0, 4).map(g => goalCard(g)).join("")}</div>
    </div>`;
  }

  if (id === "notebook") {
    if (!notebook?.content?.trim()) return "";
    return `<div class="dash-side-card">
      <div class="dash-side-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Notebook preview</span>
        <button class="sec-action" onclick="nav('notes')">Open →</button>
      </div>
      <div style="margin-top:10px">${noteRow(notebook)}</div>
    </div>`;
  }

  if (id === "quote") {
    const [q, a] = getDailyQuote();
    return `<div class="dash-side-card dash-quote-card">
      <div class="dash-side-title" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);font-weight:800;margin-bottom:8px">Quote of the day</div>
      <div class="dash-quote-text">"${esc(q)}"</div>
      <div class="dash-quote-attr">— ${esc(a)}</div>
    </div>`;
  }

  if (id === "water") {
    const water = S.tools?.water || { target: 8, log: {} };
    const glasses = water.log?.[today] || 0;
    const target = water.target || 8;
    const wp = Math.min(100, Math.round((glasses / target) * 100));
    const dots = Array.from({ length: Math.min(target, 10) }, (_, i) =>
      `<button class="water-dot${i < glasses ? " filled" : ""}" onclick="logWater(${i < glasses ? i : i + 1})" title="${i+1}">💧</button>`
    ).join("");
    return `<div class="dash-side-card">
      <div class="dash-side-title">Hydration</div>
      <div style="display:flex;align-items:center;gap:14px;margin:10px 0 6px">
        <div style="position:relative;flex-shrink:0">
          ${miniRing(wp, "#3b9edd", 56, 5)}
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1">
            <span style="font-size:13px;font-weight:800;color:${wp>=100?"var(--success)":"#3b9edd"}">${glasses}</span>
            <span style="font-size:9px;font-weight:700;color:var(--text3)">/${target}</span>
          </div>
        </div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">${wp>=100?"Goal reached! 💧":`${target-glasses} glass${target-glasses!==1?"es":""} to go`}</div>
          <div class="water-dots">${dots}</div>
        </div>
      </div>
    </div>`;
  }

  if (id === "mood") {
    const moods = S.tools?.mood || [];
    const todayMood = moods.find(m => m.date === today);
    const MOOD_EMOJIS = ["😞","😕","😐","🙂","😄"];
    const MOOD_LABELS = ["Rough","Low","Okay","Good","Great"];
    return `<div class="dash-side-card">
      <div class="dash-side-title">How are you feeling?</div>
      <div class="mood-row">
        ${MOOD_EMOJIS.map((e, i) =>
          `<button class="mood-btn${todayMood?.rating===i+1?" active":""}" onclick="logMood(${i+1})" title="${MOOD_LABELS[i]}">${e}</button>`
        ).join("")}
      </div>
      ${todayMood ? `<div style="font-size:12px;color:var(--text3);margin-top:6px;text-align:center">${MOOD_LABELS[todayMood.rating-1]} today</div>` : ""}
    </div>`;
  }

  if (id === "score") {
    const pomLog = (S.tools?.pomodoroTimer?.sessionLog || []).find(e => e.date === today);
    const studyMins = (pomLog?.focusMinutes || 0) + Math.floor((stopwatchSeconds || 0) / 60);
    const studyTarget = S.tools?.studyGoal?.dailyMinutes || 0;
    const comps = [];
    if (total > 0)             comps.push({ label:"Habits", pct:Math.round((doneToday/total)*100), color:"var(--accent)" });
    if (activeGoals.length > 0) comps.push({ label:"Goals",  pct:goalPct, color:"var(--lifestyle)" });
    if (studyTarget>0||studyMins>0) comps.push({ label:"Study", pct:Math.min(100,Math.round((studyMins/(studyTarget||60))*100)), color:"var(--study)" });
    if (!comps.length) return `<div class="dash-side-card"><div class="dash-side-title">Today's score</div><div style="font-size:12px;color:var(--text3);margin-top:6px">Track habits, goals or study to see your score.</div></div>`;
    const score = Math.round(comps.reduce((s,c)=>s+c.pct,0)/comps.length);
    const grade = score>=90?"Excellent 🌟":score>=75?"Strong 💪":score>=55?"Solid 📈":score>=30?"Building":"Starting out";
    const gc = score>=90?"var(--success)":score>=75?"var(--accent)":score>=55?"var(--warning)":"var(--text3)";
    return `<div class="dash-side-card">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <div style="position:relative;flex-shrink:0">
          ${miniRing(score, gc, 56, 5)}
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1">
            <span style="font-size:14px;font-weight:800;color:${gc}">${score}</span>
            <span style="font-size:9px;font-weight:700;color:var(--text3)">%</span>
          </div>
        </div>
        <div>
          <div class="dash-side-title" style="margin-bottom:3px">Today's score</div>
          <div style="font-size:12px;font-weight:700;color:${gc}">${grade}</div>
        </div>
      </div>
      <div class="dash-score-bars">
        ${comps.map(c=>`<div class="dash-score-row"><span>${c.label}</span><div class="dash-score-bar-wrap"><div class="dash-score-bar" style="width:${c.pct}%;background:${c.color}"></div></div><span class="dash-score-pts">${c.pct}%</span></div>`).join("")}
      </div>
    </div>`;
  }

  if (id === "scratchpad") {
    return `<div class="dash-side-card">
      <div class="dash-side-title">Quick notes</div>
      <textarea class="scratch-pad" placeholder="Jot anything down…" oninput="saveScratchpad(this.value)">${esc(S.tools?.scratchpad||"")}</textarea>
    </div>`;
  }

  if (id === "ai") {
    return `<div class="dash-side-card">
      <div class="dash-side-title">Pulse AI</div>
      <div class="dash-side-copy">${esc(aiCoachCopy)}</div>
      <div class="dash-side-list">
        <div class="dash-mini-row">
          <div><strong>${nextHabit?esc(nextHabit.name):"All habits complete"}</strong>
          <span>${nextHabit?"Next habit to check off today":"You cleared your list for today"}</span></div>
          <div class="dash-mini-dot" style="background:${nextHabit?catColor(nextHabit.category):"var(--success)"}"></div>
        </div>
        <div class="dash-mini-row">
          <div><strong>${activeGoals[0]?esc(activeGoals[0].name):"No active goals yet"}</strong>
          <span>${activeGoals[0]?`${Math.min(100,Math.round((goalCur(activeGoals[0])/activeGoals[0].target)*100))}% complete`:"Add a goal to track measurable progress"}</span></div>
          <div class="dash-mini-dot" style="background:${activeGoals[0]?catColor(activeGoals[0].category):"var(--border-strong)"}"></div>
        </div>
      </div>
    </div>`;
  }

  if (id === "glance") {
    return `<div class="dash-side-card">
      <div class="dash-side-title">Today at a glance</div>
      <div class="dash-side-list">
        <div class="dash-mini-row"><div><strong>${doneToday} habit${doneToday!==1?"s":""} done</strong><span>${Math.max(total-doneToday,0)} remaining</span></div>
          ${total>0?`<div style="flex-shrink:0">${miniRing(pct,"var(--accent)",28,3)}</div>`:""}
        </div>
        <div class="dash-mini-row"><div><strong>${goalPct}% goal momentum</strong><span>${activeGoals.length?`${activeGoals.length} active goal${activeGoals.length!==1?"s":""}` :"No active goals"}</span></div>
          ${activeGoals.length>0?`<div style="flex-shrink:0">${miniRing(goalPct,"var(--lifestyle)",28,3)}</div>`:""}
        </div>
        <div class="dash-mini-row"><div><strong>${notebookCount>0?`${notebookCount} notebook${notebookCount!==1?"s":""}` :"No notebooks yet"}</strong><span>${latestNote?esc(latestNote.slice(0,60)):"Create one in Notes"}</span></div></div>
      </div>
    </div>`;
  }

  return "";
}

function renderDashWidgets(ctx) {
  const all     = getDashWidgets();
  const visible = all.filter(w => !w.hidden);
  const hidden  = all.filter(w => w.hidden);

  const widgetHtml = visible.map(w => {
    const content = renderWidget(w.id, ctx);
    if (!content) return "";
    const label   = WIDGET_DEFS.find(d => d.id === w.id)?.label || w.id;
    const isWide  = w.w === 2;

    // CSS grid placement — explicit col/row so widgets can sit anywhere in 2-D
    const colEnd = isWide ? "1 / span 2" : `${w.col} / span 1`;
    const gridStyle = `grid-column:${colEnd}; grid-row:${w.row} / span ${w.h || 1};`;

    const editBar = dashEditMode ? `
      <div class="dash-widget-edit-bar"
           onpointerdown="startWidgetDrag(event,'${w.id}')"
           style="cursor:grab;touch-action:none">
        <span class="dash-drag-handle">⠿</span>
        <span class="dash-widget-edit-label">${label}</span>
        <button class="dash-widget-size-btn"
                onclick="event.stopPropagation();toggleWidgetSize('${w.id}')"
                title="${isWide ? "Make half-width" : "Make full-width"}">${isWide ? "◧" : "◨"}</button>
        <button class="dash-widget-hide-btn"
                onclick="event.stopPropagation();hideWidget('${w.id}')"
                title="Hide">×</button>
      </div>` : "";

    return `<div class="dash-widget${dashEditMode ? " dash-widget--editing" : ""}"
      data-widget-id="${w.id}"
      style="${gridStyle}">
      ${editBar}${content}
    </div>`;
  }).join("");

  const addBack = hidden.length && dashEditMode ? `
    <div style="grid-column:1/span 2; grid-row:${Math.max(...visible.map(w => w.row), 0) + 1}">
      <div class="dash-side-card" style="text-align:center">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:10px">Hidden — tap to restore</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
          ${hidden.map(w => `<button class="btn btn-outline btn-sm" onclick="showWidgetById('${w.id}')">${WIDGET_DEFS.find(d => d.id === w.id)?.label || w.id}</button>`).join("")}
        </div>
      </div>
    </div>` : "";

  return `<div class="dash-widget-grid">${widgetHtml}${addBack}</div>`;
}

function showWidgetById(id) {
  const widgets = getDashWidgets();
  const w = widgets.find(w => w.id === id);
  if (w) w.hidden = false;
  S.settings.dashboardWidgets = widgets;
  save();
  rerenderPage();
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

    // Shared context for sidebar widget renders
    const ctx = { doneToday, total, pct, goalPct, activeGoals, nextHabit, notebookCount,
                  latestNote, aiCoachCopy, streak, focusLabel, greet, name, notebook };

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
                  <circle class="dashboard-ring-progress"
                    data-offset="${offset.toFixed(2)}" data-circ="${circ.toFixed(2)}"
                    cx="36" cy="36" r="${r}" fill="none" stroke="${ringColor}" stroke-width="6"
                    stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}"
                    stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 36 36)"
                    style="transition:stroke-dashoffset .7s ease"></circle>
                </svg>
                <div class="ring-center"><strong>${pct}%</strong><span>${doneToday}/${total}</span></div>
              </div>
              <div class="dash-ring-info">
                <div class="dash-ring-title">Today's progress</div>
                <div class="dash-ring-val">${pct}%</div>
                <div class="dash-ring-sub">${focusLabel}</div>
                <div class="dash-stats">
                  <div class="dash-stat"><div class="dash-stat-kicker">Streak</div><div class="dash-stat-line"><div class="dash-stat-val">${streak}</div><div class="dash-stat-text">days active</div></div></div>
                  <div class="dash-stat"><div class="dash-stat-kicker">Goals</div><div class="dash-stat-line"><div class="dash-stat-val">${activeGoals.length}</div><div class="dash-stat-text">${goalPct}% moving</div></div></div>
                  <div class="dash-stat"><div class="dash-stat-kicker">Notebooks</div><div class="dash-stat-line"><div class="dash-stat-val">${notebookCount}</div><div class="dash-stat-text">${notebookCount===1?"notebook":notebookCount===0?"none yet":"notebooks"}</div></div></div>
                </div>
              </div>
            </div>
            ${weekStrip()}
          </div>

          ${S.habits.length ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Today's habits</div>
                <button class="sec-action" onclick="nav('habits')">Open habits</button>
              </div>
              ${S.habits.map(h => habitRow(h, true)).join("")}
            </div>` : ""}

          ${activeGoals.length ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Goals in progress</div>
                <button class="sec-action" onclick="nav('goals')">Open goals</button>
              </div>
              <div class="grid2">${activeGoals.slice(0, 4).map(g => goalCard(g)).join("")}</div>
            </div>` : ""}

          ${notebook?.content?.trim() ? `
            <div class="page-section">
              <div class="sec-hd">
                <div class="sec-label">Notebook preview</div>
                <button class="sec-action" onclick="nav('notes')">Open notebook</button>
              </div>
              ${noteRow(notebook)}
            </div>` : ""}

          ${!S.habits.length && !S.goals.length && !S.notes.length ? `
            <div class="empty">
              <div class="empty-icon">+</div>
              <div class="empty-title">Welcome to Pulse</div>
              <div class="empty-text">Start with one habit, one goal, or one notebook entry. Pulse will turn the rest into a calmer daily rhythm.</div>
            </div>` : ""}
        </div>

        <aside class="dash-side">
          ${renderWidget("score",      ctx)}
          ${renderWidget("quote",      ctx)}
          ${renderWidget("water",      ctx)}
          ${renderWidget("mood",       ctx)}
          ${renderWidget("scratchpad", ctx)}
          ${renderWidget("ai",         ctx)}
          ${renderWidget("glance",     ctx)}
        </aside>
      </div>
    `;
  },

  habits() {
    const filtered = habFilter === "all" ? S.habits : S.habits.filter((h) => h.category === habFilter);
    const doneToday = S.habits.filter((h) => h.logs && h.logs[getTodayStr()]).length;
    const total = S.habits.length;
    const pct = total ? Math.round((doneToday / total) * 100) : 0;
    const streak = appStreak();
    const today = getTodayStr();

    // Sidebar — last 7 days activity dots
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const ds = fmtDate(d);
      return { ds, done: S.habits.some((h) => h.logs && h.logs[ds]), isToday: ds === today,
               label: ["S","M","T","W","T","F","S"][d.getDay()] };
    });

    // Sidebar — category breakdown
    const catBreakdown = CATS.map((c) => {
      const ch = S.habits.filter((h) => h.category === c.id);
      if (!ch.length) return null;
      const cd = ch.filter((h) => h.logs && h.logs[today]).length;
      return { c, total: ch.length, done: cd, pct: Math.round((cd / ch.length) * 100) };
    }).filter(Boolean);

    // Sidebar — top 3 streaks
    const topStreaks = [...S.habits]
      .map((h) => ({ h, s: habitStreak(h) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);

    return `
      <div class="page-hero">
        <div class="page-hero-accent" style="background:var(--accent)"></div>
        <div class="page-hero-body">
          <div class="page-hero-kicker">Habits</div>
          <div class="page-hero-num">${doneToday}<span class="page-hero-num-denom"> / ${total}</span></div>
          <div class="page-hero-sub">${total > 0 ? `${pct}% done today` : "No habits yet"}${streak > 0 ? ` · 🔥 ${streak} day streak` : ""}</div>
          ${total > 0 ? `<div class="page-hero-bar"><div class="page-hero-bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>` : ""}
        </div>
        <div class="page-hero-actions">
          <button class="btn btn-primary" onclick="openAddHabit()">+ Add habit</button>
          <button class="btn btn-outline btn-sm" onclick="openHabitPackModal()">Use a pack</button>
          <div class="page-kpi-row">
            <div class="page-kpi"><div class="page-kpi-val">${pct}%</div><div class="page-kpi-label">Today</div></div>
            <div class="page-kpi"><div class="page-kpi-val">${streak}</div><div class="page-kpi-label">Streak</div></div>
            <div class="page-kpi"><div class="page-kpi-val">${total}</div><div class="page-kpi-label">Total</div></div>
          </div>
        </div>
      </div>

      <div class="filter-pills">
        <div class="fpill ${habFilter === "all" ? "active" : ""}" onclick="setHabFilter('all')">All</div>
        ${CATS.map((c) => `<div class="fpill ${habFilter === c.id ? "active" : ""}" onclick="setHabFilter('${c.id}')">${c.emoji} ${c.label}</div>`).join("")}
      </div>

      <div class="page-layout">
        <div class="page-main">
          ${filtered.length
            ? filtered.map((h) => habitRow(h, false)).join("")
            : `<div class="empty"><div class="empty-icon">○</div><div class="empty-title">No habits yet</div><div class="empty-text">Add your first habit to begin building a steadier routine.</div></div>`}
        </div>

        <aside class="page-side">
          <div class="page-side-card">
            <div class="page-side-kicker">This week</div>
            <div class="side-week-dots">
              ${last7.map((d) => `
                <div class="side-week-day">
                  <div class="side-week-dot${d.done ? " done" : ""}${d.isToday ? " today" : ""}"></div>
                  <div class="side-week-label">${d.label}</div>
                </div>`).join("")}
            </div>
            <div style="margin-top:16px;display:flex;align-items:baseline;gap:8px">
              <span style="font-size:32px;font-weight:800;letter-spacing:-0.04em;line-height:1">${streak}</span>
              <span style="font-size:13px;color:var(--text2)">day streak 🔥</span>
            </div>
          </div>

          ${catBreakdown.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker">By category</div>
              ${catBreakdown.map(({ c, total: ct, done: cd, pct: cp }) => `
                <div class="side-cat-row">
                  <div class="side-cat-label">
                    <span>${c.emoji} ${c.label}</span>
                    <span class="side-cat-count">${cd}/${ct}</span>
                  </div>
                  <div class="prog-track" style="height:4px;margin-top:5px">
                    <div class="prog-fill" style="width:${cp}%;background:${c.color}"></div>
                  </div>
                </div>`).join("")}
            </div>
          ` : ""}

          ${topStreaks.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker">Top streaks</div>
              <div class="dash-side-list">
                ${topStreaks.map(({ h, s }) => `
                  <div class="dash-mini-row">
                    <div>
                      <strong>${esc(h.icon)} ${esc(h.name)}</strong>
                      <span>${s} day${s !== 1 ? "s" : ""}</span>
                    </div>
                    <span style="font-size:18px">🔥</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
        </aside>
      </div>
    `;
  },

  goals() {
    const filtered = goalFilter === "all" ? S.goals : S.goals.filter((g) => g.category === goalFilter);
    const active = filtered.filter((g) => goalCur(g) < g.target);
    const completed = filtered.filter((g) => goalCur(g) >= g.target);
    const allActive = S.goals.filter((g) => goalCur(g) < g.target);
    const allCompleted = S.goals.filter((g) => goalCur(g) >= g.target);
    const totalTarget = allActive.reduce((s, g) => s + g.target, 0);
    const totalDone = allActive.reduce((s, g) => s + goalCur(g), 0);
    const overallPct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;

    // Sidebar — category progress
    const catProgress = CATS.map((c) => {
      const cg = allActive.filter((g) => g.category === c.id);
      if (!cg.length) return null;
      const ct = cg.reduce((s, g) => s + g.target, 0);
      const cd = cg.reduce((s, g) => s + goalCur(g), 0);
      return { c, count: cg.length, pct: ct ? Math.round((cd / ct) * 100) : 0 };
    }).filter(Boolean);

    // Sidebar — recent logs across all goals (last 4)
    const recentLogs = S.goals
      .flatMap((g) => (g.logs || []).map((l) => ({ ...l, gName: g.name, gIcon: g.icon, unit: g.unit })))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 4);

    return `
      <div class="page-hero">
        <div class="page-hero-accent" style="background:var(--success)"></div>
        <div class="page-hero-body">
          <div class="page-hero-kicker">Goals</div>
          <div class="page-hero-num">${allActive.length}<span class="page-hero-num-denom"> active</span></div>
          <div class="page-hero-sub">${allCompleted.length} completed · ${overallPct}% overall progress</div>
          ${allActive.length > 0 ? `<div class="page-hero-bar"><div class="page-hero-bar-fill" style="width:${overallPct}%;background:var(--success)"></div></div>` : ""}
        </div>
        <div class="page-hero-actions">
          <button class="btn btn-primary" onclick="openAddGoal()">+ Add goal</button>
          <div class="page-kpi-row">
            <div class="page-kpi"><div class="page-kpi-val">${overallPct}%</div><div class="page-kpi-label">Progress</div></div>
            <div class="page-kpi"><div class="page-kpi-val">${allActive.length}</div><div class="page-kpi-label">Active</div></div>
            <div class="page-kpi"><div class="page-kpi-val">${allCompleted.length}</div><div class="page-kpi-label">Done</div></div>
          </div>
        </div>
      </div>

      <div class="filter-pills">
        <div class="fpill ${goalFilter === "all" ? "active" : ""}" onclick="setGoalFilter('all')">All</div>
        ${CATS.map((c) => `<div class="fpill ${goalFilter === c.id ? "active" : ""}" onclick="setGoalFilter('${c.id}')">${c.emoji} ${c.label}</div>`).join("")}
      </div>

      ${!active.length && !completed.length ? `
        <div class="empty"><div class="empty-icon">◎</div><div class="empty-title">No goals yet</div><div class="empty-text">Set one measurable target and Pulse will help you keep it moving.</div></div>
      ` : `
        <div class="page-layout">
          <div class="page-main">
            ${active.length ? `<div class="grid2">${active.map((g) => goalCard(g)).join("")}</div>` : ""}
            ${completed.length ? `
              <div class="page-section" style="margin-top:${active.length ? "8px" : "0"}">
                <div class="sec-hd"><div class="sec-label">Completed (${completed.length})</div></div>
                <div class="grid2">${completed.map((g) => goalCard(g)).join("")}</div>
              </div>` : ""}
          </div>

          <aside class="page-side">
            ${catProgress.length ? `
              <div class="page-side-card">
                <div class="page-side-kicker">By category</div>
                ${catProgress.map(({ c, count, pct }) => `
                  <div class="side-cat-row">
                    <div class="side-cat-label">
                      <span>${c.emoji} ${c.label}</span>
                      <span class="side-cat-count">${count} goal${count !== 1 ? "s" : ""} · ${pct}%</span>
                    </div>
                    <div class="prog-track" style="height:4px;margin-top:5px">
                      <div class="prog-fill" style="width:${pct}%;background:${c.color}"></div>
                    </div>
                  </div>`).join("")}
              </div>
            ` : ""}

            ${recentLogs.length ? `
              <div class="page-side-card">
                <div class="page-side-kicker">Recent logs</div>
                <div class="dash-side-list">
                  ${recentLogs.map((l) => `
                    <div class="dash-mini-row">
                      <div>
                        <strong>${esc(l.gIcon)} ${esc(l.gName)}</strong>
                        <span>+${l.value} ${esc(l.unit)} · ${l.date}</span>
                      </div>
                    </div>`).join("")}
                </div>
              </div>
            ` : ""}

            ${allCompleted.length && goalFilter !== "all" ? `
              <div class="page-side-card">
                <div class="page-side-kicker">All completed (${allCompleted.length})</div>
                <div class="dash-side-list">
                  ${allCompleted.slice(0, 4).map((g) => `
                    <div class="dash-mini-row">
                      <div>
                        <strong>${esc(g.icon)} ${esc(g.name)}</strong>
                        <span>${g.target} ${esc(g.unit)} ✓</span>
                      </div>
                    </div>`).join("")}
                </div>
              </div>
            ` : ""}
          </aside>
        </div>
      `}
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
    const lastUpdated = S.notes.reduce((latest, n) => Math.max(latest, n.createdAt || 0), 0);

    const heroHtml = `
      <div class="page-hero">
        <div class="page-hero-accent" style="background:#8b5cf6"></div>
        <div class="page-hero-body">
          <div class="page-hero-kicker">Notebook</div>
          <div class="page-hero-num">${notebookDocs.length}<span class="page-hero-num-denom"> notebook${notebookDocs.length !== 1 ? "s" : ""}</span></div>
          <div class="page-hero-sub">${activities.length} activity note${activities.length !== 1 ? "s" : ""}${lastUpdated ? ` · updated ${fmtShortDate(lastUpdated)}` : ""}</div>
        </div>
        <div class="page-hero-actions">
          <button class="btn btn-primary" onclick="openNewNotebookModal()">+ New notebook</button>
          <div class="page-kpi-row">
            <div class="page-kpi"><div class="page-kpi-val">${notebookDocs.length}</div><div class="page-kpi-label">Notebooks</div></div>
            <div class="page-kpi"><div class="page-kpi-val">${activities.length}</div><div class="page-kpi-label">Activity</div></div>
          </div>
        </div>
      </div>
    `;

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
          ${heroHtml}
          ${tabsHtml}
          <div class="empty">
            <div class="empty-icon">📓</div>
            <div class="empty-title">No notebooks yet</div>
            <div class="empty-text">Create your first notebook and start writing.</div>
            <button class="btn btn-primary" style="margin-top:18px" onclick="openNewNotebookModal()">+ New notebook</button>
          </div>
        `;
      }

      // Filter notebooks by search query
      const q = notebookSearch.trim().toLowerCase();
      const visibleNbs = q
        ? notebookDocs.filter((nb) =>
            (nb.title || "").toLowerCase().includes(q) ||
            (nb.content || "").toLowerCase().includes(q)
          )
        : notebookDocs;

      // Highlight a match snippet in content
      function nbSnippet(content) {
        if (!q || !content) return esc((content || "").slice(0, 90)) || "Empty notebook";
        const idx = content.toLowerCase().indexOf(q);
        if (idx === -1) return esc(content.slice(0, 90)) || "Empty notebook";
        const start = Math.max(0, idx - 30);
        const raw = (start > 0 ? "…" : "") + content.slice(start, idx) +
          "[[" + content.slice(idx, idx + q.length) + "]]" +
          content.slice(idx + q.length, idx + q.length + 60) + "…";
        return esc(raw).replace(/\[\[/g, '<mark class="nb-match">').replace(/\]\]/g, "</mark>");
      }

      return `
        ${heroHtml}
        ${tabsHtml}
        ${notebookDocs.length > 1 ? `
          <div class="search-wrap" style="margin-bottom:16px">
            <svg class="search-ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="9" r="7"></circle><path d="m16 16-3.5-3.5"></path></svg>
            <input class="search-input" type="text" placeholder="Search notebooks…" value="${esc(notebookSearch)}" oninput="notebookSearch=this.value;rerenderPage()">
            ${notebookSearch ? `<button class="search-clear" onclick="notebookSearch='';rerenderPage()">×</button>` : ""}
          </div>
        ` : ""}
        <div class="page-layout">
          <div class="page-main">
            ${q ? `
              ${visibleNbs.length > 0 ? `
                <div class="nb-list nb-list-search">
                  ${visibleNbs.map((nb) => `
                    <div class="nb-entry" onclick="notebookSearch='';switchNotebook('${nb.id}')">
                      <div class="nb-entry-info">
                        <div class="nb-entry-title">${esc(nb.title)}</div>
                        <div class="nb-entry-preview">${nbSnippet(nb.content)}</div>
                      </div>
                      <div class="nb-entry-date">${fmtShortDate(nb.createdAt)}</div>
                    </div>`).join("")}
                </div>
              ` : `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No matches</div><div class="empty-text">Try a different word or phrase.</div></div>`}
            ` : `
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
                    <textarea id="notebookBody" class="form-input notebook-body" data-notebook-id="${esc(activeNb.id)}" placeholder="Start writing...">${esc(activeNb.content || "")}</textarea>
                  </div>
                  <div class="composer-actions">
                    <button class="btn btn-primary" onclick="saveNotebook()">Save notebook</button>
                  </div>
                ` : `<div class="nb-select-prompt">Select a notebook to open it.</div>`}
              </div>
            `}
          </div>
          <aside class="page-side">
            <div class="page-side-card">
              <div class="page-side-kicker">${notebookDocs.length} Notebook${notebookDocs.length !== 1 ? "s" : ""}</div>
              <div class="nb-list" style="margin-top:0">
                ${notebookDocs.map((nb) => `
                  <div class="nb-entry${!q && nb.id === activeNb?.id ? " active" : ""}" onclick="notebookSearch='';switchNotebook('${nb.id}')">
                    <div class="nb-entry-info">
                      <div class="nb-entry-title">${esc(nb.title)}</div>
                      <div class="nb-entry-preview">${esc((nb.content || "").slice(0, 72)) || "Empty notebook"}</div>
                    </div>
                    <div class="nb-entry-date">${fmtShortDate(nb.createdAt)}</div>
                  </div>`).join("")}
              </div>
            </div>
          </aside>
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

    // Sidebar — notes count per goal
    const actByGoal = {};
    for (const n of activities) {
      const k = n.goalName || "General";
      actByGoal[k] = (actByGoal[k] || 0) + 1;
    }
    const actGoalRows = Object.entries(actByGoal).sort((a, b) => b[1] - a[1]).slice(0, 6);

    return `
      ${heroHtml}
      ${tabsHtml}
      <div class="search-wrap" style="margin-bottom:16px">
        <svg class="search-ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="9" r="7"></circle><path d="m16 16-3.5-3.5"></path></svg>
        <input class="search-input" type="text" placeholder="Search activity notes..." value="${esc(noteSearch)}" oninput="noteSearch=this.value;rerenderPage()">
        ${noteSearch ? `<button class="search-clear" onclick="noteSearch='';rerenderPage()">×</button>` : ""}
      </div>
      <div class="page-layout">
        <div class="page-main">
          ${visibleActivity.length
            ? `<div class="notes-stack">${visibleActivity.map((n) => noteRow(n)).join("")}</div>`
            : `<div class="empty"><div class="empty-icon">✎</div><div class="empty-title">${noteSearch ? "No notes found" : "No activity notes yet"}</div><div class="empty-text">${noteSearch ? "Try a different phrase." : "Activity notes are created automatically when you log goal progress."}</div></div>`
          }
        </div>
        <aside class="page-side">
          ${actGoalRows.length ? `
            <div class="page-side-card">
              <div class="page-side-kicker">By goal</div>
              <div class="dash-side-list">
                ${actGoalRows.map(([name, count]) => `
                  <div class="dash-mini-row">
                    <strong>${esc(name)}</strong>
                    <span>${count} note${count !== 1 ? "s" : ""}</span>
                  </div>`).join("")}
              </div>
            </div>
          ` : ""}
          <div class="page-side-card">
            <div class="page-side-kicker">About activity notes</div>
            <p style="font-size:13px;color:var(--text2);line-height:1.65">Activity notes are automatically created each time you log progress on a goal. They capture what you did and when.</p>
          </div>
        </aside>
      </div>
    `;
  },

  history() {
    const today = getTodayStr();
    const now = new Date();
    const calYear = historyYear !== null ? historyYear : now.getFullYear();
    const calMonth = historyMonth !== null ? historyMonth : now.getMonth();
    const dateStr = historyDate || today;
    const dateObj = new Date(dateStr + "T00:00:00");
    const isToday = dateStr === today;

    // Calendar grid
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const DAY_HEADERS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayObj = new Date();

    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cellToday = ds === today;
      const sel = ds === dateStr;
      const done = S.habits.filter(h => h.logs && h.logs[ds] === true).length;
      const total = S.habits.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const active = done > 0;
      cells.push({ day: d, ds, cellToday, sel, pct, active, done, total });
    }

    // Detail data for selected day
    const habitsDone = S.habits.filter(h => h.logs && h.logs[dateStr] === true);
    const habitsSkipped = S.habits.filter(h => h.logs && h.logs[dateStr] === "skip");
    const habitsMissing = S.habits.filter(h => !h.logs || !h.logs[dateStr]);
    const goalEntries = S.goals.map(g => {
      const entries = (g.logs || []).filter(l => l.date === dateStr || l.date?.startsWith(dateStr));
      return entries.length ? { goal: g, entries } : null;
    }).filter(Boolean);
    const dayNotes = activityNotes().filter(n => fmtDate(new Date(n.createdAt || n.ts)) === dateStr);
    const dayMood = (S.tools.mood || []).filter(m => m.date === dateStr);
    const dayWater = (S.tools.water?.log || {})[dateStr] || 0;
    const dayPomo = (S.tools.pomodoroTimer?.sessionLog || []).filter(s => s.date === dateStr);

    // Detail sections
    const sections = [];

    if (habitsDone.length || habitsSkipped.length || habitsMissing.length) {
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
            Habits
            <span class="history-count">${habitsDone.length}/${S.habits.length}</span>
          </div>
          <div class="history-items">
            ${S.habits.map(h => {
              const status = h.logs && h.logs[dateStr];
              const done = status === true;
              const skipped = status === "skip";
              return `
                <div class="history-item${done ? " history-item--done" : ""}${skipped ? " history-item--skip" : ""}">
                  <div class="history-item-icon${done ? " history-item-icon--check" : skipped ? " history-item-icon--skip" : " history-item-icon--empty"}">
                    ${done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>` : skipped ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>` : `<span class="history-dot-empty"></span>`}
                  </div>
                  <span class="history-item-name">${esc(h.name)}</span>
                  <span class="history-item-emoji">${h.emoji || ""}</span>
                </div>`;
            }).join("")}
          </div>
        </div>
      `);
    }

    if (goalEntries.length) {
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
            Goals
          </div>
          <div class="history-items">
            ${goalEntries.map(({ goal, entries }) => `
              <div class="history-item">
                <div class="history-item-icon history-item-icon--accent">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                </div>
                <div class="history-item-body">
                  <div class="history-item-name">${esc(goal.name)}</div>
                  <div class="history-item-sub">+${entries.reduce((s, e) => s + (Number(e.value) || 0), 0)} ${esc(goal.unit || "")} · now ${Math.round((goalCur(goal) / goal.target) * 100)}%</div>
                </div>
              </div>`).join("")}
          </div>
        </div>
      `);
    }

    if (dayNotes.length) {
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
            Activity notes
            <span class="history-count">${dayNotes.length}</span>
          </div>
          <div class="history-items">
            ${dayNotes.map(n => `
              <div class="history-item history-item--note">
                <div class="history-item-body">
                  <div class="history-item-name">${esc(n.title || "Note")}</div>
                  <div class="history-item-sub">${esc((n.content || "").slice(0, 120))}</div>
                </div>
              </div>`).join("")}
          </div>
        </div>
      `);
    }

    if (dayMood.length) {
      const mood = dayMood[0];
      const faces = ["😢", "😟", "😐", "🙂", "😊"];
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd"/></svg>
            Mood
          </div>
          <div class="history-items">
            <div class="history-item">
              <div class="history-item-icon" style="background:none;font-size:18px">${faces[mood.rating - 1] || "😐"}</div>
              <div class="history-item-body">
                <div class="history-item-name">${["Terrible", "Bad", "Okay", "Good", "Great"][mood.rating - 1] || "Okay"}</div>
                ${mood.note ? `<div class="history-item-sub">${esc(mood.note)}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
      `);
    }

    if (dayWater > 0) {
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="#3b9edd"><path d="M10.394 2.08a1 1 0 00-.788 0c-3.4 1.38-6.106 4.6-6.106 8.42a6.9 6.9 0 1013.8 0c0-3.82-2.706-7.04-6.106-8.42z"/></svg>
            Water
            <span class="history-count">${dayWater} glass${dayWater !== 1 ? "es" : ""}</span>
          </div>
        </div>
      `);
    }

    if (dayPomo.length) {
      const totalFocus = dayPomo.reduce((s, p) => s + (p.focusMinutes || p.sessions * 25 || 0), 0);
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
            Focus sessions
            <span class="history-count">${dayPomo.reduce((s, p) => s + p.sessions, 0)} sessions</span>
          </div>
          <div class="history-items">
            <div class="history-item">
              <div class="history-item-body">
                <div class="history-item-name">${totalFocus} min focused</div>
                <div class="history-item-sub">${dayPomo.reduce((s, p) => s + p.sessions, 0)} pomodoro session${dayPomo.reduce((s, p) => s + p.sessions, 0) !== 1 ? "s" : ""}</div>
              </div>
            </div>
          </div>
        </div>
      `);
    }

    // ── Score section ────────────────────────────────────────────────────────
    {
      const scoreHabitPct = S.habits.length ? Math.round((habitsDone.length / S.habits.length) * 100) : 0;
      const activeGoalsOnDate = S.goals.filter(g => goalCur(g) < g.target);
      const goalTarget = activeGoalsOnDate.reduce((s, g) => s + g.target, 0);
      const goalDone = activeGoalsOnDate.reduce((s, g) => s + goalCur(g), 0);
      const scoreGoalPct = goalTarget ? Math.round((goalDone / goalTarget) * 100) : 0;
      const studyMins = dayPomo.reduce((s, p) => s + (p.focusMinutes || p.sessions * 25 || 0), 0);
      const studyTarget = S.tools?.studyGoal?.dailyMinutes || 0;
      const comps = [];
      if (S.habits.length > 0) comps.push({ label:"Habits", pct:scoreHabitPct });
      if (activeGoalsOnDate.length > 0) comps.push({ label:"Goals", pct:scoreGoalPct });
      if (studyTarget > 0 || studyMins > 0) comps.push({ label:"Study", pct:Math.min(100, Math.round((studyMins / (studyTarget || 60)) * 100)) });
      if (comps.length) {
        const score = Math.round(comps.reduce((s, c) => s + c.pct, 0) / comps.length);
        const grade = score >= 90 ? "Excellent" : score >= 75 ? "Strong" : score >= 55 ? "Solid" : score >= 30 ? "Building" : "Starting out";
        sections.push(`
          <div class="history-section">
            <div class="history-section-title">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
              Score
              <span class="history-count">${score}%</span>
            </div>
            <div class="history-items">
              ${comps.map(c => `<div class="history-item" style="justify-content:space-between"><span style="font-size:13px;font-weight:600;color:var(--text2)">${c.label}</span><span style="font-size:14px;font-weight:800">${c.pct}%</span></div>`).join("")}
              <div class="history-item" style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px;justify-content:space-between">
                <span style="font-size:13px;font-weight:700">${grade}</span>
                <span style="font-size:20px;font-weight:800;letter-spacing:-0.04em;color:var(--accent)">${score}<span style="font-size:13px;color:var(--text3)">%</span></span>
              </div>
            </div>
          </div>
        `);
      }
    }

    // ── Notebook section ─────────────────────────────────────────────────────
    const notebookDocs = S.notes.filter(n => n.kind === "notebook_doc");
    if (notebookDocs.length) {
      const nbCreatedToday = notebookDocs.filter(n => fmtDate(new Date(n.createdAt || n.ts)) === dateStr);
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
            Notebooks
            <span class="history-count">${notebookDocs.length}</span>
          </div>
          <div class="history-items">
            ${notebookDocs.map(nb => `
              <div class="history-item history-item--note">
                <div class="history-item-body">
                  <div class="history-item-name">${esc(nb.title || "Notebook")}</div>
                  <div class="history-item-sub">${esc((nb.content || "").slice(0, 180)) || "Empty notebook"}</div>
                </div>
              </div>`).join("")}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
            Showing current content — per-day notebook history is not tracked yet.
            ${nbCreatedToday.length ? `Created on this day.` : ""}
          </div>
        </div>
      `);
    }

    // ── Scratchpad section ───────────────────────────────────────────────────
    const scratchContent = S.tools?.scratchpad?.trim();
    if (scratchContent) {
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 4h3a3 3 0 006 0h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm2.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm2.45 4a2.5 2.5 0 10-4.9 0h4.9zM12 9a1 1 0 100 2h3a1 1 0 100-2h-3zm-1 4a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>
            Quick notes
          </div>
          <div class="history-items">
            <div class="history-item history-item--note">
              <div class="history-item-body">
                <div class="history-item-sub">${esc(scratchContent)}</div>
              </div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
            Current scratchpad content — per-day history not tracked yet.
          </div>
        </div>
      `);
    }

    // ── Workout section (current state, no historical tracking) ──────────────
    const wt = getWorkoutTimer();
    if (wt.exercises?.length) {
      const totalSecs = wt.exercises.reduce((s, e) => s + e.work + (e.rest || 0), 0);
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--workout)"><path d="M4 8a2 2 0 012-2h1V4a1 1 0 112 0v2h2V4a1 1 0 112 0v2h1a2 2 0 012 2v1a2 2 0 01-2 2h-1v2a1 1 0 11-2 0v-2H9v2a1 1 0 11-2 0v-2H6a2 2 0 01-2-2V8z"/></svg>
            Workout timer
            <span class="history-count">${fmtTimer(totalSecs)}</span>
          </div>
          <div class="history-items">
            ${wt.exercises.map((ex, i) => `
              <div class="history-item">
                <div class="history-item-icon history-item-icon--accent">${i + 1}</div>
                <div class="history-item-body">
                  <div class="history-item-name">${esc(ex.name)}</div>
                  <div class="history-item-sub">Work: ${fmtTimer(ex.work)}${ex.rest > 0 ? ` · Rest: ${fmtTimer(ex.rest)}` : ""}</div>
                </div>
              </div>`).join("")}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
            Current workout plan — per-session history is not tracked yet.
          </div>
        </div>
      `);
    }

    // ── Study timers section (current state) ─────────────────────────────────
    const st = getStudyTimer();
    const ft = S.tools?.focusTimer;
    sections.push(`
      <div class="history-section">
        <div class="history-section-title">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--study)"><path d="M10 4l8 3-8 3-8-3 8-3zm-6 5.5 6 2.25 6-2.25V13l-6 3-6-3V9.5z"/></svg>
          Study timers
        </div>
        <div class="history-items">
          <div class="history-item">
            <div class="history-item-body">
              <div class="history-item-name">Study timer</div>
              <div class="history-item-sub">${st.duration} min sessions · ${fmtTimer(st.remaining)} remaining</div>
            </div>
          </div>
          <div class="history-item">
            <div class="history-item-body">
              <div class="history-item-name">Focus timer</div>
              <div class="history-item-sub">${ft ? `${ft.duration} min · ${fmtTimer(ft.remaining)} remaining` : "Not configured"}</div>
            </div>
          </div>
          <div class="history-item">
            <div class="history-item-body">
              <div class="history-item-name">Daily study goal</div>
              <div class="history-item-sub">${S.tools?.studyGoal?.dailyMinutes ? `${S.tools.studyGoal.dailyMinutes} min/day target` : "No goal set"}</div>
            </div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
          Current timer configuration — per-day study session history is not tracked yet.
        </div>
      </div>
    `);

    // ── Flashcards section (current state) ──────────────────────────────────
    const decks = S.tools?.flashcardDecks || [];
    if (decks.length) {
      const totalCards = decks.reduce((s, d) => s + (d.cards?.length || 0), 0);
      sections.push(`
        <div class="history-section">
          <div class="history-section-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>
            Flashcards
            <span class="history-count">${decks.length} deck${decks.length !== 1 ? "s" : ""} · ${totalCards} cards</span>
          </div>
          <div class="history-items">
            ${decks.map(d => `
              <div class="history-item">
                <div class="history-item-body">
                  <div class="history-item-name">${esc(d.name)}</div>
                  <div class="history-item-sub">${d.cards?.length || 0} card${(d.cards?.length || 0) !== 1 ? "s" : ""}${d.subject ? ` · ${esc(d.subject)}` : ""}</div>
                </div>
              </div>`).join("")}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
            Current flashcard decks — per-session study history is not tracked yet.
          </div>
        </div>
      `);
    }

    return `
      <div class="page-hero">
        <div class="page-hero-accent" style="background:var(--accent)"></div>
        <div class="page-hero-body">
          <div class="page-hero-kicker">History</div>
          <div class="page-hero-num">${MONTHS[calMonth]} <span class="page-hero-num-denom">${calYear}</span></div>
          <div class="page-hero-sub">${dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        </div>
        <div class="page-hero-actions">
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-sm" onclick="navMonth(-1)">← ${MONTHS[calMonth === 0 ? 11 : calMonth - 1].slice(0, 3)}</button>
            <button class="btn btn-outline btn-sm" onclick="historyYear=null;historyMonth=null;jumpToToday()">Today</button>
            <button class="btn btn-outline btn-sm" onclick="navMonth(1)">${MONTHS[calMonth === 11 ? 0 : calMonth + 1].slice(0, 3)} →</button>
          </div>
        </div>
      </div>

      <div class="history-cal">
        <div class="history-cal-headers">
          ${DAY_HEADERS.map(h => `<div class="history-cal-hdr">${h}</div>`).join("")}
        </div>
        <div class="history-cal-grid">
          ${cells.map(c => c === null
            ? `<div class="history-cal-cell history-cal-cell--empty"></div>`
            : `<div class="history-cal-cell${c.sel ? " history-cal-cell--sel" : ""}${c.cellToday ? " history-cal-cell--today" : ""}${c.active ? " history-cal-cell--active" : ""}" onclick="historyDate='${c.ds}';rerenderPage()" title="${c.ds}">
                <span class="history-cal-day">${c.day}</span>
                ${c.total > 0 ? `<span class="history-cal-dot history-cal-dot--${c.pct >= 100 ? "full" : c.pct >= 40 ? "mid" : c.active ? "low" : "none"}"></span>` : ""}
              </div>`
          ).join("")}
        </div>
      </div>

      ${sections.length
        ? `<div class="history-sections">${sections.join("")}</div>`
        : `<div class="empty" style="margin-top:20px">
            <div class="empty-icon">📅</div>
            <div class="empty-title">Nothing recorded for this day</div>
            <div class="empty-text">Come back after you've checked some habits, logged goal progress, or written a note.</div>
          </div>`
      }
    `;
  },

  ai() {
    const _newId = lastCreatedChatId;
    const chatTabsHtml = aiPageChats.map(chat => {
      const classes = ["ai-chat-tab",
        chat.id === activePageChatId ? "active" : "",
        chat.id === _newId ? "ai-chat-tab--new" : "",
      ].filter(Boolean).join(" ");
      return `<button class="${classes}" onclick="switchAIChat('${chat.id}')" data-chat-id="${chat.id}">${esc(chat.title)}</button>`;
    }).join("");
    return `
      <div class="ai-page surface-card">
        <div class="ai-page-header">
          <div class="ai-page-title">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="color:var(--accent)"><path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z"/><path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z"/></svg>
            Pulse AI
            <span class="ai-edit-badge" id="aiEditBadgePage" style="display:none">EDIT</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="newAIPageChat()">+ New</button>
            <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteCurrentAIChat()" title="Delete this chat" style="font-size:16px;line-height:1">×</button>
            <div class="ai-mode-row ai-mode-row--page" style="margin:0">
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
        </div>
        <div class="ai-chat-tabs" id="aiChatTabs">${chatTabsHtml}</div>
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

function habitHeatmap(habit) {
  const WEEKS = 13, DAYS = 7;
  const today = new Date();
  const c = cat(habit.category);
  const cells = [];
  for (let i = WEEKS * DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    cells.push({
      key: fmtDate(d),
      done: !!(habit.logs && habit.logs[fmtDate(d)]),
      isToday: i === 0,
    });
  }
  const weeks = Array.from({ length: WEEKS }, (_, w) => cells.slice(w * DAYS, (w + 1) * DAYS));
  const totalDone = cells.filter((c) => c.done).length;
  return `
    <div class="habit-heatmap">
      <div class="heatmap-meta">${totalDone} day${totalDone !== 1 ? "s" : ""} completed in the last ${WEEKS} weeks</div>
      <div class="heatmap-grid">
        ${weeks.map((week) => `
          <div class="heatmap-col">
            ${week.map((cell) => `<div
              class="heatmap-cell${cell.done ? " hm-done" : ""}${cell.isToday ? " hm-today" : ""}"
              style="${cell.done ? `background:${c.color};border-color:${c.color}` : ""}"
              title="${cell.key}${cell.done ? " ✓" : ""}"></div>`).join("")}
          </div>`).join("")}
      </div>
    </div>
  `;
}

function toggleHabitCalendar(id) {
  openHabitCalendarId = openHabitCalendarId === id ? null : id;
  rerenderPage();
}

function habitRow(habit, dashMode) {
  const done = habit.logs && habit.logs[getTodayStr()];
  const streak = habitStreak(habit);
  const c = cat(habit.category);
  const calOpen = !dashMode && openHabitCalendarId === habit.id;
  return `
    <div class="habit-item-wrap">
      <div class="habit-item ${done ? "done" : ""}" data-habit-id="${habit.id}" style="border-left: 3px solid ${c.color}">
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
            ${streak > 0 ? `<span class="streak-chip">🔥 ${streak} day${streak !== 1 ? "s" : ""}</span>` : ""}
          </div>
        </div>
        ${!dashMode ? `
          ${!done ? `<button class="btn btn-ghost btn-sm" onclick="skipHabit('${habit.id}')" title="Skip today — keeps your streak" style="font-size:11px;opacity:0.7">Skip</button>` : ""}
          <button class="btn btn-ghost btn-icon btn-sm heatmap-toggle${calOpen ? " active" : ""}" onclick="toggleHabitCalendar('${habit.id}')" title="View history">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteHabit('${habit.id}')" title="Delete">×</button>
        ` : ""}
      </div>
      ${calOpen ? habitHeatmap(habit) + `<div class="habit-stats-row">
        <div class="habit-stat-chip">🔥 Current: ${habitStreak(habit)}d</div>
        <div class="habit-stat-chip">🏆 Longest: ${habitLongestStreak(habit)}d</div>
        <div class="habit-stat-chip">✓ Total: ${habitTotalDone(habit)}</div>
      </div>` : ""}
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
        <div class="goal-emoji">${goal.icon}</div>
        <div class="goal-ring-wrap">
          ${miniRing(pct, c.color, 42, 4)}
          <span class="goal-ring-label" style="color:${c.color}">${pct}%</span>
        </div>
      </div>
      <div class="goal-name">${esc(goal.name)}</div>
      <div class="goal-prog-txt">${cur} / ${goal.target} ${esc(goal.unit)}${goal.due ? ` · ${goalDueLabel(goal.due)}` : ""}</div>
      <div class="prog-track" style="margin-top:8px">
        <div class="prog-fill" style="width:${pct}%;background:${c.color}"></div>
        ${[25,50,75].map(m => `<div class="prog-milestone-tick" style="left:${m}%"></div>`).join("")}
      </div>
      ${goalSparkline(goal)}
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
    // Decide which feedback to show — milestones beat "done", perfect day beats both
    const streak = habitStreak(habit);
    const STREAK_MILESTONES = [7, 14, 30, 60, 100, 365];
    // "Perfect day" = every habit is either done (true) or explicitly skipped
    // but at least one must be truly done (not all skips)
    const allCoveredNow = S.habits.length > 0 && S.habits.every(h => h.logs && h.logs[today]);
    const anyActuallyDoneNow = S.habits.some(h => h.logs && h.logs[today] === true);
    const allDoneNow = allCoveredNow && anyActuallyDoneNow;
    if (allDoneNow) {
      celebrateToast("🎉 Perfect day — every habit done!");
    } else if (STREAK_MILESTONES.includes(streak)) {
      celebrateToast(`🏆 ${streak}-day streak on "${habit.name}"!`);
    } else {
      toast("Habit done ✓");
    }
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
      if (streak > 0) meta.insertAdjacentHTML("beforeend", `<span class="streak-chip">🔥 ${streak} day${streak !== 1 ? "s" : ""}</span>`);
    }
    // Dashboard ring still needs a re-render for the progress circle
    if (curPage === "dashboard") rerenderPage();
  } else {
    rerenderPage();
  }
}

const HABIT_PACKS = {
  morning: {
    label: "🌅 Morning routine",
    habits: [
      { name: "Drink a glass of water", icon: "💧", category: "lifestyle" },
      { name: "10-minute stretch", icon: "🧘", category: "workout" },
      { name: "Journal for 5 minutes", icon: "📝", category: "general" },
      { name: "No phone for first 30 min", icon: "📵", category: "lifestyle" },
    ]
  },
  fitness: {
    label: "💪 Fitness",
    habits: [
      { name: "30-minute workout", icon: "🏋️", category: "workout" },
      { name: "10,000 steps", icon: "🚶", category: "workout" },
      { name: "Drink 8 glasses of water", icon: "💧", category: "lifestyle" },
      { name: "Eat a healthy meal", icon: "🥗", category: "lifestyle" },
    ]
  },
  study: {
    label: "📚 Study",
    habits: [
      { name: "Study for 1 hour", icon: "📚", category: "study" },
      { name: "Review flashcards", icon: "🎴", category: "study" },
      { name: "Read 20 pages", icon: "📖", category: "study" },
      { name: "No social media during study", icon: "📵", category: "study" },
    ]
  },
  wellness: {
    label: "🧠 Wellness",
    habits: [
      { name: "Meditate 10 minutes", icon: "🧘", category: "lifestyle" },
      { name: "Sleep 8 hours", icon: "😴", category: "lifestyle" },
      { name: "Gratitude journaling", icon: "🙏", category: "general" },
      { name: "Go for a walk", icon: "🚶", category: "lifestyle" },
    ]
  }
};

function openHabitPackModal() {
  modal(`
    <div class="modal-title">Habit packs</div>
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Choose a preset pack to add multiple habits at once.</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${Object.entries(HABIT_PACKS).map(([key, pack]) => `
        <div class="habit-pack-card" onclick="addHabitPack('${key}')">
          <div class="habit-pack-title">${pack.label}</div>
          <div class="habit-pack-preview">${pack.habits.map(h => h.icon + " " + h.name).join(" · ")}</div>
        </div>
      `).join("")}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function addHabitPack(packKey) {
  const pack = HABIT_PACKS[packKey];
  if (!pack) return;
  let added = 0;
  pack.habits.forEach(h => {
    // Don't add duplicates
    if (!S.habits.some(existing => existing.name.toLowerCase() === h.name.toLowerCase())) {
      S.habits.push({ id: "h" + Date.now() + Math.random().toString(36).slice(2, 5), ...h, logs: {}, createdAt: Date.now() });
      added++;
    }
  });
  save();
  closeModal();
  rerenderPage();
  toast(added > 0 ? `Added ${added} habits from ${pack.label}` : "All habits from this pack already exist");
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

function skipHabit(id) {
  const habit = S.habits.find(h => h.id === id);
  if (!habit) return;
  if (!habit.logs) habit.logs = {};
  const today = getTodayStr();
  if (habit.logs[today]) {
    // Already done, can't skip a completed habit
    return toast("Habit already done today");
  }
  habit.logs[today] = "skip"; // special value — counts for streak but not as "done"
  save();
  rerenderPage();
  toast("Habit skipped — streak protected ✓");
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
    <div class="form-group"><label class="form-label">Due date <span style="color:var(--text3);font-weight:400">(optional)</span></label><input id="gDue" class="form-input" type="date"></div>
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
  const due  = document.getElementById("gDue")?.value || "";
  if (!name) return toast("Enter a goal name");
  if (!target || target <= 0) return toast("Enter a valid target");
  S.goals.push({ id: "g" + Date.now(), name, category, icon, target, unit, due, logs: [], createdAt: Date.now() });
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
      celebrateToast(`🎉 Goal completed! "${goal.name}" is done!`);
      finalizeCompletedGoal(goal.id);
    } else {
      openCompletionNote(goal.id);
    }
    return;
  }

  // Check if this log crossed a milestone (25 / 50 / 75 %)
  const prevPct = Math.min(99, Math.round((before / goal.target) * 100));
  const newPct  = Math.min(99, Math.round((after  / goal.target) * 100));
  const GOAL_MILESTONES = [25, 50, 75];
  const crossed = GOAL_MILESTONES.find(m => prevPct < m && newPct >= m);

  rerenderPage();
  if (crossed) {
    celebrateToast(`🎯 ${crossed}% on "${goal.name}"! Keep going.`);
  } else {
    toast(`Logged ${value} ${goal.unit}`);
  }
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
  celebrateToast(`🎉 Goal completed!`);
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
  // Auto-save current notebook content before switching
  const bodyEl = document.getElementById("notebookBody");
  if (bodyEl) {
    const current = getActiveNotebook();
    if (current) current.content = bodyEl.value;
  }
  activeNotebookId = id;
  save();
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
    // Snapshot current textarea content BEFORE saving, so the onSnapshot
    // re-render echo doesn't wipe out anything the user hasn't saved yet.
    const bodyEl = document.getElementById("notebookBody");
    if (bodyEl) nb.content = bodyEl.value;
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
    <div class="form-label" style="margin-bottom:6px">Daily reminder</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <input id="reminderTimeInput" class="form-input" type="time" value="${S.settings?.reminderTime||""}" style="width:110px">
      <button class="btn btn-outline btn-sm" onclick="requestNotificationAndSaveTime()">Save reminder</button>
      <span style="font-size:12px;color:var(--text3)">Requires browser permission</span>
    </div>
    <div class="divider"></div>
    <div class="form-label" style="margin-bottom:6px">Auto dark mode</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <label class="ai-toggle"><input type="checkbox" id="darkSchedEnabled" ${S.settings?.darkSchedule?.enabled ? "checked" : ""} onchange="toggleDarkSchedule(this)"><span class="ai-toggle-slider"></span></label>
      <span style="font-size:13px;color:var(--text2)">Switch dark between</span>
      <input id="darkFrom" class="form-input" type="time" value="${S.settings?.darkSchedule?.from||"20:00"}" style="width:90px" onchange="saveDarkScheduleTime()">
      <span style="font-size:13px;color:var(--text2)">and</span>
      <input id="darkTo" class="form-input" type="time" value="${S.settings?.darkSchedule?.to||"07:00"}" style="width:90px" onchange="saveDarkScheduleTime()">
    </div>
    <div class="divider"></div>
    <div class="form-label" style="margin-bottom:10px;color:var(--text3)">Account</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="importData()">Import data</button>
      <button class="btn btn-outline btn-sm" onclick="exportData()">Export data</button>
      <button class="btn btn-danger btn-sm" onclick="clearAllData()">Clear all data</button>
      <button class="btn btn-outline btn-sm" onclick="signOut()">Sign out</button>
    </div>
    <div class="divider" style="margin-top:16px"></div>
    <div class="form-label" style="margin-bottom:10px;color:var(--text3)">Danger zone</div>
    <button class="btn btn-danger btn-sm" onclick="closeModal();deleteAccount()">Delete account</button>
    <p style="font-size:12px;color:var(--text3);margin:6px 0 0">Permanently deletes your account and all data. Cannot be undone.</p>
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

let _pendingImportData = null; // temporary hold between modal and confirm

function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.habits) && !Array.isArray(data.goals)) {
        return toast("Not a valid Pulse export file");
      }
      _pendingImportData = data;
      const habitCount = (data.habits || []).length;
      const goalCount  = (data.goals  || []).length;
      const noteCount  = (data.notes  || []).length;
      modal(`
        <div class="modal-title">Import data</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
          Found <strong>${habitCount} habit${habitCount!==1?"s":""}</strong>,
          <strong>${goalCount} goal${goalCount!==1?"s":""}</strong> and
          <strong>${noteCount} note${noteCount!==1?"s":""}</strong> in this file.
          New items will be merged — existing items with the same ID won't be duplicated.
        </p>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="confirmImport()">Merge &amp; import</button>
        </div>
      `);
    } catch {
      toast("Could not read file — make sure it's a valid Pulse JSON export");
    }
  };
  input.click();
}

function confirmImport() {
  try {
    const data = _pendingImportData;
    if (!data) return toast("No import data pending");
    _pendingImportData = null;
    // Merge habits (skip if ID already exists)
    const existingHabitIds = new Set(S.habits.map(h => h.id));
    (data.habits || []).forEach(h => { if (!existingHabitIds.has(h.id)) S.habits.push(h); });
    // Merge goals
    const existingGoalIds = new Set(S.goals.map(g => g.id));
    (data.goals || []).forEach(g => { if (!existingGoalIds.has(g.id)) S.goals.push(g); });
    // Merge notes
    const existingNoteIds = new Set(S.notes.map(n => n.id));
    (data.notes || []).forEach(n => { if (!existingNoteIds.has(n.id)) S.notes.push(n); });
    save();
    closeModal();
    rerenderPage();
    toast("Data imported successfully ✓");
  } catch {
    toast("Import failed — data may be corrupted");
  }
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    user: currentUser?.username || "",
    habits: S.habits,
    goals: S.goals,
    notes: S.notes,
    tools: S.tools,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pulse-export-${getTodayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Data exported 📥");
}

function clearAllData() {
  if (!confirm("Delete all your habits, goals, and notes? This cannot be undone.")) return;
  S = { ...defaultState(), settings: { ...S.settings } };
  // Reset volatile UI state that references the now-deleted data
  activeNotebookId = null;
  aiPanelChats = {};
  aiPanelAnimatedPages = {};
  aiPageChats = [_makeAIChat("chat-default")];
  activePageChatId = aiPageChats[0].id;
  save();
  closeModal();
  nav("dashboard");
  toast("Data cleared");
}

function toggleDarkSchedule(checkbox) {
  if (!S.settings.darkSchedule) S.settings.darkSchedule = { enabled: false, from: "20:00", to: "07:00" };
  S.settings.darkSchedule.enabled = checkbox.checked;
  save();
  if (checkbox.checked) { applyDarkSchedule(); } else { applyTheme(S.settings.theme); }
}

function saveDarkScheduleTime() {
  if (!S.settings.darkSchedule) S.settings.darkSchedule = { enabled: false, from: "20:00", to: "07:00" };
  S.settings.darkSchedule.from = document.getElementById("darkFrom")?.value || "20:00";
  S.settings.darkSchedule.to   = document.getElementById("darkTo")?.value   || "07:00";
  save();
  applyDarkSchedule();
}

function applyTheme(theme) {
  // "" = auto — resolve from OS preference without saving an explicit choice
  const resolved = theme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", resolved);
  const sunPath = "M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z";
  const moonPath = "M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z";
  const themeIcon = document.getElementById("themeIcon");
  if (themeIcon) themeIcon.setAttribute("d", resolved === "dark" ? sunPath : moonPath);
  S.settings.theme = theme; // store the preference ("", "light", or "dark") — not the resolved value
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

// ── Panel: get (or create) current page's chat array ─────────────────────────
function getAIPanelMsgs() {
  const p = curPage;
  if (!aiPanelChats[p]) {
    aiPanelChats[p] = [{ role: "assistant", text: "I am Pulse AI. I can help with the page you are looking at right now." }];
  }
  return aiPanelChats[p];
}

// Clear the current page's popup chat
function clearAIPanelChat() {
  aiPanelChats[curPage] = [{ role: "assistant", text: "I am Pulse AI. I can help with the page you are looking at right now." }];
  delete aiPanelAnimatedPages[curPage];
  renderAIPanelMsgs();
}

// ── Full-page saved chats ─────────────────────────────────────────────────────
function getActivePageChat() {
  return aiPageChats.find(c => c.id === activePageChatId) || aiPageChats[0];
}

function newAIPageChat() {
  const chat = _makeAIChat("chat-" + Date.now());
  aiPageChats.unshift(chat);
  activePageChatId = chat.id;
  lastCreatedChatId = chat.id;
  rerenderPage();
}

function switchAIChat(id) {
  activePageChatId = id;
  renderAIPageMsgs();
  renderChatList();
}

function deleteCurrentAIChat() {
  const chat = getActivePageChat();
  const label = chat && chat.title !== "New chat" ? `"${chat.title}"` : "this chat";
  if (!confirm(`Delete ${label}? This conversation will be gone.`)) return;

  if (aiPageChats.length === 1) {
    // Only one chat — reset it instead of removing
    chat.messages = [{ role: "assistant", text: "I am Pulse AI. I can help across your full Pulse data, including habits, goals, activity notes, and your notebook." }];
    chat.title = "New chat";
    chat.isNew = true;
    chat._animatedCount = chat.messages.length; // don't animate reset
    renderAIPageMsgs();
    renderChatList();
    return;
  }
  aiPageChats = aiPageChats.filter(c => c.id !== activePageChatId);
  activePageChatId = aiPageChats[0].id;
  rerenderPage();
}

function renderChatList() {
  const tabs = document.getElementById("aiChatTabs");
  if (!tabs) return;
  const newId = lastCreatedChatId;
  tabs.innerHTML = aiPageChats.map(chat => {
    const classes = ["ai-chat-tab",
      chat.id === activePageChatId ? "active" : "",
      chat.id === newId ? "ai-chat-tab--new" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" onclick="switchAIChat('${chat.id}')" data-chat-id="${chat.id}">${esc(chat.title)}</button>`;
  }).join("");
  // Clear the flag after the animation has been triggered (one frame is enough)
  if (newId) requestAnimationFrame(() => { lastCreatedChatId = null; });
}

async function generateChatTitle(chat) {
  const firstUserMsg = chat.messages.find(m => m.role === "user");
  if (!firstUserMsg) return;
  const config = getAIConfig();
  if (!config) return;
  try {
    const resp = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "Generate a short chat title (3-5 words) based on this first message. Reply with ONLY the title, no quotes, no punctuation at the end." },
          { role: "user", content: firstUserMsg.text },
        ],
      }),
    });
    const data = await resp.json();
    if (data.reply) {
      chat.title = data.reply.trim().replace(/^["']|["']$/g, "").slice(0, 40);
      chat.isNew = false;
      renderChatList();
    }
  } catch { /* title stays "New chat" */ }
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

  const page = curPage;
  const msgs = getAIPanelMsgs();
  // Messages below this index have already been seen — suppress their animation
  const shownCount = aiPanelAnimatedPages[page] ?? 0;

  const introTitle = document.querySelector(".ai-intro-title");
  const introText = document.querySelector(".ai-intro-text");
  if (introTitle) introTitle.textContent = aiEditMode ? "Edit mode active" : "Current page help";
  if (introText) introText.textContent = aiEditMode
    ? `Pulse AI can create and edit your ${PAGE_TITLES[curPage] || "current page"} data. Destructive actions will ask for confirmation.`
    : `Ask about the ${PAGE_TITLES[curPage] || "current"} page and Pulse AI will focus on what is visible here.`;

  msgs.forEach((msg, i) => {
    const el = buildAIMsgEl(msg);
    if (i < shownCount) el.style.animation = "none"; // already shown — no replay
    wrap.appendChild(el);
  });

  // Mark all currently rendered messages as "already seen"
  aiPanelAnimatedPages[page] = msgs.length;

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

  const chat = getActivePageChat();
  const msgs = chat ? chat.messages : [];
  // Per-chat animation counter — messages below this index are static
  const shownCount = chat ? (chat._animatedCount || 0) : msgs.length;

  msgs.forEach((msg, i) => {
    const el = buildAIMsgEl(msg);
    if (i < shownCount) el.style.animation = "none"; // already shown — no replay
    wrap.appendChild(el);
  });

  // Mark all currently rendered messages as "already seen" for this chat
  if (chat) chat._animatedCount = msgs.length;

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
    store: getAIPanelMsgs(),
    render: renderAIPanelMsgs,
  });
}

async function sendAIPage() {
  const chat = getActivePageChat();
  const isFirst = chat.isNew && chat.messages.filter(m => m.role === "user").length === 0;
  await runAIExchange({
    inputId: "aiPageInput",
    scope: "global",
    storeKey: "page",
    store: chat.messages,
    render: renderAIPageMsgs,
  });
  // After first user message, ask the AI to generate a short chat title
  if (isFirst) generateChatTitle(chat);
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
  const store = storeKey === "page" ? getActivePageChat().messages : getAIPanelMsgs();
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
  const store = storeKey === "page" ? getActivePageChat().messages : getAIPanelMsgs();
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
  el.classList.remove("celebrate");
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function celebrateToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show", "celebrate");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show", "celebrate");
  }, 3500);
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
        aiPanelChats = {};
        aiPanelAnimatedPages = {};
        aiPageChats = [_makeAIChat("chat-default")];
        activePageChatId = aiPageChats[0].id;
        stopwatchRunning = false; stopwatchSeconds = 0;
        clearInterval(stopwatchTick); stopwatchTick = null;
        activeNotebookId = null;
        noteFilter = "notebook";
        notebookSearch = "";
        flashcardDeckId = null;
        flashcardStudyMode = false;
        flashcardFlipped = false;
        flashcardAnswers = {};
        flashcardSessionDone = false;
        flashcardStartTime = null;
        flashcardSubset = null;
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
