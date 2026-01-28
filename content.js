// --- INITIALIZATION ---
const init = async () => {
  const data = await chrome.storage.local.get("annotations");
  const pageAnnotations = data.annotations?.filter(ann => ann.url === window.location.href) || [];
  pageAnnotations.forEach(restoreHighlight);
};

// --- CORE HIGHLIGHTING LOGIC ---
document.addEventListener("mouseup", (e) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (text.length > 0) {
    showActionMenu(e.pageX, e.pageY, selection);
  } else {
    const menu = document.getElementById("omni-action-menu");
    if (menu) menu.remove();
  }
});

function showActionMenu(x, y, selection) {
  if (document.getElementById("omni-action-menu")) return;

  const menu = document.createElement("div");
  menu.id = "omni-action-menu";
  Object.assign(menu.style, {
    position: 'absolute', left: `${x}px`, top: `${y - 50}px`, zIndex: '2147483647',
    background: '#333', color: 'white', padding: '8px 12px', borderRadius: '8px',
    display: 'flex', gap: '10px', cursor: 'pointer', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
  });

  menu.innerHTML = `<span id="omni-h">Highlight</span> | <span id="omni-n">Note</span>`;
  document.body.appendChild(menu);

  document.getElementById("omni-h").onclick = () => { execute(selection); menu.remove(); };
  document.getElementById("omni-n").onclick = () => { 
    const note = prompt("Enter note:"); 
    if (note !== null) execute(selection, note);
    menu.remove();
  };
}

async function execute(selection, note = "") {
  const range = selection.getRangeAt(0);
  const ann = {
    id: Date.now().toString(),
    url: window.location.href,
    title: document.title,
    text: selection.toString(),
    path: getDomPath(range.startContainer),
    note: note,
    timestamp: new Date().toISOString()
  };

  const data = await chrome.storage.local.get("annotations");
  const all = data.annotations || [];
  all.push(ann);
  await chrome.storage.local.set({ annotations: all });

  applyMarkToRange(range, ann);
  selection.removeAllRanges();
}

function applyMarkToRange(range, ann) {
  const mark = document.createElement("mark");
  mark.className = "omni-highlight";
  mark.dataset.id = ann.id;
  if (ann.note) mark.title = `Note: ${ann.note}`;

  // Double-click to delete logic
  mark.addEventListener("dblclick", async (e) => {
    if (confirm("Delete this highlight?")) {
      const data = await chrome.storage.local.get("annotations");
      const filtered = data.annotations.filter(a => a.id !== ann.id);
      await chrome.storage.local.set({ annotations: filtered });
      
      // Un-wrap the mark
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize(); 
    }
  });

  try {
    range.surroundContents(mark);
  } catch (e) {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
}

function restoreHighlight(ann) {
  const parent = document.querySelector(ann.path);
  if (!parent) return;

  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while(node = walker.nextNode()) {
    const index = node.textContent.indexOf(ann.text);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + ann.text.length);
      applyMarkToRange(range, ann);
      break;
    }
  }
}

function getDomPath(el) {
  if (!el || el.nodeType !== 1) el = el.parentElement;
  const stack = [];
  while (el && el.parentNode != null) {
    let sibIndex = 0, sibCount = 0;
    for (let i = 0; i < el.parentNode.childNodes.length; i++) {
      let sib = el.parentNode.childNodes[i];
      if (sib.nodeName == el.nodeName) {
        if (sib === el) sibIndex = sibCount;
        sibCount++;
      }
    }
    stack.unshift(`${el.nodeName.toLowerCase()}:nth-of-type(${sibIndex + 1})`);
    el = el.parentNode;
    if (el.nodeName === 'HTML') break;
  }
  return stack.join(" > ");
}

init();