/**
 * OMNI RESEARCH - CONTENT SCRIPT
 * Features: Surgical Splitting, Inline Notes, and Unified Messaging
 */

let lastRightClickElement = null;

// 1. TRACK CONTEXT
document.addEventListener("contextmenu", (e) => {
    lastRightClickElement = e.target;
});

// 2. UNIFIED LISTENER (Merged Section)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const selection = window.getSelection();
    
    if (request.action === "DO_HIGHLIGHT") {
        if (selection.toString().length > 0) {
            executeHighlight(selection, request.mode === "note");
        }
    } else if (request.action === "SURGICAL_REMOVE") {
        handleSurgicalRemove(selection);
    }
});

// 3. SURGICAL HIGHLIGHT (Adding)
async function executeHighlight(selection, isNoteMode) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const parentMark = container.nodeType === 3 ? container.parentElement.closest('.omni-highlight') : container.closest('.omni-highlight');

    // If adding inside existing highlight, we don't double-highlight
    if (parentMark && !isNoteMode) return; 

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
    if (mark) {
        selection.removeAllRanges();
        if (isNoteMode) createInlineEditor(mark, ann);
        else saveToStorage(ann);
    }
}

// 4. SURGICAL REMOVE (The "Blade" Logic)
async function handleSurgicalRemove(selection) {
    if (selection.rangeCount === 0 || selection.toString().trim().length === 0) {
        // Fallback: If no selection, try to remove the highlight directly under the cursor
        const mark = lastRightClickElement?.closest('mark.omni-highlight');
        if (mark) removeHighlight(mark);
        return;
    }

    const selectedText = selection.toString();
    const allMarks = document.querySelectorAll('.omni-highlight');
    let intersected = [];

    allMarks.forEach(mark => {
        if (selection.containsNode(mark, true)) intersected.push(mark);
    });

    for (let mark of intersected) {
        const markId = mark.dataset.id;
        const parent = mark.parentNode;
        const fullText = mark.textContent;

        // Visual and Data Removal
        await deleteAnnotationData(markId);
        const next = mark.nextSibling;
        if (next && next.className === "omni-note-display") next.remove();
        
        // Remove the <span>/ <mark> but keep the text
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();

        // SPLITTING: Re-highlight parts that weren't selected
        const parts = fullText.split(selectedText);
        parts.forEach(textFragment => {
            if (textFragment.trim().length > 1) { // Only re-highlight meaningful fragments
                reHighlightFragment(parent, textFragment);
            }
        });
    }
    selection.removeAllRanges();
}

// Helper: Re-applies highlight to "leftover" bits after a surgical cut
function reHighlightFragment(parent, text) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while(node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + text.length);
            const ann = {
                id: Date.now().toString() + Math.random(),
                url: window.location.href,
                text: text,
                path: getDomPath(node),
                note: "",
                timestamp: new Date().toISOString()
            };
            applyMarkToRange(range, ann);
            saveToStorage(ann);
            break;
        }
    }
}

// 5. EDITOR & RENDER LOGIC
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
        } else {
            ann.note = val;
            editor.className = "omni-note-display";
            editor.contentEditable = false;
            saveToStorage(ann);
        }
    };
}

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
        } catch (err) { return null; }
    }
    if (ann.note) {
        const noteDisp = document.createElement("span");
        noteDisp.className = "omni-note-display";
        noteDisp.textContent = ann.note;
        mark.after(noteDisp);
    }
    return mark;
}

// 6. STORAGE UTILS
async function saveToStorage(ann) {
    const data = await chrome.storage.local.get("annotations");
    const all = data.annotations || [];
    const index = all.findIndex(a => a.id === ann.id);
    if (index > -1) all[index] = ann; else all.push(ann);
    await chrome.storage.local.set({ annotations: all });
}

async function deleteAnnotationData(id) {
    const data = await chrome.storage.local.get("annotations");
    const filtered = (data.annotations || []).filter(a => a.id !== id);
    await chrome.storage.local.set({ annotations: filtered });
}

async function removeHighlight(mark) {
    await deleteAnnotationData(mark.dataset.id);
    const next = mark.nextSibling;
    if (next && next.className === "omni-note-display") next.remove();
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    if (parent) parent.normalize();
}

// 7. INIT & DOM PATH
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