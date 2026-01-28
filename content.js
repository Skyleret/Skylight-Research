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
    
    // 1. Identify all existing highlights touched by the new selection
    const overlappingMarks = [];
    const allMarks = document.querySelectorAll('.omni-highlight');
    allMarks.forEach(mark => {
        if (selection.containsNode(mark, true)) {
            overlappingMarks.push(mark);
        }
    });

    // 2. If overlaps exist, we perform a "Merge"
    if (overlappingMarks.length > 0) {
        // Expand the range to cover the start of the first overlap and end of the last
        // This effectively "swallows" the old highlights into the new selection
        const newText = await handleMerge(overlappingMarks, selection);
        // After merging, the selection is updated. We proceed to highlight the new unified area.
    }

    // 3. Standard/Unified Highlight creation
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
        else await saveToStorage(ann);
    }
}

async function handleMerge(marks, selection) {
    for (const mark of marks) {
        const markId = mark.dataset.id;
        await deleteAnnotationData(markId); // Remove from storage
        
        // Remove associated notes/editors
        const next = mark.nextSibling;
        if (next && (next.className === "omni-note-display" || next.className === "omni-editor")) {
            next.remove();
        }

        // Unwrap the mark (keep text in DOM)
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();
    }
    // The selection now spans the raw text, ready to be re-wrapped by executeHighlight
}

// 4. SURGICAL REMOVE (The "Blade" Logic)
async function handleSurgicalRemove(selection) {
    if (selection.rangeCount === 0) return;
    const userRange = selection.getRangeAt(0);
    const allMarks = document.querySelectorAll('.omni-highlight');

    for (const mark of Array.from(allMarks)) {
        // Only process if the selection actually touches this specific highlight
        if (selection.containsNode(mark, true)) {
            const markRange = document.createRange();
            markRange.selectNodeContents(mark);

            // 1. Capture the data before we destroy the node
            const markId = mark.dataset.id;
            const parent = mark.parentNode;
            await deleteAnnotationData(markId);

            // Remove associated note UI
            const next = mark.nextSibling;
            if (next && (next.className === "omni-note-display" || next.className === "omni-editor")) {
                next.remove();
            }

            // 2. Identify "Shrapnel" - what remains AFTER the cut?
            // Part A: Text before the selection
            const preCutRange = markRange.cloneRange();
            preCutRange.setEnd(userRange.startContainer, userRange.startOffset);
            
            // Part B: Text after the selection
            const postCutRange = markRange.cloneRange();
            postCutRange.setStart(userRange.endContainer, userRange.endOffset);

            const preText = preCutRange.toString();
            const postText = postCutRange.toString();

            // 3. Unwrap the original mark
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            mark.remove();
            parent.normalize();

            // 4. Re-apply highlights to the fragments
            if (preText.length > 0) reHighlightFragment(parent, preText);
            if (postText.length > 0) reHighlightFragment(parent, postText);
        }
    }
    selection.removeAllRanges();
}

function reHighlightFragment(parent, text) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while(node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index !== -1 && !node.parentElement.closest('.omni-highlight')) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + text.length);
            
            const ann = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
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

// Helper: Re-applies highlight to "leftover" bits after a surgical cut


// 5. EDITOR & RENDER LOGIC
function createInlineEditor(mark, ann) {
    // Check if an editor/note already exists to avoid duplicates
    if (mark.nextSibling?.classList.contains("omni-editor") || 
        mark.nextSibling?.classList.contains("omni-note-display")) {
        return;
    }

    const editor = document.createElement("span");
    editor.className = "omni-editor";
    editor.contentEditable = true;
    editor.textContent = ann.note || "type note...";
    
    // Style to ensure it doesn't "break" the line awkwardly
    Object.assign(editor.style, {
        display: "inline-block",
        marginLeft: "4px",
        padding: "0 4px",
        border: "1px solid #4a90e2",
        borderRadius: "3px",
        backgroundColor: "#fff",
        fontSize: "0.85em",
        fontStyle: "normal",
        color: "#333"
    });

    mark.after(editor);
    
    // Focus and select text
    setTimeout(() => {
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }, 10);

    editor.onblur = async () => {
        const val = editor.textContent.trim();
        if (val === "" || val === "type note...") {
            editor.remove();
        } else {
            ann.note = val;
            // Morph editor into display mode
            editor.className = "omni-note-display";
            editor.contentEditable = false;
            editor.removeAttribute('style'); // Use CSS classes instead
            await saveToStorage(ann);
        }
    };

    // Prevent 'Enter' from creating new divs inside the span
    editor.onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            editor.blur();
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