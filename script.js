/* ==========================================================================
   X-CLOUD — script.js
   --------------------------------------------------------------------------
   WHERE TO PASTE YOUR FIREBASE CONFIG KEYS
   --------------------------------------------------------------------------
   1. Go to https://console.firebase.google.com and open (or create) a project.
   2. Build → Storage → "Get started" to enable Cloud Storage.
   3. Project settings (gear icon) → General → "Your apps" → add a Web app (</>).
   4. Firebase shows a `firebaseConfig` object. Copy each value into the
      `FIREBASE_CONFIG` object just below this comment block, replacing the
      "YOUR_..." placeholders. Do NOT change the key names.
   5. In Storage → Rules, set rules that fit your setup (see SECURITY NOTE).
   6. Add your GitHub Pages domain (yourname.github.io) under
      Authentication → Settings → Authorized domains if you later add Auth.

   Until you replace the placeholders, X-Cloud runs in DEMO MODE with mock
   files (Xelvis_Logs, Markdown_Notes, JSON_Backups) kept in memory only.

   SECURITY NOTE (important, please read)
   The 3-step gate runs in the browser. It keeps casual visitors out, and the
   answers are stored only as SHA-256 hashes (not plain text), but anyone
   comfortable with browser dev tools can bypass client-side checks. The real
   protection for your files is your Firebase Storage Rules. For genuinely
   private storage, enable Firebase Authentication and write rules such as:
       allow read, write: if request.auth != null && request.auth.uid == "YOUR_UID";
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getStorage, ref, uploadBytes, listAll, getMetadata, deleteObject, getBlob
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

/* ---------- PASTE FIREBASE CONFIG HERE ---------- */
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
/* ------------------------------------------------ */

const ROOT = "xcloud";                    // all files live under this prefix
const QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB meter
const KEEP = ".keep";                     // placeholder that makes empty folders exist

/* ==========================================================================
   GATE SECRETS (SHA-256 hashes of the normalised answers)
   Answer: "proxima mavolo roviena" (lowercase, single spaces)
   PIN:    "48578889"
   ========================================================================== */
const ANSWER_HASH = "9c894d777f9f44937a311c2a0ffe11d5dbc5af6da7f3893969e36ce5ecf0dab1";
const PIN_HASH    = "6a9d4e4659ea26eb408a7eadeb8e0fc72df029389f9e7f2d2289ac34e9099080";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const normAnswer = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const fmtKB = (bytes) => (bytes / 1024).toFixed(2) + " KB";

/* ==========================================================================
   FIREBASE INIT + STORAGE FUNCTIONS
   ========================================================================== */
const configured = !Object.values(FIREBASE_CONFIG).some(v => String(v).startsWith("YOUR_") || String(v).includes("YOUR_"));
let storage = null;

if (configured) {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    storage = getStorage(app);
  } catch (e) {
    console.error("Firebase init failed:", e);
  }
}
const demoMode = !storage;

/* Demo mode in-memory store: path -> { size, text } ; folders end with "/" */
const mock = new Map([
  [`${ROOT}/Xelvis_Logs/${KEEP}`, { size: 0, text: "" }],
  [`${ROOT}/Xelvis_Logs/session_2026-11-08.log`, { size: 4212, text: "[demo] session log" }],
  [`${ROOT}/Markdown_Notes/${KEEP}`, { size: 0, text: "" }],
  [`${ROOT}/Markdown_Notes/ideas.md`, { size: 1860, text: "# Ideas\n- demo" }],
  [`${ROOT}/JSON_Backups/${KEEP}`, { size: 0, text: "" }],
  [`${ROOT}/JSON_Backups/memory_backup.json`, { size: 9830, text: "{\"demo\":true}" }],
  [`${ROOT}/readme.txt`, { size: 312, text: "Welcome to X-Cloud (demo mode)." }],
]);

const cleanPath = (p = "") => p.replace(/^\/+|\/+$/g, "");
const fullPath = (p = "") => cleanPath(p) ? `${ROOT}/${cleanPath(p)}` : ROOT;

/** List files + folders directly inside `path` ("" = root). */
async function fbList(path = "") {
  const base = fullPath(path);
  if (demoMode) {
    const folders = new Set(), files = [];
    for (const [p, v] of mock) {
      if (!p.startsWith(base + "/")) continue;
      const rest = p.slice(base.length + 1);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else if (rest !== KEEP) files.push({ name: rest, path: cleanPath(`${path}/${rest}`), size: v.size, type: "file" });
    }
    return [
      ...[...folders].sort().map(n => ({ name: n, path: cleanPath(`${path}/${n}`), size: 0, type: "folder" })),
      ...files.sort((a, b) => a.name.localeCompare(b.name))
    ];
  }
  const res = await listAll(ref(storage, base));
  const folders = res.prefixes.map(p => ({ name: p.name, path: cleanPath(`${path}/${p.name}`), size: 0, type: "folder" }));
  const files = (await Promise.all(res.items
    .filter(i => i.name !== KEEP)
    .map(async i => {
      const m = await getMetadata(i);
      return { name: i.name, path: cleanPath(`${path}/${i.name}`), size: m.size, type: "file" };
    })));
  return [...folders, ...files];
}

/** Upload a Blob/File/string as `path`. */
async function fbUpload(path, data, contentType = "text/plain") {
  const target = fullPath(path);
  if (demoMode) {
    const isStr = typeof data === "string";
    const text = isStr ? data : await data.text();
    mock.set(target, { size: new Blob([text]).size, text });
    return { path: cleanPath(path), size: mock.get(target).size };
  }
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : data;
  await uploadBytes(ref(storage, target), blob, { contentType: blob.type || contentType });
  return { path: cleanPath(path), size: blob.size };
}

/** Read a text file back. */
async function fbRead(path) {
  const target = fullPath(path);
  if (demoMode) {
    if (!mock.has(target)) throw new Error("File not found: " + path);
    return mock.get(target).text;
  }
  return await (await getBlob(ref(storage, target))).text();
}

/** Delete a file, or a folder and everything inside it. */
async function fbDelete(path) {
  const target = fullPath(path);
  if (demoMode) {
    for (const p of [...mock.keys()]) if (p === target || p.startsWith(target + "/")) mock.delete(p);
    return true;
  }
  async function wipe(r) {
    const res = await listAll(r);
    await Promise.all(res.items.map(deleteObject));
    await Promise.all(res.prefixes.map(wipe));
  }
  try { await deleteObject(ref(storage, target)); }       // plain file
  catch (e) { await wipe(ref(storage, target)); }          // folder
  return true;
}

/** Create a folder (Storage has no real folders, so write a placeholder). */
async function fbMkdir(path) {
  return fbUpload(`${cleanPath(path)}/${KEEP}`, "", "text/plain");
}

/** Total bytes used (recursive). */
async function fbUsage() {
  if (demoMode) return [...mock.values()].reduce((a, v) => a + v.size, 0);
  async function walk(r) {
    const res = await listAll(r);
    const sizes = await Promise.all(res.items.map(async i => (await getMetadata(i)).size));
    const subs = await Promise.all(res.prefixes.map(walk));
    return sizes.reduce((a, b) => a + b, 0) + subs.reduce((a, b) => a + b, 0);
  }
  return walk(ref(storage, ROOT));
}

/* ==========================================================================
   SECURITY GATE
   ========================================================================== */
let unlocked = false;
let failCount = 0;
let lockoutUntil = 0;

const gate = $("gate"), app = $("app");

function showScreen(n) {
  [1, 2, 3].forEach(i => $("screen" + i).hidden = (i !== n));
  [...$("gateDots").children].forEach((d, i) => d.classList.toggle("active", i === n - 1));
  if (n === 2) $("answerInput").focus();
  if (n === 3) $("pinInput").focus();
}

function deny(input, errEl, msg) {
  failCount++;
  input.value = "";
  input.classList.remove("shake");
  void input.offsetWidth;              // restart animation
  input.classList.add("shake");
  errEl.textContent = msg;
  if (failCount >= 5) {
    lockoutUntil = Date.now() + 30000;
    failCount = 0;
    errEl.textContent = "Too many attempts. Wait 30 seconds.";
  }
}

function lockedOut(errEl) {
  const left = Math.ceil((lockoutUntil - Date.now()) / 1000);
  if (left > 0) { errEl.textContent = `Locked. Try again in ${left}s.`; return true; }
  return false;
}

$("toScreen2").addEventListener("click", () => showScreen(2));

$("screen2").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("answerInput"), err = $("err2");
  if (lockedOut(err)) return;
  const h = await sha256(normAnswer(input.value));
  if (h === ANSWER_HASH) { err.textContent = ""; input.value = ""; showScreen(3); }
  else deny(input, err, "Access denied.");
});

$("screen3").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("pinInput"), err = $("err3");
  if (lockedOut(err)) return;
  const h = await sha256(input.value.trim());
  if (h === PIN_HASH) { input.value = ""; err.textContent = ""; failCount = 0; unlock(); }
  else deny(input, err, "Access denied.");
});

function unlock() {
  unlocked = true;
  gate.hidden = true;
  app.hidden = false;
  currentPath = "";
  refresh();
}

function lock() {
  unlocked = false;
  selected.clear();
  $("fileList").innerHTML = "";     // wipe file names from the DOM
  app.hidden = true;
  gate.hidden = false;
  showScreen(1);
}

$("lockBtn").addEventListener("click", lock);

/* ==========================================================================
   DASHBOARD
   ========================================================================== */
let currentPath = "";
let entries = [];
const selected = new Set();

function setStatus(msg, isErr = false) {
  const s = $("statusLine");
  s.textContent = msg;
  s.classList.toggle("err", isErr);
}

function renderCrumbs() {
  const c = $("crumbs");
  c.innerHTML = "";
  const parts = cleanPath(currentPath).split("/").filter(Boolean);
  const mk = (label, path) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { currentPath = path; refresh(); };
    return b;
  };
  c.appendChild(mk("Root", ""));
  parts.forEach((p, i) => {
    c.appendChild(document.createTextNode("/"));
    c.appendChild(mk(p, parts.slice(0, i + 1).join("/")));
  });
}

function renderFiles() {
  const list = $("fileList");
  list.innerHTML = "";
  if (!entries.length) {
    list.innerHTML = '<p class="empty">Nothing here yet.</p>';
    return;
  }
  for (const it of entries) {
    const d = document.createElement("div");
    d.className = "item" + (selected.has(it.path) ? " selected" : "");
    const icon = document.createElement("span");
    icon.className = "item-icon emoji";
    icon.textContent = it.type === "folder" ? "📁" : "📄";
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = it.name;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = it.type === "folder" ? "Folder" : fmtKB(it.size);
    d.append(icon, name, meta);

    d.addEventListener("click", () => {
      selected.has(it.path) ? selected.delete(it.path) : selected.add(it.path);
      d.classList.toggle("selected");
      $("deleteBtn").disabled = selected.size === 0;
    });
    if (it.type === "folder") {
      d.addEventListener("dblclick", () => { currentPath = it.path; refresh(); });
    }
    list.appendChild(d);
  }
}

async function updateMeter() {
  try {
    const used = await fbUsage();
    const gb = used / (1024 ** 3);
    $("meterText").textContent = gb < 0.01 && used > 0
      ? `${fmtKB(used)} of 5 GB used`
      : `${gb.toFixed(2).replace(/\.00$/, "")} GB of 5 GB used`;
    if (used === 0) $("meterText").textContent = "0 GB of 5 GB used";
    $("meterFill").style.width = Math.max(used > 0 ? 1 : 0, (used / QUOTA_BYTES) * 100) + "%";
  } catch (e) { console.error(e); }
}

async function refresh() {
  if (!unlocked) return;
  selected.clear();
  $("deleteBtn").disabled = true;
  renderCrumbs();
  setStatus(demoMode ? "Demo mode: add your Firebase config in script.js to go live." : "Loading…");
  try {
    entries = await fbList(currentPath);
    renderFiles();
    updateMeter();
    if (!demoMode) setStatus("");
    $("nexusIndicator").classList.remove("offline");
    $("nexusIndicator").querySelector(".nexus-text").textContent = "X-Nexus: Linked";
  } catch (e) {
    console.error(e);
    setStatus("Could not reach storage: " + e.message, true);
    $("nexusIndicator").classList.add("offline");
    $("nexusIndicator").querySelector(".nexus-text").textContent = "X-Nexus: Offline";
  }
}

/* ---------- action bar ---------- */
$("uploadBtn").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  for (const f of files) {
    setStatus(`Uploading ${f.name}…`);
    try { await fbUpload(`${currentPath}/${f.name}`, f, f.type || "text/plain"); }
    catch (err) { setStatus(`Upload failed: ${err.message}`, true); return; }
  }
  setStatus(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`);
  refresh();
});

$("folderBtn").addEventListener("click", async () => {
  const name = (prompt("New folder name:") || "").trim().replace(/[\/\\]/g, "-");
  if (!name) return;
  try { await fbMkdir(`${currentPath}/${name}`); refresh(); }
  catch (err) { setStatus("Could not create folder: " + err.message, true); }
});

$("deleteBtn").addEventListener("click", async () => {
  if (!selected.size) return;
  if (!confirm(`Delete ${selected.size} item(s)? Folders are deleted with everything inside.`)) return;
  try {
    for (const p of [...selected]) await fbDelete(p);
    setStatus("Deleted.");
    refresh();
  } catch (err) { setStatus("Delete failed: " + err.message, true); }
});

/* ==========================================================================
   X-NEXUS API  (for Xelvis)
   All calls require the gate to have been passed in this session.
   Paths are relative to the X-Cloud root, e.g. "Xelvis_Logs/today.log".
   ========================================================================== */
function requireUnlocked() {
  if (!unlocked) throw new Error("X-Nexus: X-Cloud is locked. Pass the security gate first.");
}

window.XNexus = {
  version: "1.0.0",

  /** { linked, mode, unlocked } */
  status() {
    return { linked: unlocked && (demoMode ? false : true), mode: demoMode ? "demo" : "firebase", unlocked };
  },

  /** List entries in a folder. Returns [{ name, path, size, type }] */
  async listFiles(path = "") {
    requireUnlocked();
    return fbList(path);
  },

  /** Upload text content as a file. XNexus.uploadText("Xelvis_Logs/a.md", "# hi") */
  async uploadText(name, content, path = "") {
    requireUnlocked();
    const full = path ? `${path}/${name}` : name;
    const ext = full.split(".").pop().toLowerCase();
    const types = { json: "application/json", csv: "text/csv", md: "text/markdown", html: "text/html", js: "text/javascript" };
    const r = await fbUpload(full, String(content), types[ext] || "text/plain");
    if (unlocked && !app.hidden) refresh();
    return r;
  },

  /** Read a text file's content. */
  async readText(path) {
    requireUnlocked();
    return fbRead(path);
  },

  /** Delete a file (or folder + contents). */
  async deleteFile(path) {
    requireUnlocked();
    if (!path) throw new Error("XNexus.deleteFile(path): path is required.");
    await fbDelete(path);
    if (unlocked && !app.hidden) refresh();
    return true;
  },

  /** Create an empty folder. */
  async createFolder(path) {
    requireUnlocked();
    await fbMkdir(path);
    if (unlocked && !app.hidden) refresh();
    return true;
  },

  /** Bytes used across the whole cloud. */
  async usage() {
    requireUnlocked();
    return { usedBytes: await fbUsage(), quotaBytes: QUOTA_BYTES };
  }
};

showScreen(1);
