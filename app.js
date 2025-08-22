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

  if (expired.length) {
    const arch = loadArchive();
    saveArchive([...expired, ...arch]); // newest archived first
  }

  if (fresh.length !== arr.length) localStorage.setItem(LS_KEY, JSON.stringify(fresh));
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
const fileInput   = document.getElementById("fileInput");         // hidden fallback
const bubbleInput = document.getElementById("addBubbleInput");    // visible overlay inside bubble

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
let useArchive     = false;
let timer = null;
let progressTimer = null;

/* ========= Helpers ========= */
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

/* ---- size helper for dataURLs ---- */
function base64Bytes(dataURL){
  const i = dataURL.indexOf(",") + 1;
  const len = dataURL.length - i;
  let bytes = Math.floor(len * 3/4);
  if (dataURL.endsWith("==")) bytes -= 2;
  else if (dataURL.endsWith("=")) bytes -= 1;
  return bytes;
}

/* ---- lightweight image compression so photos fit localStorage ---- */
async function fileToBitmap(file){
  const buf = await file.arrayBuffer();
  return await createImageBitmap(new Blob([buf]));
}
async function compressImageFile(file, maxW = 1280, quality = 0.82){
  // Try bitmap → canvas. If decode fails (e.g., HEIC), fallback to raw reader.
  try{
    const img = await fileToBitmap(file);
    const scale = Math.min(1, maxW / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha:false });
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  }catch{
    return await toDataURL(file); // might be large; we’ll size-check later
  }
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
window.renderStrip = renderStrip;

/* ========= Viewer ========= */
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
  useArchive = false;
}
function prev(){ clearTimers(); const L = items().length; currentIndex = (currentIndex - 1 + L) % L; showCurrent(); }
function next(){ clearTimers(); const L = items().length; currentIndex = (currentIndex + 1) % L; showCurrent(); }

/* ========= Add (compress large images; videos must be small) ========= */
async function handleFiles(files){
  const MAX_BYTES = 4.5 * 1024 * 1024; // ~4.5MB per item

  for (const f of files) {
    const kind =
      f.type.startsWith("video/") ? "video" :
      f.type.startsWith("image/") ? "image" : "other";
    if (kind === "other") continue;

    let data;

    if (kind === "image") {
      // compress in steps until it fits
      data = await compressImageFile(f, 1280, 0.82);
      if (base64Bytes(data) > MAX_BYTES) data = await compressImageFile(f, 1024, 0.76);
      if (base64Bytes(data) > MAX_BYTES) data = await compressImageFile(f, 800, 0.72);
      if (base64Bytes(data) > MAX_BYTES) {
        alert(`"${f.name}" is still too large after compression and was skipped.`);
        continue;
      }
    } else {
      // videos: keep your limit; ask user to trim if too big
      if (f.size > MAX_BYTES) {
        alert(`"${f.name}" is larger than 4.5MB and was skipped. Use a shorter clip.`);
        continue;
      }
      data = await toDataURL(f);
    }

    stories.unshift({ id: uid(), kind, data, createdAt: now() });
  }

  save(stories);
  renderStrip();
  setEmptyHint();
}
window.handleAddStories = handleFiles;

/* ========= Swipe ========= */
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
  // 1) The overlay input inside the bubble (iOS-friendly)
  bubbleInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await handleFiles(files);
    bubbleInput.value = "";
  });

  // 2) Keep your hidden input path for Android/Desktop & old code
  fileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await handleFiles(files);
    fileInput.value = "";
  });

  // 3) Archive button opens archive in viewer
  archiveBtn?.addEventListener("click", () => {
    archiveStories = loadArchive();
    if (!archiveStories.length) { alert("No archived stories yet."); return; }
    openViewer(0, true);
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
  renderStrip();
  bindEvents();
  setEmptyHint();
});
