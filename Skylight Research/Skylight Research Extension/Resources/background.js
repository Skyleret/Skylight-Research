/**
 * OMNI RESEARCH - BACKGROUND SCRIPT
 */

chrome.runtime.onInstalled.addListener(() => {
  // Context Menus
  chrome.contextMenus.create({ id: "add-highlight", title: "Add Highlight", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "add-note", title: "Add Note", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "remove-highlight", title: "Remove Highlight", contexts: ["all"] });
  
  chrome.contextMenus.create({ 
    id: "open-dashboard", 
    title: "📊 Open Research Manager", 
    contexts: ["all"] 
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 1. Safety check: Ensure we have a valid tab to talk to
  if (!tab || !tab.id) return;

  // 2. Handle Dashboard
  if (info.menuItemId === "open-dashboard") {
    chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
    return;
  }

  // 3. Map Menu IDs to Content Script Actions
  const actionMap = {
    "add-highlight": { action: "DO_HIGHLIGHT", mode: "simple" },
    "add-note": { action: "DO_HIGHLIGHT", mode: "note" },
    "remove-highlight": { action: "SURGICAL_REMOVE" }
  };

  const message = actionMap[info.menuItemId];

  if (message) {
    try {
      // Send message to the specific tab
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      console.error("Omni: Failed to send message. Is the content script loaded?", err);
      
      // Optional: Alert the user if they try to highlight on a restricted page
      if (err.message.includes("Could not establish connection")) {
        console.warn("Script not injected on this page (likely a system page).");
      }
    }
  }
});