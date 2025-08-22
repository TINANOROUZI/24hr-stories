/* ========= Storage (24h + Archive) ========= */
const LS_KEY   = "stories_v2";
const LS_ARCH  = "stories_archive_v1";
const DAY_MS   = 24 * 60 * 60 * 1000;
const now      = () => Date.now();

function loadArchive() {
  const raw = localStorage.getItem(LS_ARCH);
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveArchive(items) {
  try { localStorage.setItem(LS_ARCH, JSON.stringify(items)); } catch {}
}

/** Load active stories; move any expired (>24h) to Archive instead of deleting */
function load() {
  const raw = localStorage.getItem(LS_KEY);
  let arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch {}

  const fresh = [];
  const expired = [];
  const t = now();
  for (const s of arr) {
    if (t - (s.createdAt || 0) < DAY_MS) fresh.push(s);
    else expired.push({ ...s, archivedAt: t });
  }

  // Move expired into archive (prepend so newest archive first)
  if (expired.length) {
    const arch = loadArchive();
    const merged = [...expired, ...arch];
    saveArchive(merged);
  }

  // Persist fresh back to active key
  if (fresh.length !== arr.length) {
    localStorage.setItem(LS_KEY, JSON.stringify(fresh));
  }
  return fresh;
}
function save(items) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)); }
  catch { alert("Storage full. Remove some stories."); }
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ========= Refs ========= */
const strip       = document.getElementById("storiesStrip");
const emptyHint   = document.getElementById("emptyHint");
const fileInput   = document.getElementById("fileInput");   // inside the + bubble

const viewer      = document.getElementById("viewer");
const progressRow = document.getElementById("progressRow");
const closeBtn    = document.getElementById("closeBtn");
const prevBtn     = document.getElementById("prevBtn");
const nextBtn     = document.getElementById("nextBtn");
const imgEl       = document.getElementById("viewerImage");

const archiveBtn  = document.getElementById("archiveBtn");

let videoEl = null;

/* ========= State ========= */
let stories        = load();          // active
let archiveStories = loadArchive();   // archived
let currentIndex   = 0;
let useArchive     = false;           // which list is in viewer
let timer = null;
let progressTimer = null;

/* Helpers */
const items = () => (useArchive ? archiveStories : stories);

function setEmptyHint() {
  if (!emptyHint) return;
  emptyHint.style.display = stories.length ? "none" : "flex";
}
function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
function toDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
}

/* ========= Render top strip (active stories only) ========= */
function renderStrip() {
  if (!strip) return;
  // keep first child (the + bubble)
  while (strip.children.length > 1) strip.removeChild(strip.lastElementChild);

  stories.forEach((s, i) => {
    const b = el("button", "bubble");
    b.type = "button";
    b.setAttribute("aria-label", "Open story");
    b.addEventListener("click", () => openViewer(i, false));

    if (s.kind === "image") {
      const img = el("img"); img.src = s.data; img.alt = "Story"; b.appendChild(img);
    } else {
      const vid = el("video"); vid.src = s.data; vid.muted = true; vid.playsInline = true; vid.preload = "metadata"; b.appendChild(vid);
    }
    strip.appendChild(b);
  });

  setEmptyHint();
}
window.renderStrip = renderStrip; // external access if needed

/* ========= Viewer (works for active OR archive) ========= */
function ensureVideoEl() {
  if (videoEl) return videoEl;
  const v = document.createElement("video");
  v.style.width = "100%"; v.style.height = "100%"; v.style.objectFit = "contain";
  v.setAttribute("playsinline",""); v.setAttribute("webkit-playsinline","");
  v.controls = false; v.muted = false; v.preload = "auto";
  videoEl = v; return v;
}
function clearTimers(){ if (timer){clearTimeout(timer); timer=null;} if (progressTimer){clearInterval(progressTimer); progressTimer=null;} }
function buildProgress(){
  progressRow.innerHTML = "";
  items().forEach((_, i) => {
    const seg = el("div","segment"); const fill = el("div","segment-fill");
    seg.appendChild(fill); progressRow.appendChild(seg); if (i < currentIndex) seg.classList.add("done");
  });
}
function setProgress(pct){
  const seg = progressRow.children[currentIndex]; if (!seg) return;
  const fill = seg.querySelector(".segment-fill"); if (fill) fill.style.width = `${pct}%`;
}
function showCurrent(){
  clearTimers(); if (!viewer) return;
  const list = items();
  const s = list[currentIndex]; if (!s) return;

  if (s.kind === "image") {
    if (videoEl?.parentNode) videoEl.parentNode.removeChild(videoEl);
    imgEl.src = s.data; imgEl.style.display = "block";
    const D = 3000;
    const start = performance.now(); setProgress(0);
    progressTimer = setInterval(() => {
      const p = Math.min(1,(performance.now()-start)/D); setProgress(p*100);
      if (p >= 1){ clearInterval(progressTimer); progressTimer = null; }
    }, 50);
    timer = setTimeout(next, D);
  } else {
    const v = ensureVideoEl(); imgEl.style.display = "none"; imgEl.src = "";
    if (v.parentNode !== viewer.querySelector(".viewer-inner")) viewer.querySelector(".viewer-inner").appendChild(v);
    v.src = s.data; v.currentTime = 0; v.play().catch(()=>{}); setProgress(0);
    const onMeta = () => {
      clearInterval(progressTimer);
      progressTimer = setInterval(() => {
        if (!isFinite(v.duration) || v.duration <= 0) return;
        setProgress((v.currentTime / v.duration) * 100);
      }, 80);
    };
    v.removeEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadedmetadata", onMeta, { once:true });
    const onEnded = () => next();
    v.removeEventListener("ended", onEnded);
    v.addEventListener("ended", onEnded, { once:true });
  }
  buildProgress();
}
function openViewer(i, archiveMode=false){
  useArchive = !!archiveMode;
  currentIndex = i;
  viewer.removeAttribute("hidden");
  viewer.classList.add("open");
  showCurrent();
}
function closeViewer(){
  clearTimers(); viewer.classList.remove("open");
  setTimeout(()=>viewer.setAttribute("hidden",""),200);
  if (videoEl){ videoEl.pause(); videoEl.src=""; }
  useArchive = false; // reset to normal after closing
}
function prev(){ clearTimers(); const L = items().length; currentIndex = (currentIndex - 1 + L) % L; showCurrent(); }
function next(){ clearTimers(); const L = items().length; currentIndex = (currentIndex + 1) % L; showCurrent(); }

/* ========= Add (base64 in localStorage; expiry handled by load()) ========= */
async function handleFiles(files){
  const MAX_MB = 4.5, maxBytes = MAX_MB * 1024 * 1024;
  for (const f of files) {
    if (f.size > maxBytes) { alert(`"${f.name}" is larger than ${MAX_MB}MB and was skipped.`); continue; }
    const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "image" : "other";
    if (kind === "other") continue;
    const data = await toDataURL(f);
    stories.unshift({ id: uid(), kind, data, createdAt: now() });
  }
  save(stories); renderStrip(); setEmptyHint();
}
window.handleAddStories = handleFiles;

/* ========= Swipe gestures (existing) ========= */
function enableSwipe(){
  const root = viewer?.querySelector(".viewer-inner");
  if (!root) return;

  let startX = 0, startY = 0, dx = 0, dy = 0, swiping = false;
  const THRESH = 40;

  const onStart = (e) => {
    const t = e.touches ? e.touches[0] : e; startX = t.clientX; startY = t.clientY; dx = dy = 0; swiping = true;
  };
  const onMove = (e) => {
    if (!swiping) return;
    const t = e.touches ? e.touches[0] : e; dx = t.clientX - startX; dy = t.clientY - startY;
    if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
  };
  const onEnd = () => {
    if (!swiping) return;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > THRESH) { dx < 0 ? next() : prev(); }
    swiping = false;
  };

  root.addEventListener("touchstart", onStart, { passive:false });
  root.addEventListener("touchmove",  onMove,  { passive:false });
  root.addEventListener("touchend",   onEnd,   { passive:true  });
  root.addEventListener("pointerdown", onStart);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
}

/* ========= Bind UI ========= */
function bindEvents(){
  // + button already in DOM; use the offscreen input for reliability (iOS)
  const addBtn = document.getElementById("addBubble");
  const openPicker = (e) => { e.preventDefault(); e.stopPropagation(); fileInput?.click(); };
  ["pointerdown","click","keydown"].forEach(evt=>{
    addBtn?.addEventListener(evt, (e)=>{
      if (evt==="keydown" && e.key !== "Enter" && e.key !== " ") return;
      openPicker(e);
    });
  });

  fileInput?.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    handleFiles(files).then(()=>{ fileInput.value=""; });
  });

  // Archive button -> open viewer in archive mode
  archiveBtn?.addEventListener("click", () => {
    archiveStories = loadArchive(); // refresh (maybe new items moved since load)
    if (!archiveStories.length) {
      alert("No archived stories yet.");
      return;
    }
    openViewer(0, true); // start from most recent archived
  });

  closeBtn?.addEventListener("click", closeViewer);
  prevBtn?.addEventListener("click", prev);
  nextBtn?.addEventListener("click", next);

  window.addEventListener("keydown", (e) => {
    if (viewer.hasAttribute("hidden")) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });

  viewer?.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });

  enableSwipe();
}

/* ========= Init ========= */
document.addEventListener("DOMContentLoaded", () => {
  // sweep happened in load(); archiveStories already loaded
  renderStrip();
  bindEvents();
  setEmptyHint();
});
