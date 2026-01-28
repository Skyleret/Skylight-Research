async function renderManager() {
  const data = await chrome.storage.local.get("annotations");
  const allAnnotations = data.annotations || [];
  const sourceList = document.getElementById("source-list");
  sourceList.innerHTML = "";

  // STEP 1: Group by URL first
  const groupedByUrl = allAnnotations.reduce((acc, curr) => {
    if (!acc[curr.url]) {
      acc[curr.url] = { 
        title: curr.title || 'Untitled Source', 
        allNotes: [] 
      };
    }
    acc[curr.url].allNotes.push(curr);
    return acc;
  }, {});

  // STEP 2: Iterate through each URL "Card"
  for (const url in groupedByUrl) {
    const source = groupedByUrl[url];
    
    // STEP 3: Inside this specific URL, filter out duplicate IDs 
    // (This handles the fragments from GeeksforGeeks/Lists)
    const uniqueNotesForThisUrl = Array.from(
      new Map(source.allNotes.map(a => [a.id, a])).values()
    );

    const card = document.createElement("div");
    card.className = "source-card";
    
    let notesHtml = uniqueNotesForThisUrl.map(n => `
      <div class="note-item" style="border-left: 4px solid ${n.color}; padding-left: 12px; margin: 15px 0; position: relative;">
        <i style="color: #444; display: block; margin-bottom: 5px; line-height: 1.4;">"${n.text}"</i>
        ${n.note ? `<p style="margin: 8px 0 0 0; color: #000; background: #fff9c4; padding: 5px; border-radius: 3px;">${n.note}</p>` : ''}
        <button class="delete-note" data-id="${n.id}" title="Delete Highlight">✕</button>
      </div>
    `).join("");

    card.innerHTML = `
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 1px solid #eee; padding-bottom: 10px;">
        <div>
          <h4 style="margin:0; font-size: 16px;">${source.title}</h4>
          <a href="${url}" target="_blank" style="font-size:12px; color:#007aff; word-break: break-all;">${url}</a>
        </div>
        <button class="dl-btn btn-primary" data-url="${url}">Export</button>
      </div>
      <div class="card-body">${notesHtml}</div>
    `;
    sourceList.appendChild(card);
  }

  // Handle Deletion (Removes all fragments with that ID)
  setupDeleteListeners();
}

  // Handle Note Deletion
  document.querySelectorAll('.delete-note').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const data = await chrome.storage.local.get("annotations");
      const filtered = (data.annotations || []).filter(a => a.id != id);
      await chrome.storage.local.set({ annotations: filtered });
      renderManager(); // Re-render
    };
  });

  // Handle Export Click
  document.querySelectorAll('.dl-btn').forEach(btn => {
    btn.onclick = () => {
      const url = btn.getAttribute('data-url');
      const sourceData = grouped[url];
      // You can add a simple JSON download here
      const blob = new Blob([JSON.stringify(sourceData, null, 2)], {type : 'application/json'});
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `research-${new Date().getTime()}.json`;
      a.click();
    };
  });
