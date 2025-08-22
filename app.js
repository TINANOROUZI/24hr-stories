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
function load() {
  const raw = localStorage.getItem(LS_KEY);
  let arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch {}
  const fresh = [], expired = [];
  const t = now();
  for (const s of arr) (t - (s.createdAt || 0) < DAY_MS ? fresh : expired).push(s);
  if (expired.length) {
    const arch = loadArchive(); saveArchive([...expired.map(e=>({...e, archivedAt:t})), ...arch]);
  }
  if (fresh.length !== arr.length) localStorage.setItem(LS_KEY, JSON.stringify(fresh));
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
const fileInput   = document.getElementById("fileInput");

const viewer      = document.getElementById("viewer");
const progressRow = document.getElementById("progressRow");
const closeBtn    = document.getElementById("closeBtn");
const prevBtn     = document.getElementById("prevBtn");
const nextBtn     = document.getElementById("nextBtn");
const imgEl       = document.getElementById("viewerImage");
const archiveBtn  = document.getElementById("archiveBtn");

let videoEl = null;

/* ========= State ========= */
let stories        = load();
let archiveStories = loadArchive();
let currentIndex   = 0;
let useArchive     = false;
let timer = null, progressTimer = null;

const items = () => (useArchive ? archiveStories : stories);
function setEmptyHint(){ if (emptyHint) emptyHint.style.display = stories.length ? "none" : "flex"; }
function el(tag, cls){ const n = document.createElement(tag); if (cls) n.className = cls; return n; }

/* ========= Image resize (mobile-safe) ========= */
const MAX_IMAGE_DIM   = 1400;
const JPEG_QUALITY    = 0.82;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

function readAsDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("readAsDataURL failed"));
    r.readAsDataURL(file);
  });
}
async function resizeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Image decode failed"));
      im.src = url;
    });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(iw, ih));
    const ow = Math.max(1, Math.round(iw * scale));
    const oh = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement("canvas");
    canvas.width = ow; canvas.height = oh;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, 0, 0, ow, oh);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally { URL.revokeObjectURL(url); }
}

/* ========= Strip ========= */
function renderStrip() {
  if (!strip) return;
  while (strip.children.length > 1) strip.removeChild(strip.lastElementChild);
  stories.forEach((s, i) => {
    const b = el("button", "bubble"); b.type = "button";
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
function ensureVideoEl(){
  if (videoEl) return videoEl;
  const v = document.createElement("video");
  v.style.width = "100%"; v.style.height = "100%"; v.style.objectFit = "contain";
  v.setAttribute("playsinline",""); v.setAttribute("webkit-playsinline","");
  v.controls = false; v.muted = false; v.preload = "auto";
  videoEl = v; return v;
}
function clearTimers(){ if (timer){clearTimeout(timer); timer=null;} if (progressTimer){clearInterval(progressTimer); progressTimer=null;} }
function buildProgress(){
  if (!progressRow) return;
  progressRow.innerHTML = "";
  items().forEach((_, i) => {
    const seg = el("div","segment"); const fill = el("div","segment-fill");
    seg.appendChild(fill); progressRow.appendChild(seg); if (i < currentIndex) seg.classList.add("done");
  });
}
function setProgress(pct){
  if (!progressRow) return;
  const seg = progressRow.children[currentIndex]; if (!seg) return;
  const fill = seg.querySelector(".segment-fill"); if (fill) fill.style.width = `${pct}%`;
}
function showCurrent(){
  clearTimers(); if (!viewer) return;
  const list = items(); const s = list[currentIndex]; if (!s) return;

  if (s.kind === "image") {
    if (videoEl?.parentNode) videoEl.parentNode.removeChild(videoEl);
    imgEl.src = s.data; imgEl.style.display = "block";
    const D = 3000, start = performance.now(); setProgress(0);
    progressTimer = setInterval(() => {
      const p = Math.min(1,(performance.now()-start)/D); setProgress(p*100);
      if (p >= 1){ clearInterval(progressTimer); progressTimer = null; }
    }, 50);
    timer = setTimeout(next, D);
  } else {
    const v = ensureVideoEl(); imgEl.style.display = "none"; imgEl.src = "";
    const mount = viewer.querySelector(".viewer-inner"); if (v.parentNode !== mount) mount.appendChild(v);
    v.src = s.data; v.currentTime = 0; v.play().catch(()=>{}); setProgress(0);
    v.addEventListener("loadedmetadata", () => {
      clearInterval(progressTimer);
      progressTimer = setInterval(() => {
        if (!isFinite(v.duration) || v.duration <= 0) return;
        setProgress((v.currentTime / v.duration) * 100);
      }, 80);
    }, { once:true });
    v.addEventListener("ended", () => next(), { once:true });
  }
  buildProgress();
}
function openViewer(i, archiveMode=false){
  useArchive = !!archiveMode; currentIndex = i;
  viewer.removeAttribute("hidden"); viewer.classList.add("open"); showCurrent();
}
function closeViewer(){
  clearTimers(); viewer.classList.remove("open");
  setTimeout(()=>viewer.setAttribute("hidden",""),200);
  if (videoEl){ videoEl.pause(); videoEl.src=""; }
  useArchive = false;
}
function prev(){ clearTimers(); const L = items().length; currentIndex = (currentIndex - 1 + L) % L; showCurrent(); }
function next(){ clearTimers(); const L = items().length; currentIndex = (currentIndex + 1) % L; showCurrent(); }

/* ========= Add ========= */
async function handleFiles(files){
  for (const f of files) {
    const isVideo = f.type.startsWith("video/");
    const isImage = f.type.startsWith("image/");
    if (!isVideo && !isImage) continue;

    try {
      if (isVideo) {
        if (f.size > MAX_VIDEO_BYTES) {
          alert(`"${f.name}" is too large for mobile storage (>${(MAX_VIDEO_BYTES/1024/1024)|0}MB). Please trim/compress and try again.`);
          continue;
        }
        const data = await readAsDataURL(f);
        stories.unshift({ id: uid(), kind: "video", data, createdAt: now() });
      } else {
        let data;
        try { data = await resizeImageFile(f); }
        catch { data = await readAsDataURL(f); }
        stories.unshift({ id: uid(), kind: "image", data, createdAt: now() });
      }
    } catch (err) {
      console.error("Add failed:", err);
      alert(`Could not add "${f.name}". Try a smaller file.`);
    }
  }
  save(stories); renderStrip(); setEmptyHint();
}
window.handleAddStories = handleFiles;

/* ========= Swipe ========= */
function enableSwipe(){
  const root = viewer?.querySelector(".viewer-inner"); if (!root) return;
  let startX=0,startY=0,dx=0,dy=0,swiping=false; const THRESH=40;
  const onStart = (e) => { const t = e.touches?e.touches[0]:e; startX=t.clientX; startY=t.clientY; dx=dy=0; swiping=true; };
  const onMove  = (e) => { if (!swiping) return; const t=e.touches?e.touches[0]:e; dx=t.clientX-startX; dy=t.clientY-startY; if (Math.abs(dx)>Math.abs(dy)) e.preventDefault(); };
  const onEnd   = () => { if (!swiping) return; if (Math.abs(dx)>Math.abs(dy) && Math.abs(dx)>THRESH) (dx<0?next():prev()); swiping=false; };
  root.addEventListener("touchstart", onStart, { passive:false });
  root.addEventListener("touchmove",  onMove,  { passive:false });
  root.addEventListener("touchend",   onEnd,   { passive:true  });
  root.addEventListener("pointerdown", onStart);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
}

/* ========= Bind ========= */
function bindEvents(){
  // هیچ کلیک برنامه‌ای روی input نداریم — خود input لمس می‌شود
  fileInput?.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    handleFiles(files).then(()=>{ fileInput.value=""; });
  });

  archiveBtn?.addEventListener("click", () => {
    archiveStories = loadArchive();
    if (!archiveStories.length) { alert("No archived stories yet."); return; }
    openViewer(0, true);
  });

  closeBtn?.addEventListener("click", closeViewer);
  prevBtn?.addEventListener("click", prev);
  nextBtn?.addEventListener("click", next);

  window.addEventListener("keydown", (e) => {
    if (viewer?.hasAttribute("hidden")) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });

  viewer?.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });

  enableSwipe();
}

/* ========= Init ========= */
document.addEventListener("DOMContentLoaded", () => {
  renderStrip(); bindEvents(); setEmptyHint();
});
