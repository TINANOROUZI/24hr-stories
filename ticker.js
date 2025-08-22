const TICKER_MESSAGES = [
  "Tip: Hold to pause a story.",
  "Stories auto-delete after 24 hours.",
  "Swipe on mobile • ← → keys on desktop.",
  "Use the + bubble or + Add a Story to upload."
];

const mount = document.getElementById("ticker-root");
mount.innerHTML = `
  <div class="ticker">
    <div class="ticker-row" id="tickerRow"></div>
  </div>
`;

const row = document.getElementById("tickerRow");
function fillRow(){
  const frag = document.createDocumentFragment();
  for(let r=0;r<2;r++){
    TICKER_MESSAGES.forEach(txt=>{
      const item = document.createElement("span");
      item.className = "ticker-item";
      item.innerHTML = `<span class="ticker-bullet"></span>${txt}`;
      frag.appendChild(item);
    });
  }
  return frag;
}
row.appendChild(fillRow());
