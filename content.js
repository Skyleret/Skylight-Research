/**
 * RESEARCH TOOL - CONTENT SCRIPT
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const selection = window.getSelection();
    if (request.action === "OPEN_MENU") showFloatingMenu();
    else if (request.action === "QUICK_ACTION") executeHighlight(selection, request.isNote, request.color);
    else if (request.action === "SURGICAL_REMOVE") handleSurgicalRemove(selection);
});

function showFloatingMenu() {
    const selection = window.getSelection();
    if (selection.rangeCount === 0 || selection.toString().trim() === "") return;

    const oldMenu = document.getElementById("research-popup-menu");
    if (oldMenu) oldMenu.remove();

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.id = "research-popup-menu";
    Object.assign(menu.style, {
        position: "fixed", top: `${rect.top - 50}px`, left: `${rect.left}px`,
        zIndex: "2147483647", backgroundColor: "#222", padding: "8px",
        borderRadius: "20px", display: "flex", gap: "10px", boxShadow: "0 4px 15px rgba(0,0,0,0.4)"
    });

    const options = [
        { color: "#ffeb3b", label: "🟡", type: "HL" },
        { color: "#81d4fa", label: "🔵", type: "HL" },
        { color: "transparent", label: "🫥", type: "HL" },
        { color: null, label: "❌", type: "DEL" }
    ];

    options.forEach(opt => {
        const btn = document.createElement("button");
        btn.textContent = opt.label;
        btn.style.cssText = "background:none; border:none; cursor:pointer; font-size:18px;";
        btn.onclick = (e) => {
            if (opt.type === "DEL") handleSurgicalRemove(selection);
            else executeHighlight(selection, e.shiftKey, opt.color);
            menu.remove();
        };
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", closeMenu); }};
    document.addEventListener("mousedown", closeMenu);
}

// --- REPLACE YOUR executeHighlight AND handleSurgicalRemove WITH THIS ---

async function executeHighlight(selection, isNoteMode, colorCode) {
    if (selection.toString().trim().length === 0) return;
    const range = selection.getRangeAt(0);

    // Step 1: "Cut" this area out of any existing highlights (macOS Preview style)
    await surgicalProcess(range);

    // Step 2: Apply the new highlight to the now-clean area
    const ann = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: window.location.href,
        title: document.title,
        text: selection.toString(),
        path: getDomPath(range.startContainer),
        color: colorCode,
        note: "",
        timestamp: new Date().toISOString()
    };

    const mark = applyMarkToRange(range, ann);
    if (mark) {
        if (isNoteMode) createInlineEditor(mark, ann);
        else await saveToStorage(ann);
    }
    selection.removeAllRanges();
}

async function handleSurgicalRemove(selection) {
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    // Just run the process without adding anything new after
    await surgicalProcess(range);
    selection.removeAllRanges();
}

/**
 * THE MASTER BLADE: Splits or clears highlights based on a range
 */
async function surgicalProcess(userRange) {
    const allMarks = document.querySelectorAll('.research-highlight');
    
    // Find highlights that touch the user selection
    const targeted = Array.from(allMarks).filter(m => {
        const r = document.createRange();
        r.selectNodeContents(m);
        return !(userRange.compareBoundaryPoints(Range.END_TO_START, r) >= 0 || 
                 userRange.compareBoundaryPoints(Range.START_TO_END, r) <= 0);
    });

    for (const mark of targeted) {
        const oldColor = mark.style.backgroundColor;
        const markId = mark.dataset.id;
        const parent = mark.parentNode;
        
        const markRange = document.createRange();
        markRange.selectNodeContents(mark);

        // Calculate "Shrapnel" (prefix and suffix text)
        let t1 = "", t2 = "";
        if (markRange.compareBoundaryPoints(Range.START_TO_START, userRange) < 0) {
            const pre = markRange.cloneRange();
            pre.setEnd(userRange.startContainer, userRange.startOffset);
            t1 = pre.toString();
        }
        if (markRange.compareBoundaryPoints(Range.END_TO_END, userRange) > 0) {
            const post = markRange.cloneRange();
            post.setStart(userRange.endContainer, userRange.endOffset);
            t2 = post.toString();
        }

        // Clean up the old mark
        await deleteAnnotationData(markId);
        const next = mark.nextSibling;
        if (next?.classList?.contains("research-note") || next?.classList?.contains("research-editor")) {
            next.remove();
        }

        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();

        // Put the leftover pieces back with the old color
        if (t1.trim().length > 0) reHighlight(parent, t1, oldColor);
        if (t2.trim().length > 0) reHighlight(parent, t2, oldColor);
    }
}
function reHighlight(parent, text, color) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let node;
    while(node = walker.nextNode()) {
        const idx = node.textContent.indexOf(text);
        if (idx !== -1 && !node.parentElement.closest('.research-highlight')) {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + text.length);
            
            const ann = { 
                id: Date.now() + Math.random().toString(36).substr(2, 5), 
                url: window.location.href, 
                text: text, 
                path: getDomPath(node), 
                color: color, 
                note: "" 
            };
            
            applyMarkToRange(range, ann);
            saveToStorage(ann); // This makes sure the split highlight stays split
            break;
        }
    }
}

function createInlineEditor(mark, ann) {
    const editor = document.createElement("textarea");
    editor.className = "research-editor";
    editor.placeholder = "Note...";
    mark.after(editor);
    setTimeout(() => editor.focus(), 50);

    editor.onblur = async () => {
        const val = editor.value.trim();
        if (!val) editor.remove();
        else {
            ann.note = val;
            const disp = document.createElement("span");
            disp.className = "research-note";
            disp.textContent = val;
            editor.replaceWith(disp);
            await saveToStorage(ann);
        }
    };
}

function applyMarkToRange(range, ann) {
    const markClass = "research-highlight";
    
    // Check if the selection crosses multiple elements
    if (range.startContainer !== range.endContainer) {
        // COMPLEX HIGHLIGHT (The GeeksforGeeks Fix)
        const nodes = getNodesInRange(range);
        nodes.forEach(node => {
            const r = document.createRange();
            r.selectNodeContents(node);
            
            // Handle partial selections of the start/end nodes
            if (node === range.startContainer) r.setStart(node, range.startOffset);
            if (node === range.endContainer) r.setEnd(node, range.endOffset);
            
            const m = document.createElement("mark");
            m.className = markClass;
            m.dataset.id = ann.id;
            m.style.backgroundColor = ann.color;
            if (ann.color === "transparent") m.style.borderBottom = "1px dashed #ccc";
            
            try { r.surroundContents(m); } catch (e) { /* Skip non-text nodes */ }
        });
    } else {
        // SIMPLE HIGHLIGHT
        const m = document.createElement("mark");
        m.className = markClass;
        m.dataset.id = ann.id;
        m.style.backgroundColor = ann.color;
        if (ann.color === "transparent") m.style.borderBottom = "1px dashed #ccc";
        range.surroundContents(m);
    }

    // Attach Note to the very end of the selection
    if (ann.note) {
        const disp = document.createElement("span");
        disp.className = "research-note";
        disp.textContent = ann.note;
        
        // Find the last mark we just created to attach the note
        const allNewMarks = document.querySelectorAll(`[data-id="${ann.id}"]`);
        const lastMark = allNewMarks[allNewMarks.length - 1];
        if (lastMark) lastMark.after(disp);
    }
    
    return document.querySelector(`[data-id="${ann.id}"]`);
}

// Helper to find every text node between two points
function getNodesInRange(range) {
    const nodes = [];
    const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                const r = document.createRange();
                r.selectNodeContents(node);
                return range.compareBoundaryPoints(Range.END_TO_START, r) < 0 &&
                       range.compareBoundaryPoints(Range.START_TO_END, r) > 0
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) nodes.push(node);
    return nodes;
}
// Storage helpers
async function saveToStorage(ann) {
    const res = await chrome.storage.local.get("annotations");
    const list = res.annotations || [];
    const i = list.findIndex(a => a.id == ann.id);
    if (i > -1) list[i] = ann; else list.push(ann);
    await chrome.storage.local.set({ annotations: list });
}

async function deleteAnnotationData(id) {
    const res = await chrome.storage.local.get("annotations");
    const filtered = (res.annotations || []).filter(a => a.id != id);
    await chrome.storage.local.set({ annotations: filtered });
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

const init = async () => {
    const res = await chrome.storage.local.get("annotations");
    const pageAnns = res.annotations?.filter(a => a.url === window.location.href) || [];
    pageAnns.forEach(ann => {
        const parent = document.querySelector(ann.path);
        if (!parent) return;
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
        let node;
        while(node = walker.nextNode()) {
            const idx = node.textContent.indexOf(ann.text);
            if (idx !== -1 && !node.parentElement.closest('.research-highlight')) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + ann.text.length);
                applyMarkToRange(range, ann);
                break;
            }
        }
    });
};

init();