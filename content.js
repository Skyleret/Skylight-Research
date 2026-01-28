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
    
    const originalText = selection.toString();
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const parent = container.nodeType === 3 ? container.parentNode : container;
    
    const preRange = document.createRange();
    preRange.selectNodeContents(parent);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffsetInParent = preRange.toString().length;

    const oldNotes = await surgicalProcess(range, colorCode);

    const newRange = findRangeWithContext(parent, originalText, startOffsetInParent);
    if (!newRange) return;

    const ann = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: window.location.href,
        title: document.title,
        text: originalText,
        path: getDomPath(newRange.startContainer),
        color: colorCode,
        note: oldNotes || "",
        timestamp: new Date().toISOString()
    };

    const mark = applyMarkToRange(newRange, ann);
    
    if (mark) {
        await saveToStorage(ann);
        if (isNoteMode) {
            // Tiny delay to ensure the DOM has painted the new <mark>
            const firstMark = document.querySelector(`[data-id="${ann.id}"]`);
            setTimeout(() => createInlineEditor(mark, ann), 10);
        }
    }
    
    window.getSelection().removeAllRanges();
}

/**
 * RE-LOCATE TEXT WITH CONTEXT
 * This replaces the "indexOf" logic to prevent random jumps.
 */
function findRangeWithContext(parent, targetText, targetOffsetInParent) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let currentTotalOffset = 0;
    let node;
    const range = document.createRange();
    let foundStart = false;

    while (node = walker.nextNode()) {
        const nodeLength = node.textContent.length;
        
        // Check if our target selection starts in this text node
        if (!foundStart && currentTotalOffset + nodeLength > targetOffsetInParent) {
            range.setStart(node, targetOffsetInParent - currentTotalOffset);
            foundStart = true;
        }
        
        // Check if our target selection ends in this (or a later) text node
        if (foundStart && currentTotalOffset + nodeLength >= targetOffsetInParent + targetText.length) {
            range.setEnd(node, (targetOffsetInParent + targetText.length) - currentTotalOffset);
            return range;
        }
        currentTotalOffset += nodeLength;
    }
    return null;
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
async function surgicalProcess(userRange, newColor = null) {
    const allMarks = document.querySelectorAll('.research-highlight');
    
    // 1. IMPORTANT: Extract the plain data from the range before we break the DOM
    const targetText = userRange.toString();
    const targetStartContainer = userRange.startContainer;
    const targetStartOffset = userRange.startOffset;

    const targeted = Array.from(allMarks).filter(m => {
        const r = document.createRange();
        r.selectNodeContents(m);
        return !(userRange.compareBoundaryPoints(Range.END_TO_START, r) >= 0 || 
                 userRange.compareBoundaryPoints(Range.START_TO_END, r) <= 0);
    });

    let migratedNotes = [];

    for (const mark of targeted) {
        const oldColor = mark.style.backgroundColor;
        const markId = mark.dataset.id;
        const parent = mark.parentNode;
        
        // Grab note
        const data = await chrome.storage.local.get("annotations");
        const oldAnn = (data.annotations || []).find(a => a.id === markId);
        if (oldAnn?.note) migratedNotes.push(oldAnn.note);

        const markRange = document.createRange();
        markRange.selectNodeContents(mark);

        // Calculate Shrapnel
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

        await deleteAnnotationData(markId);
        const next = mark.nextSibling;
        if (next?.classList?.contains("research-note") || next?.classList?.contains("research-editor")) {
            next.remove();
        }

        // UNWRAP
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        // DON'T normalize inside the loop!
        
        if (newColor !== oldColor) {
            if (t1.trim().length > 0) await reHighlight(parent, t1, oldColor);
            if (t2.trim().length > 0) await reHighlight(parent, t2, oldColor);
        }
    }
    
    // Clean up the DOM once everything is unwrapped
    document.body.normalize(); 
    
    return migratedNotes.join(" | ");
}
async function reHighlight(parent, text, color) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let node;
    while(node = walker.nextNode()) {
        const idx = node.textContent.indexOf(text);
        if (idx !== -1 && !node.parentElement.closest('.research-highlight')) {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + text.length);
            
            const ann = { 
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
                url: window.location.href, 
                title: document.title,
                text: text, 
                path: getDomPath(node), 
                color: color, 
                note: "" 
            };
            
            applyMarkToRange(range, ann);
            await saveToStorage(ann); // MUST BE AWAITED
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
    
    // Check if the selection is complex (crosses multiple nodes)
    if (range.startContainer !== range.endContainer) {
        const nodes = getNodesInRange(range);
        nodes.forEach(node => {
            const r = document.createRange();
            r.selectNodeContents(node);
            
            if (node === range.startContainer) r.setStart(node, range.startOffset);
            if (node === range.endContainer) r.setEnd(node, range.endOffset);
            
            const m = document.createElement("mark");
            m.className = markClass;
            m.dataset.id = ann.id;
            m.style.backgroundColor = ann.color;
            
            try { r.surroundContents(m); } catch (e) { /* Skip non-text nodes */ }
        });
    } else {
        // Simple selection within one text node
        const m = document.createElement("mark");
        m.className = markClass;
        m.dataset.id = ann.id;
        m.style.backgroundColor = ann.color;
        try {
            range.surroundContents(m);
        } catch (e) {
            // Last resort fallback
            const frag = range.extractContents();
            m.appendChild(frag);
            range.insertNode(m);
        }
    }

    // Attach Note to the last fragment of the highlight
    if (ann.note) {
        const allNewMarks = document.querySelectorAll(`[data-id="${ann.id}"]`);
        const lastMark = allNewMarks[allNewMarks.length - 1];
        if (lastMark) {
            const disp = document.createElement("span");
            disp.className = "research-note";
            disp.textContent = ann.note;
            lastMark.after(disp);
        }
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
    
    for (const ann of pageAnns) {
        const parent = document.querySelector(ann.path);
        if (!parent) continue;
        
        // Use a more precise check: don't highlight if this ID already exists in DOM
        if (document.querySelector(`[data-id="${ann.id}"]`)) continue;

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
    }
};

init();