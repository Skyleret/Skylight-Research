let currentProject = "General";
// Helper to turn your saved HTML into Markdown syntax
function htmlToMd(html, text) {
    if (!html) return `*${text}*`; // Fallback to italics for plain text
    
    const div = document.createElement('div');
    div.innerHTML = html;
    
    // 1. Headers: Keep them bold/standard so they remain structural
    div.querySelectorAll('h1, h2, h3').forEach(h => {
        h.innerHTML = `\n### ${h.innerText}\n\n`;
    });
    
    // 2. Bold/Strong: If the original site had bold, we'll keep it
    div.querySelectorAll('b, strong').forEach(b => { 
        b.innerText = `**${b.innerText}**`; 
    });
    
    // 3. List Items: Italics for the content of the list
    div.querySelectorAll('li').forEach(li => {
        li.innerHTML = `\n* *${li.innerText}*`; 
    });

    // 4. Paragraphs: Wrap content in italics
    div.querySelectorAll('p').forEach(p => {
        p.innerHTML = `\n*${p.innerText}*\n`;
    });

    let result = div.innerText.trim();
    
    // 5. Final check: If it's just a block of text without tags, wrap it
    if (!html.includes('<p>') && !html.includes('<li>')) {
        result = `*${result}*`;
    }
    
    return result.replace(/\n{3,}/g, '\n\n'); 
}

document.getElementById("export-project").onclick = async () => {
    const data = await chrome.storage.local.get("annotations");
    const filtered = (data.annotations || []).filter(a => 
        currentProject === "General" || (a.projects && a.projects.includes(currentProject))
    );

    let md = `# Research Project: ${currentProject}\n\n`;
    const grouped = filtered.reduce((acc, curr) => {
        if (!acc[curr.url]) acc[curr.url] = { title: curr.title, notes: [] };
        acc[curr.url].notes.push(curr);
        return acc;
    }, {});

    for (const url in grouped) {
        md += `# Source: ${grouped[url].title}\n**URL:** ${url}\n\n`;
        
        grouped[url].notes.forEach(n => {
            md += `---` + `\n\n`; // Top of Notecard
            
            // The Source Text (Italics handled by helper)
            md += `${htmlToMd(n.html, n.text)}\n\n`; 
            
            // Your Note (Bolded)
            if (n.note) {
                md += `**Note: ${n.note}**\n\n`;
            }
            
            md += `---` + `\n\n`; // Bottom of Notecard
        });
    }

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentProject.replace(/\s+/g, '_')}_Research.md`;
    a.click();
    URL.revokeObjectURL(url);
};


async function renderManager() {
    const data = await chrome.storage.local.get(["annotations", "projects"]);
    const allAnns = data.annotations || [];
    const projects = data.projects || ["General"];
    
    // Sidebar
    const projectList = document.getElementById("project-list");
    projectList.innerHTML = projects.map(p => `
        <div class="project-item ${p === currentProject ? 'active' : ''}" 
             style="cursor:pointer; padding:8px; margin:5px 0; border-radius:4px; ${p === currentProject ? 'background:#007aff; color:white;' : 'color:#333;'}" 
             data-name="${p}">
             ${p === "General" ? "🏠 " : "📁 "} ${p}
        </div>
    `).join("");

    // Filter
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
                    Assign Tags: ${projects.map(p => `
                        <label style="margin-right:8px; cursor:pointer;">
                            <input type="checkbox" class="proj-tag" data-url="${url}" data-proj="${p}" ${src.projects.includes(p) ? 'checked' : ''}> ${p}
                        </label>
                    `).join("")}
                </div>
            </div>
            <div class="notes-area">
                ${uniqueNotes.map(n => `
                    <div class="note-item" style="border-left:4px solid ${n.color}; padding-left:12px; margin:15px 0; position:relative;">
                        <div class="structured-content" style="font-style: normal; line-height:1.5;">
                            ${n.html || `<i>"${n.text}"</i>`}
                        </div>
                        ${n.note ? `<p style="background:#fff9c4; padding:8px; border-radius:4px; margin:8px 0 0 0; color:#222;">${n.note}</p>` : ''}
                        <button class="del-btn" data-id="${n.id}" style="position:absolute; right:0; top:0; border:none; background:none; color:#ff3b30; cursor:pointer; font-weight:bold; font-size:18px;">&times;</button>
                    </div>
                `).join("")}
            </div>
        `;
        sourceList.appendChild(card);
    }
}

// FIX: Define listener ONCE globally, not inside setupListeners() called repeatedly
document.addEventListener('click', async (e) => {
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
        // No renderManager() here to prevent checkbox flicker
    }
});

// Add Project Button
document.getElementById("add-project").onclick = async () => {
    const name = prompt("Enter project name:");
    if (name) {
        const data = await chrome.storage.local.get("projects");
        const list = data.projects || ["General"];
        if (!list.includes(name)) {
            list.push(name);
            await chrome.storage.local.set({ projects: list });
            renderManager();
        }
    }
};

document.addEventListener("DOMContentLoaded", renderManager);