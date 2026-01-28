let activeProject = "default";

async function renderManager() {
  const data = await chrome.storage.local.get(["annotations", "projects"]);
  const annotations = data.annotations || [];
  const projects = data.projects || [{id: "default", name: "General Research"}];

  const sourceList = document.getElementById("source-list");
  sourceList.innerHTML = "";

  // Group annotations by URL (Sources)
  const sources = [...new Set(annotations.map(a => a.url))];

  sources.forEach(url => {
    const urlNotes = annotations.filter(a => a.url === url);
    const card = document.createElement("div");
    card.className = "source-card";
    card.innerHTML = `
      <h4>${urlNotes[0].title}</h4>
      <a href="${url}" target="_blank">${url}</a>
      <p>${urlNotes.length} Highlights</p>
      <button class="save-btn" data-url="${url}">Download as Local File</button>
    `;
    sourceList.appendChild(card);
  });
}

// "Open All Sources" Button Logic
document.getElementById("open-all").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("annotations");
  const urls = [...new Set(data.annotations.map(a => a.url))];
  chrome.runtime.sendMessage({ action: "open_sources", urls });
});

document.addEventListener("DOMContentLoaded", renderManager);