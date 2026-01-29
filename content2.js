/**
 * RESEARCH TOOL - CONTENT SCRIPT
 */
// --- GLOBAL VARIABLES (Must be at the very top) ---
let currentProject = "General";
let refreshTimeout = null;

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const selection = window.getSelection();
    if (request.project) currentProject = request.project;

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
    const htmlSnippet = getCleanHTML(range); // <--- Capture HTML structure
    
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
        text: originalText, // Keep text for search/init
        html: htmlSnippet,   // Add the structure for the Manager
        path: getDomPath(newRange.startContainer),
        color: colorCode,
        note: oldNotes || "",
        timestamp: new Date().toISOString(),
        projects: [currentProject]
    };

    const mark = applyMarkToRange(newRange, ann);
    if (mark) {
        await saveToStorage(ann);
        if (isNoteMode) setTimeout(() => createInlineEditor(mark, ann), 10);
    }
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
    const markId = ann.id;
    const fragments = [];

    const nodes = getNodesInRange(range);
    nodes.forEach((node, index) => {
        const r = document.createRange();
        r.selectNodeContents(node);
        
        if (node === range.startContainer) r.setStart(node, range.startOffset);
        if (node === range.endContainer) r.setEnd(node, range.endOffset);
        
        const m = document.createElement("mark");
        m.className = "research-highlight";
        m.dataset.id = markId;
        m.style.backgroundColor = ann.color;
        
        try {
            r.surroundContents(m);
            fragments.push(m);
        } catch (e) {
            // Fallback for tricky nodes
            const frag = r.extractContents();
            m.appendChild(frag);
            r.insertNode(m);
            fragments.push(m);
        }
    });

    // NOW: Attach the note ONLY to the absolute last fragment created
    if (ann.note && fragments.length > 0) {
        const lastMark = fragments[fragments.length - 1];
        const disp = document.createElement("span");
        disp.className = "research-note";
        disp.textContent = ann.note;
        lastMark.after(disp);
    }
    
    return fragments[0]; // Return first for the editor anchor
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

function getCleanHTML(range) {
    const fragment = range.cloneContents();
    const container = document.createElement("div");
    container.appendChild(fragment);
    
    // Preservation list (No DIVs, but keeping structure)
    const allowedTags = ['UL', 'LI', 'OL', 'TABLE', 'TR', 'TD', 'TH', 'A', 'B', 'I', 'STRONG', 'EM', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    let node;
    const toProcess = [];
    while(node = walker.nextNode()) toProcess.push(node);

    toProcess.forEach(el => {
        if (!allowedTags.includes(el.tagName)) {
            while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
            el.remove();
        } else {
            // Remove attributes except href
            for (let i = el.attributes.length - 1; i >= 0; i--) {
                const attr = el.attributes[i].name;
                if (el.tagName === 'A' && attr === 'href') continue;
                el.removeAttribute(attr);
            }
        }
    });
    return container.innerHTML;
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


// --- PREVENTING THE INFINITE LOOP (The RangeError fix) ---
const observer = new MutationObserver((mutations) => {
    // Only trigger if the mutation wasn't caused by us adding marks or notes
    const isExternalChange = mutations.some(m => {
        const added = Array.from(m.addedNodes);
        return added.some(n => n.nodeType === 1 && 
               !n.classList?.contains('research-highlight') && 
               !n.classList?.contains('research-note'));
    });

    if (isExternalChange) {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(init, 2000); 
    }
});

const init = async () => {
    try {
        const res = await chrome.storage.local.get("annotations");
        const pageAnns = res.annotations?.filter(a => a.url === window.location.href) || [];
        if (pageAnns.length === 0) return;

        // 1. Map the DOM
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        let fullText = "";
        const nodeData = [];

        while (node = walker.nextNode()) {
            if (node.parentElement.closest('#research-popup-menu, script, style, .research-editor')) continue;
            nodeData.push({ node, start: fullText.length });
            fullText += node.textContent;
        }

        pageAnns.forEach(ann => {
            if (document.querySelector(`mark[data-id="${ann.id}"]`)) return;

            // 2. Fuzzy Match (Normalize whitespace for comparison)
            const target = ann.text.replace(/\s+/g, ' ').trim();
            const source = fullText.replace(/\s+/g, ' ');
            const normIdx = source.indexOf(target);

            if (normIdx === -1) {
                console.warn(`Could not find text for ${ann.id}`);
                return;
            }

            // 3. Map back to real indices
            const matchIdx = findRealIndex(fullText, target, normIdx);
            const range = document.createRange();
            let startNode, startOff, endNode, endOff;

            for (let i = 0; i < nodeData.length; i++) {
                const nStart = nodeData[i].start;
                const nEnd = nStart + nodeData[i].node.textContent.length;

                if (matchIdx >= nStart && matchIdx < nEnd) {
                    startNode = nodeData[i].node;
                    startOff = matchIdx - nStart;
                }
                const matchEnd = matchIdx + ann.text.length;
                if (matchEnd > nStart && matchEnd <= nEnd) {
                    endNode = nodeData[i].node;
                    endOff = matchEnd - nStart;
                }
            }

            if (startNode && endNode) {
                range.setStart(startNode, startOff);
                range.setEnd(endNode, endOff);
                applyMarkToRange(range, ann);
            }
        });
    } catch (e) {
        if (e.message.includes("context invalidated")) {
            console.log("Extension updated. Please refresh the page.");
        }
    }
};

// Helper to map normalized matches back to actual DOM offsets
function findRealIndex(fullText, target, normIdx) {
    for (let i = 0; i < fullText.length; i++) {
        if (fullText.substring(i).replace(/\s+/g, ' ').startsWith(target)) return i;
    }
    return -1;
}
// RUN ONCE ON START
if (document.readyState === "complete") init();
else window.addEventListener("load", init);
observer.observe(document.body, { childList: true, subtree: true });

