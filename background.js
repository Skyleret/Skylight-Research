chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-highlight",
    title: "Add Highlight",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "add-note",
    title: "Add Note (Inline)",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "remove-highlight",
    title: "Remove Highlight",
    contexts: ["all"] // "all" allows clicking on existing highlights
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-highlight") {
    chrome.tabs.sendMessage(tab.id, { action: "DO_HIGHLIGHT", mode: "simple" });
  } else if (info.menuItemId === "add-note") {
    chrome.tabs.sendMessage(tab.id, { action: "DO_HIGHLIGHT", mode: "note" });
  } else if (info.menuItemId === "remove-highlight") {
    chrome.tabs.sendMessage(tab.id, { action: "REMOVE_AT_CURSOR" });
  }
});