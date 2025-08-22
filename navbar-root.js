(() => {
  const mount = document.getElementById("app-navbar");
  if (!mount) return;

  const inSection = /\/section\//.test(location.pathname);
  const base = inSection ? "../" : "";

  // Render navbar + drawer
  mount.innerHTML = `
    <nav class="navbar">
      <div class="nav-inner">
        <div class="brand">
          <span class="dot"></span>
          <a href="${base}index.html" class="brand-link">24hr Stories</a>
        </div>

        <div class="nav-links" id="topLinks" role="navigation" aria-label="Main">
          <a href="${base}index.html" class="home-btn">Home</a>
          
          <a href="#" id="storyBtnTop" title="Add a story">STORY</a>
          <a href="${base}section/how.html">How it works</a>
          <a href="${base}section/about.html">About</a>
        </div>

        <button class="hamb" id="hamb" aria-label="Open menu"><span></span></button>
      </div>
    </nav>

    <div class="drawer" id="drawer" aria-hidden="true">
      <div class="drawer-panel">
        <button type="button" class="drawer-close" id="drawerClose" aria-label="Close menu"></button>
        <div id="drawerLinks">
          <a href="${base}index.html" class="home-btn" onclick="toggleDrawer(false)">Home</a>
          
          <a href="#" id="storyBtnDrawer" onclick="return false;" title="Add a story">STORY</a>
          <a href="${base}section/how.html" onclick="toggleDrawer(false)">How it works</a>
          <a href="${base}section/about.html" onclick="toggleDrawer(false)">About</a>
        </div>
      </div>
    </div>
  `;

  const hamb = document.getElementById("hamb");
  const drawer = document.getElementById("drawer");
  const drawerClose = document.getElementById("drawerClose");

  function toggleDrawer(open){
    if (open === undefined) open = !drawer.classList.contains("open");
    drawer.classList.toggle("open", open);
    hamb.classList.toggle("active", open);
    document.body.style.overflow = open ? "hidden" : "";
    drawer.setAttribute("aria-hidden", String(!open));
  }
  window.toggleDrawer = toggleDrawer;

  // STORY button handler — tries #fileInput, else redirects to index
  function openStoryFromNav(e){
    if (e) e.preventDefault();
    const input = document.getElementById("fileInput");
    if (input) {
      try {
        input.value = "";   // allow picking same file twice
        input.click();      // opens OS picker (user gesture)
      } catch (_) {
        // If something blocks programmatic click, fallback to navigating
        location.href = `${base}index.html#stories`;
      }
    } else {
      // If we're not on index.html, go there
      location.href = `${base}index.html#stories`;
    }
    // Close drawer if it was open
    toggleDrawer(false);
  }

  // Hook up controls
  const storyTop = document.getElementById("storyBtnTop");
  const storyDrawer = document.getElementById("storyBtnDrawer");
  storyTop?.addEventListener("click", openStoryFromNav);
  storyDrawer?.addEventListener("click", openStoryFromNav);

  hamb.addEventListener("click", () => toggleDrawer());
  drawer.addEventListener("click", (e) => { if (e.target === drawer) toggleDrawer(false); });
  drawerClose.addEventListener("click", () => toggleDrawer(false));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleDrawer(false); }, { passive:true });

  // ---- Self-heal: ensure "Home" exists in both places ----
  function ensureHome(){
    const topLinks = document.getElementById("topLinks");
    const drawerLinks = document.getElementById("drawerLinks");
    if (topLinks && !topLinks.querySelector('.home-btn')) {
      const a = document.createElement('a');
      a.href = `${base}index.html`;
      a.className = 'home-btn';
      a.textContent = 'Home';
      topLinks.prepend(a);
    }
    if (drawerLinks && !drawerLinks.querySelector('.home-btn')) {
      const a = document.createElement('a');
      a.href = `${base}index.html`;
      a.className = 'home-btn';
      a.textContent = 'Home';
      a.onclick = () => toggleDrawer(false);
      drawerLinks.prepend(a);
    }
  }
  ensureHome();
  setTimeout(ensureHome, 0);
})();
