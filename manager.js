async function renderManager() {
  const data = await chrome.storage.local.get("annotations");
  const allAnnotations = data.annotations || [];
  const sourceList = document.getElementById("source-list");
  sourceList.innerHTML = "";

  if (allAnnotations.length === 0) {
    sourceList.innerHTML = "<p>No highlights found yet. Start researching!</p>";
    return;
  }

  // Group by URL
  const groupedByUrl = allAnnotations.reduce((acc, curr) => {
    if (!acc[curr.url]) {
      acc[curr.url] = { title: curr.title || 'Untitled Source', allNotes: [] };
    }
    acc[curr.url].allNotes.push(curr);
    return acc;
  }, {});

  for (const url in groupedByUrl) {
    const source = groupedByUrl[url];
    const uniqueNotes = Array.from(new Map(source.allNotes.map(a => [a.id, a])).values());

    const card = document.createElement("div");
    card.className = "source-card";
    
    // Inside renderManager loop...
    let notesHtml = uniqueNotes.map(n => `
      <div class="note-item" style="border-left: 4px solid ${n.color}; padding-left: 12px; margin: 15px 0; position: relative;">
        <i style="color: #444; display: block; margin-bottom: 5px; line-height: 1.4;">"${n.text}"</i>
        ${n.note ? `<p style="margin: 8px 0 0 0; color: #000; background: #fff9c4; padding: 5px; border-radius: 3px;">${n.note}</p>` : ''}
        <button class="delete-note" data-id="${n.id}" style="position:absolute; right:0; top:0; border:none; background:none; cursor:pointer; color:#ff3b30; font-weight:bold; font-size:16px;">&times;</button>
      </div>
    `).join("");

    card.innerHTML = `
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 1px solid #eee; padding-bottom: 10px;">
        <div>
          <h4 style="margin:0; font-size: 16px;">${source.title}</h4>
          <a href="${url}" target="_blank" style="font-size:12px; color:#007aff; word-break: break-all; text-decoration:none;">${url}</a>
        </div>
        <button class="dl-btn btn-primary" data-url="${url}" style="font-size:11px; padding: 5px 10px;">EXPORT SOURCE</button>
      </div>
      <div class="card-body">${notesHtml}</div>
    `;
    sourceList.appendChild(card);
  }

  // --- ATTACH LISTENERS AFTER RENDERING ---

  // Handle Deletion
  document.querySelectorAll('.delete-note').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const res = await chrome.storage.local.get("annotations");
      const filtered = (res.annotations || []).filter(a => a.id != id);
      await chrome.storage.local.set({ annotations: filtered });
      renderManager(); 
    };
  });

  // Handle Single Source Export (Markdown)
  document.querySelectorAll('.dl-btn').forEach(btn => {
    btn.onclick = () => {
      const url = btn.getAttribute('data-url');
      const source = groupedByUrl[url];
      const unique = Array.from(new Map(source.allNotes.map(a => [a.id, a])).values());
      
      let content = `# ${source.title}\nSource: ${url}\n\n`;
      unique.forEach(n => {
        content += `> "${n.text}"\n\n${n.note ? `**Note:** ${n.note}\n\n` : ''}---\n\n`;
      });

      downloadFile(content, `${source.title.substring(0,20)}.md`);
    };
  });
}

// Global Export Function
async function exportAllToMarkdown() {
  const data = await chrome.storage.local.get("annotations");
  const all = data.annotations || [];
  if (all.length === 0) return alert("Nothing to export!");

  // Distinct by ID
  const unique = Array.from(new Map(all.map(a => [a.id, a])).values());
  
  let content = `# Full Research Report - ${new Date().toLocaleDateString()}\n\n`;
  
  unique.forEach((n, i) => {
    content += `### ${i+1}. [${n.title || 'Source'}](${n.url})\n`;
    content += `> ${n.text}\n\n`;
    if (n.note) content += `**My Note:** ${n.note}\n\n`;
    content += `---\n`;
  });

  downloadFile(content, `full-research-report.md`);
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Listeners for Sidebar
document.getElementById("open-all").onclick = async () => {
  const data = await chrome.storage.local.get("annotations");
  const urls = [...new Set((data.annotations || []).map(a => a.url))];
  urls.forEach(url => window.open(url, '_blank'));
};

document.getElementById("export-all").onclick = exportAllToMarkdown;

document.addEventListener("DOMContentLoaded", renderManager);