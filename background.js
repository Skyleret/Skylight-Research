chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open_sources") {
    message.urls.forEach(url => {
      chrome.tabs.create({ url, active: false });
    });
  }

  if (message.action === "download_source") {
    const blobData = JSON.stringify(message.data, null, 2);
    const url = "data:application/json;base64," + btoa(blobData);
    
    chrome.downloads.download({
      url: url,
      filename: `research_${message.data.projectId}.json`,
      saveAs: true
    });
  }
});