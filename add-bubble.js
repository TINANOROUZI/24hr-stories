// Fallback wiring in case anything blocks the main binding
document.addEventListener("DOMContentLoaded", () => {
  const addBtn = document.getElementById("addBubble");
  const input  = document.getElementById("fileInput");
  if (!addBtn || !input) return;

  const openPicker = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };

  // Double-bind is safe; this just guarantees a user-gesture handler exists
  ["pointerdown","click","keydown"].forEach(evt=>{
    addBtn.addEventListener(evt, (e)=>{
      if (evt==="keydown" && e.key !== "Enter" && e.key !== " ") return;
      openPicker(e);
    }, { passive:false });
  });

  // If app.js didn't bind change, handle here:
  if (!input.__bound) {
    input.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (typeof window.handleAddStories === "function") {
        await window.handleAddStories(files);
      }
      input.value = "";
    });
    input.__bound = true;
  }
});
