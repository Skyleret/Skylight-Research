// Global state for the current page
let pageAnnotations = [];

// 1. Initial Load: Fetch and Apply Highlights
const init = async () => {
  const data = await chrome.storage.local.get("annotations");
  pageAnnotations = data.annotations || [];
  const currentUrl = window.location.href;

  pageAnnotations
    .filter(ann => ann.url === currentUrl)
    .forEach(renderHighlight);
};

// 2. Selection Logic
document.addEventListener("mouseup", (e) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text.length > 0) {
    const range = selection.getRangeAt(0);
    const annotation = {
      id: Date.now(),
      url: window.location.href,
      title: document.title,
      text: text,
      path: getDomPath(range.startContainer),
      offset: range.startOffset,
      projectId: "default", // Can be updated via UI later
      timestamp: new Date().toISOString()
    };

    saveAnnotation(annotation);
    renderHighlight(annotation);
    selection.removeAllRanges(); // Clear blue browser selection
  }
});

// 3. Robust Rendering (Re-finding the text)
function renderHighlight(ann) {
  const parent = document.querySelector(ann.path);
  if (!parent) return;

  // Note: For production, use a more complex 'Text-Quote' anchor
  // but for a standalone MVP, this nth-child path is snappy.
  const mark = document.createElement("mark");
  mark.className = "omni-highlight";
  mark.dataset.id = ann.id;
  mark.textContent = ann.text;

  // Visual Styling (Hardcoded here for speed)
  mark.style.backgroundColor = "#ffeb3b";
  mark.style.cursor = "pointer";

  // Wrap the text
  const range = document.createRange();
  // Simplified logic: finds the first instance of text in that parent
  // Optimization: use startOffset for pinpoint accuracy
  range.selectNodeContents(parent); 
  // Custom logic usually goes here to narrow down exact text nodes
  parent.innerHTML = parent.innerHTML.replace(ann.text, `<mark class="omni-highlight">${ann.text}</mark>`);
}

async function saveAnnotation(ann) {
  const data = await chrome.storage.local.get("annotations");
  const all = data.annotations || [];
  all.push(ann);
  await chrome.storage.local.set({ annotations: all });
}

function getDomPath(el) {
  if (!el || el.nodeType !== 1) el = el.parentElement;
  const stack = [];
  while (el.parentNode != null) {
    let sibCount = 0;
    let sibIndex = 0;
    for (let i = 0; i < el.parentNode.childNodes.length; i++) {
      let sib = el.parentNode.childNodes[i];
      if (sib.nodeName == el.nodeName) {
        if (sib === el) sibIndex = sibCount;
        sibCount++;
      }
    }
    stack.unshift(`${el.nodeName.toLowerCase()}:nth-of-type(${sibIndex + 1})`);
    el = el.parentNode;
  }
  return stack.join(" > ");
}

init();