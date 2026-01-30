async function renderManager() {
  const data = await chrome.storage.local.get("annotations");
  const annotations = data.annotations || [];
  const sourceList = document.getElementById("source-list");
  sourceList.innerHTML = "";

  // Group by URL
  const grouped = annotations.reduce((acc, curr) => {
    if (!acc[curr.url]) acc[curr.url] = { title: curr.title, notes: [] };
    acc[curr.url].notes.push(curr);
    return acc;
  }, {});

  for (const url in grouped) {
    const source = grouped[url];
    const card = document.createElement("div");
    card.className = "source-card";
    
    let notesHtml = source.notes.map(n => `
      <div style="border-left: 3px solid #4a90e2; padding-left: 10px; margin: 10px 0;">
        <i style="color: #555;">"${n.text}"</i>
        ${n.note ? `<p style="margin: 5px 0 0 0; color: #000;"><strong>Note:</strong> ${n.note}</p>` : ''}
      </div>
    `).join("");

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h4 style="margin:0;">${source.title || 'Untitled'}</h4>
          <a href="${url}" target="_blank" style="font-size:12px; color:#4a90e2;">${url}</a>
        </div>
        <button class="dl-btn" data-url="${url}" style="font-size:11px; cursor:pointer;">Export Source</button>
      </div>
      <div style="margin-top:10px;">${notesHtml}</div>
    `;
    sourceList.appendChild(card);
  }

  // Handle Export Click
  document.querySelectorAll('.dl-btn').forEach(btn => {
    btn.onclick = () => {
      const url = btn.getAttribute('data-url');
      const sourceData = grouped[url];
      chrome.runtime.sendMessage({ action: "download_source", data: { url, ...sourceData } });
    };
  });
}

document.getElementById("open-all").addEventListener("click", async () => {
  const data = await chrome.storage.local.get("annotations");
  const urls = [...new Set((data.annotations || []).map(a => a.url))];
  if (urls.length > 0) {
    chrome.runtime.sendMessage({ action: "open_sources", urls });
  } else {
    alert("No sources found!");
  }
});

document.addEventListener("DOMContentLoaded", renderManager);