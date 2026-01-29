/**
 * RESEARCH TOOL - CONTENT SCRIPT
 * Unified Version: Structural Saving + Fuzzy Reload + Surgical Edit
 */

// --- 1. GLOBAL SCOPE ---
let currentProject = "General";
let refreshTimeout = null;

// --- 2. MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const selection = window.getSelection();
    if (request.project) currentProject = request.project;

    if (request.action === "OPEN_MENU") showFloatingMenu();
    else if (request.action === "QUICK_ACTION") executeHighlight(selection, request.isNote, request.color);
    else if (request.action === "SURGICAL_REMOVE") handleSurgicalRemove(selection);
});

// --- 3. UI COMPONENTS ---
function showFloatingMenu() {
    const selection = window.getSelection();
    // We allow the menu to show if there's a selection OR if we just want to rescan
    const hasSelection = selection.rangeCount > 0 && selection.toString().trim() !== "";

    const oldMenu = document.getElementById("research-popup-menu");
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement("div");
    menu.id = "research-popup-menu";
    
    // Position logic: If selection exists, put it near text. Otherwise, top right.
    if (hasSelection) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        Object.assign(menu.style, {
            position: "fixed", top: `${rect.top - 50}px`, left: `${rect.left}px`
        });
    } else {
        Object.assign(menu.style, {
            position: "fixed", top: "20px", right: "20px"
        });
    }

    Object.assign(menu.style, {
        zIndex: "2147483647", backgroundColor: "#222", padding: "8px",
        borderRadius: "20px", display: "flex", gap: "10px", boxShadow: "0 4px 15px rgba(0,0,0,0.4)"
    });

    // 1. Highlight Options (Only show if text is selected)
    if (hasSelection) {
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
    }

    // 2. THE RESCAN BUTTON (Always shows)
    const rescanBtn = document.createElement("button");
    rescanBtn.textContent = "🔄";
    rescanBtn.title = "Rescan page for missing highlights";
    rescanBtn.style.cssText = "background:none; border:none; cursor:pointer; font-size:18px; border-left: 1px solid #444; padding-left: 10px;";
    rescanBtn.onclick = () => {
        init(); // Trigger the highlight logic manually
        rescanBtn.textContent = "⌛";
        setTimeout(() => { 
            rescanBtn.textContent = "✅"; 
            setTimeout(() => menu.remove(), 1000);
        }, 500);
    };
    menu.appendChild(rescanBtn);

    document.body.appendChild(menu);
    const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", closeMenu); }};
    document.addEventListener("mousedown", closeMenu);
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

// --- 4. CORE HIGHLIGHT LOGIC ---
async function executeHighlight(selection, isNoteMode, colorCode) {
    if (selection.toString().trim().length === 0) return;
    
    const originalText = selection.toString();
    const range = selection.getRangeAt(0);
    const htmlSnippet = getCleanHTML(range); 
    
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
        html: htmlSnippet,
        path: getDomPath(newRange.startContainer),
        color: colorCode,
        note: oldNotes || "",
        timestamp: new Date().toISOString(),
        projects: [currentProject]
    };

    // Pass 'true' as the third argument to skip immediate note placement
    const mark = applyMarkToRange(newRange, ann, true); 
    
    if (mark) {
        await saveToStorage(ann);
        
        // This is the "Stable Anchor" logic that worked in your DEBUG trace
        setTimeout(() => {
            const allFragments = document.querySelectorAll(`mark[data-id="${ann.id}"]`);
            if (allFragments.length === 0) return;

            const lastMark = allFragments[allFragments.length - 1];

            // Manual Note Placement for the "Instant" highlight
            if (ann.note) {
                const disp = document.createElement("span");
                disp.className = "research-note";
                disp.textContent = ann.note;
                lastMark.after(disp);
            }

            if (isNoteMode) {
                createInlineEditor(lastMark, ann);
            }
        }, 100); 
    }
}

// --- 5. SURGICAL TOOLS (The Blade) ---
async function handleSurgicalRemove(selection) {
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    await surgicalProcess(range);
    selection.removeAllRanges();
}

async function surgicalProcess(userRange, newColor = null) {
    const allMarks = document.querySelectorAll('.research-highlight');
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
        
        const data = await chrome.storage.local.get("annotations");
        const oldAnn = (data.annotations || []).find(a => a.id === markId);
        if (oldAnn?.note) migratedNotes.push(oldAnn.note);

        const markRange = document.createRange();
        markRange.selectNodeContents(mark);

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
        if (next?.classList?.contains("research-note") || next?.classList?.contains("research-editor")) next.remove();

        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        
        if (newColor && newColor !== oldColor) {
            if (t1.trim().length > 0) await reHighlight(parent, t1, oldColor);
            if (t2.trim().length > 0) await reHighlight(parent, t2, oldColor);
        }
    }
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
                url: window.location.href, text: text, color: color, note: "", 
                path: getDomPath(node), title: document.title, timestamp: new Date().toISOString(), projects: [currentProject]
            };
            applyMarkToRange(range, ann);
            await saveToStorage(ann);
            break;
        }
    }
}

// --- 6. DOM HELPERS ---
// Add 'skipNotePlacement' as a parameter
function applyMarkToRange(range, ann, skipNotePlacement = false) {
    const markId = ann.id;
    const nodes = getNodesInRange(range);
    const fragments = [];

    nodes.forEach((node) => {
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
            const frag = r.extractContents();
            m.appendChild(frag);
            r.insertNode(m);
            fragments.push(m);
        }
    });

    // Only run this if NOT skipped (i.e., during page load/init)
    if (!skipNotePlacement && ann.note && fragments.length > 0) {
        const lastMark = fragments[fragments.length - 1];
        const disp = document.createElement("span");
        disp.className = "research-note";
        disp.textContent = ann.note;
        lastMark.after(disp);
    }
    
    return document.querySelector(`mark[data-id="${markId}"]`);
}

function getNodesInRange(range) {
    const nodes = [];
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const r = document.createRange();
            r.selectNodeContents(node);
            return range.compareBoundaryPoints(Range.END_TO_START, r) < 0 &&
                   range.compareBoundaryPoints(Range.START_TO_END, r) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    let node;
    while (node = walker.nextNode()) nodes.push(node);
    if (nodes.length === 0) nodes.push(range.startContainer);
    return nodes;
}

function getCleanHTML(range) {
    const fragment = range.cloneContents();
    const container = document.createElement("div");
    container.appendChild(fragment);
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
            for (let i = el.attributes.length - 1; i >= 0; i--) {
                const attr = el.attributes[i].name;
                if (el.tagName === 'A' && attr === 'href') continue;
                el.removeAttribute(attr);
            }
        }
    });
    return container.innerHTML;
}

function findRangeWithContext(parent, targetText, targetOffsetInParent) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let currentTotalOffset = 0;
    let node;
    const range = document.createRange();
    let foundStart = false;
    while (node = walker.nextNode()) {
        const nodeLength = node.textContent.length;
        if (!foundStart && currentTotalOffset + nodeLength > targetOffsetInParent) {
            range.setStart(node, targetOffsetInParent - currentTotalOffset);
            foundStart = true;
        }
        if (foundStart && currentTotalOffset + nodeLength >= targetOffsetInParent + targetText.length) {
            range.setEnd(node, (targetOffsetInParent + targetText.length) - currentTotalOffset);
            return range;
        }
        currentTotalOffset += nodeLength;
    }
    return null;
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

// --- 7. STORAGE & RELOAD ---
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

const init = async () => {
    try {
        const res = await chrome.storage.local.get("annotations");
        const pageAnns = res.annotations?.filter(a => a.url === window.location.href) || [];
        if (pageAnns.length === 0) return;

        // 1. Build a map of the entire page text
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        let fullText = "";
        const nodeData = [];

        while (node = walker.nextNode()) {
            // Avoid UI elements and script tags
            if (node.parentElement.closest('#research-popup-menu, script, style, .research-editor')) continue;
            nodeData.push({ node, start: fullText.length });
            fullText += node.textContent;
        }

        pageAnns.forEach(ann => {
            if (document.querySelector(`mark[data-id="${ann.id}"]`)) return;

            // 2. ULTRA-FUZZY MATCH: Remove ALL whitespace for the search
            // This bypasses &nbsp;, tabs, and newlines entirely
            const targetClean = ann.text.replace(/\s+/g, ''); 
            const sourceClean = fullText.replace(/\s+/g, '');
            const cleanIdx = sourceClean.indexOf(targetClean);

            if (cleanIdx === -1) {
                console.warn("Fuzzy match failed for:", ann.text.substring(0, 20));
                return;
            }

            // 3. Map the clean index back to the messy fullText index
            const matchIdx = findRealIndexFuzzy(fullText, targetClean);
            
            if (matchIdx === -1) return;

            const range = document.createRange();
            let startNode, endNode, startOff, endOff;

            for (let i = 0; i < nodeData.length; i++) {
                const nStart = nodeData[i].start;
                const nEnd = nStart + nodeData[i].node.textContent.length;

                if (matchIdx >= nStart && matchIdx < nEnd) {
                    startNode = nodeData[i].node;
                    startOff = matchIdx - nStart;
                }
                // End position is matchIdx + original length
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
    } catch (e) { console.error("Init Error:", e); }
};

// New helper: finds index by ignoring all whitespace
function findRealIndexFuzzy(fullText, targetClean) {
    let tIdx = 0;
    let startMatch = -1;
    
    for (let i = 0; i < fullText.length; i++) {
        // Skip whitespace in source
        if (/\s/.test(fullText[i])) continue;
        
        if (fullText[i] === targetClean[tIdx]) {
            if (tIdx === 0) startMatch = i;
            tIdx++;
            if (tIdx === targetClean.length) return startMatch;
        } else {
            // Reset if sequence breaks
            tIdx = 0;
            startMatch = -1;
        }
    }
    return -1;
}
function findRealIndex(fullText, target, normIdx) {
    for (let i = 0; i < fullText.length; i++) {
        if (fullText.substring(i).replace(/\s+/g, ' ').startsWith(target)) return i;
    }
    return -1;
}

// --- 8. OBSERVER & BOOTSTRAP ---
const observer = new MutationObserver((mutations) => {
    const isOurChange = mutations.some(m => {
        const added = Array.from(m.addedNodes);
        return added.some(n => n.nodeType === 1 && (n.classList?.contains('research-highlight') || n.classList?.contains('research-note')));
    });
    if (!isOurChange) {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(init, 2000); 
    }
});

if (document.readyState === "complete") init();
else window.addEventListener("load", init);
observer.observe(document.body, { childList: true, subtree: true });