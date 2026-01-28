/**
 * OMNI RESEARCH - CONTENT SCRIPT
 * Final Cleaned Version with Collision Detection & Inline Notes
 */

let lastRightClickElement = null;

// 1. TRACK CONTEXT: For right-click removal
document.addEventListener("contextmenu", (e) => {
    lastRightClickElement = e.target;
});

// 2. LISTEN: Commands from the Background Service Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DO_HIGHLIGHT") {
        const selection = window.getSelection();
        if (selection.toString().length > 0) {
            executeHighlight(selection, request.mode === "note");
        }
    }
    if (request.action === "REMOVE_AT_CURSOR") {
        const mark = lastRightClickElement?.closest('mark.omni-highlight');
        if (mark) {
            removeHighlight(mark);
        } else {
            alert("No highlight found under cursor to remove.");
        }
    }
});

// 3. EXECUTE: The "macOS Preview" style logic
async function executeHighlight(selection, isNoteMode) {
    const range = selection.getRangeAt(0);
    
    // COLLISION DETECTION: Clean up overlaps before highlighting
    const container = range.commonAncestorContainer;
    const parentElement = container.nodeType === 3 ? container.parentElement : container;
    
    if (parentElement.closest('.omni-highlight')) {
        const existingMark = parentElement.closest('.omni-highlight');
        await removeHighlight(existingMark); // Wait for cleanup
        selection = window.getSelection(); // Refresh selection
    }

    const ann = {
        id: Date.now().toString(),
        url: window.location.href,
        title: document.title,
        path: getDomPath(range.startContainer),
        text: selection.toString(),
        note: "",
        timestamp: new Date().toISOString()
    };

    const mark = applyMarkToRange(range, ann);
    if (!mark) return;

    selection.removeAllRanges();

    if (isNoteMode) {
        createInlineEditor(mark, ann);
    } else {
        saveToStorage(ann);
    }
}

// 4. EDITOR: The Inline Editor logic
function createInlineEditor(mark, ann) {
    const editor = document.createElement("span");
    editor.className = "omni-editor";
    editor.contentEditable = true;
    editor.textContent = "type note...";
    
    mark.after(editor);
    editor.focus();

    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editor.onblur = async () => {
        const val = editor.textContent.trim();
        if (val === "" || val === "type note...") {
            editor.remove();
            ann.note = "";
        } else {
            ann.note = val;
            editor.className = "omni-note-display";
            editor.contentEditable = false;
        }
        saveToStorage(ann);
    };

    editor.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            editor.blur();
        }
    };
}

// 5. RENDER: Physical DOM insertion
function applyMarkToRange(range, ann) {
    const mark = document.createElement("mark");
    mark.className = "omni-highlight";
    mark.dataset.id = ann.id;
    
    try {
        range.surroundContents(mark);
    } catch (e) {
        try {
            const contents = range.extractContents();
            mark.appendChild(contents);
            range.insertNode(mark);
        } catch (innerError) {
            console.error("Highlight Failure:", innerError);
            return null;
        }
    }

    if (ann.note) {
        const noteDisp = document.createElement("span");
        noteDisp.className = "omni-note-display";
        noteDisp.textContent = ann.note;
        mark.after(noteDisp);
    }
    return mark;
}

// 6. STORAGE & REMOVAL
async function saveToStorage(ann) {
    const data = await chrome.storage.local.get("annotations");
    const all = data.annotations || [];
    const index = all.findIndex(a => a.id === ann.id);
    if (index > -1) { all[index] = ann; } else { all.push(ann); }
    await chrome.storage.local.set({ annotations: all });
}

async function removeHighlight(mark) {
    const id = mark.dataset.id;
    const data = await chrome.storage.local.get("annotations");
    const filtered = (data.annotations || []).filter(a => a.id !== id);
    await chrome.storage.local.set({ annotations: filtered });
    
    const next = mark.nextSibling;
    if (next && (next.className === "omni-note-display" || next.className === "omni-editor")) {
        next.remove();
    }

    const parent = mark.parentNode;
    if (parent) {
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();
    }
}

// RESTORE & PATHING
const init = async () => {
    const data = await chrome.storage.local.get("annotations");
    const pageAnnotations = data.annotations?.filter(ann => ann.url === window.location.href) || [];
    pageAnnotations.forEach(ann => {
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
    });
};

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