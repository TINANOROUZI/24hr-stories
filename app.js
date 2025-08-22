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
  catch { alert("Storage full on this device. Remove some stories or add smaller media."); }
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ========= Refs ========= */
const strip       = document.getElementById("storiesStrip");
const emptyHint   = document.getElementById("emptyHint");
const fileInput   = document.getElementById("fileInput");   // now INSIDE the + bubble

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

/* ======== Mobile-safe image preprocessing (resize + compress) ======== */
const MAX_IMAGE_DIM = 1400;      // px (longest side)
const JPEG_QUALITY  = 0.82;      // ~good balance
const MAX_VIDEO_BYTES = 4 * 1024 * 1024; // 4MB cap for videos (base64 would be even larger)

function fileToObjectURL(file) {
  return URL.createObjectURL(file);
}
function revoke(url){ try { URL.revokeObjectURL(url); } catch {} }

async function resizeImageFile(file) {
  // Try to decode via <img>, draw to canvas, export JPEG
  const url = fileToObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Image decode failed"));
      im.src = url;
    });

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error("Bad image dimensions");

    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(iw, ih));
    const ow = Math.max(1, Math.round(iw * scale));
    const oh = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement("canvas");
    canvas.width = ow; canvas.height = oh;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, 0, 0, ow, oh);

    // Export as JPEG to shrink size and ensure cross-browser display
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataUrl;
  } finally {
    revoke(url);
  }
}

function readAsDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("readAsDataURL failed"));
    r.readAsDataURL(file);
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
  useArchive = false; // reset to normal after closing
}
function prev(){ clearTimers(); const L = items().length; currentIndex = (currentIndex - 1 + L) % L; showCurrent(); }
function next(){ clearTimers(); const L = items().length; currentIndex = (currentIndex + 1) % L; showCurrent(); }

/* ========= Add (resize images, limit videos) ========= */
async function handleFiles(files){
  for (const f of files) {
    const isVideo = f.type.startsWith("video/");
    const isImage = f.type.startsWith("image/");

    if (!isVideo && !isImage) continue;

    try {
      if (isVideo) {
        if (f.size > MAX_VIDEO_BYTES) {
          alert(`"${f.name}" is too large for mobile storage (>${(MAX_VIDEO_BYTES/1024/1024)|0}MB). Please trim/compress the video and try again.`);
          continue;
        }
        // Videos are saved as base64 too; small only
        const data = await readAsDataURL(f);
        stories.unshift({ id: uid(), kind: "video", data, createdAt: now() });
      } else {
        // Always resize/compress images before storing (mobile-safe)
        let data;
        try {
          data = await resizeImageFile(f);
        } catch {
          // Fallback: store original as data URL (may fail quota on iOS)
          data = await readAsDataURL(f);
        }
        stories.unshift({ id: uid(), kind: "image", data, createdAt: now() });
      }
    } catch (err) {
      console.error("Add failed:", err);
      alert(`Could not add "${f.name}". Please try a smaller file.`);
    }
  }

  save(stories);
  renderStrip();
  setEmptyHint();
}
window.handleAddStories = handleFiles;

/* ========= Swipe gestures ========= */
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
  // IMPORTANT: we no longer programmatically .click() a hidden input.
  // The input sits INSIDE the + bubble and captures the tap directly (mobile-safe).
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
  renderStrip();
  bindEvents();
  setEmptyHint();
});
