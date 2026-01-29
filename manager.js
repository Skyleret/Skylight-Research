let currentProject = "General";

async function renderManager() {
    const data = await chrome.storage.local.get(["annotations", "projects"]);
    const allAnns = data.annotations || [];
    const projects = data.projects || ["General"];
    
    // Render Sidebar Projects
    const projectList = document.getElementById("project-list");
    projectList.innerHTML = projects.map(p => `
        <div class="project-item ${p === currentProject ? 'active' : ''}" 
             style="cursor:pointer; padding:5px; margin:5px 0; border-radius:4px; ${p === currentProject ? 'background:#007aff; color:white;' : ''}" 
             data-name="${p}">
             ${p}
        </div>
    `).join("");

    // Filter annotations by current project
    const filteredAnns = allAnns.filter(a => {
        if (currentProject === "General") return true;
        return a.projects && a.projects.includes(currentProject);
    });

    const sourceList = document.getElementById("source-list");
    sourceList.innerHTML = "";

    const grouped = filteredAnns.reduce((acc, curr) => {
        if (!acc[curr.url]) acc[curr.url] = { title: curr.title, notes: [], projects: curr.projects || [] };
        acc[curr.url].notes.push(curr);
        return acc;
    }, {});

    for (const url in grouped) {
        const src = grouped[url];
        const uniqueNotes = Array.from(new Map(src.notes.map(n => [n.id, n])).values());
        
        const card = document.createElement("div");
        card.className = "source-card";
        card.innerHTML = `
            <div class="card-header" style="border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:10px;">
                <h4 style="margin:0;">${src.title}</h4>
                <div style="font-size:11px; color:#666; margin:5px 0;">
                    Tags: ${projects.map(p => `
                        <label style="margin-right:8px;">
                            <input type="checkbox" class="proj-tag" data-url="${url}" data-proj="${p}" ${src.projects.includes(p) ? 'checked' : ''}> ${p}
                        </label>
                    `).join("")}
                </div>
            </div>
            <div class="notes-area">
                ${uniqueNotes.map(n => `
                    <div class="note-item" style="border-left:4px solid ${n.color}; padding-left:10px; margin:10px 0; position:relative;">
                        <i>"${n.text}"</i>
                        ${n.note ? `<p style="background:#fff9c4; padding:4px;">${n.note}</p>` : ''}
                        <button class="del-btn" data-id="${n.id}" style="position:absolute; right:0; top:0; border:none; color:red; cursor:pointer;">&times;</button>
                    </div>
                `).join("")}
            </div>
        `;
        sourceList.appendChild(card);
    }

    setupListeners();
}

function setupListeners() {
    // Safari-friendly Event Delegation
    document.onclick = async (e) => {
        const t = e.target;
        
        // Delete Note
        if (t.classList.contains('del-btn')) {
            const id = t.dataset.id;
            const data = await chrome.storage.local.get("annotations");
            const filtered = (data.annotations || []).filter(a => a.id != id);
            await chrome.storage.local.set({ annotations: filtered });
            renderManager();
        }

        // Switch Project
        if (t.classList.contains('project-item')) {
            currentProject = t.dataset.name;
            renderManager();
        }

        // Toggle Project Tag
        if (t.classList.contains('proj-tag')) {
            const url = t.dataset.url;
            const proj = t.dataset.proj;
            const data = await chrome.storage.local.get("annotations");
            const updated = data.annotations.map(a => {
                if (a.url === url) {
                    let pList = a.projects || [];
                    if (t.checked) pList.push(proj);
                    else pList = pList.filter(p => p !== proj);
                    return { ...a, projects: [...new Set(pList)] };
                }
                return a;
            });
            await chrome.storage.local.set({ annotations: updated });
        }
    };
}

// Add Project Button
document.getElementById("add-project").onclick = async () => {
    const name = prompt("Enter project name:");
    if (name) {
        const data = await chrome.storage.local.get("projects");
        const list = data.projects || ["General"];
        list.push(name);
        await chrome.storage.local.set({ projects: [...new Set(list)] });
        renderManager();
    }
};

// Export Current Project
document.getElementById("export-project").onclick = async () => {
    const data = await chrome.storage.local.get("annotations");
    const filtered = (data.annotations || []).filter(a => a.projects && a.projects.includes(currentProject));
    // Reuse your existing downloadFile logic here for 'filtered'
    alert(`Exporting ${currentProject} - ${filtered.length} items`);
};

document.addEventListener("DOMContentLoaded", renderManager);