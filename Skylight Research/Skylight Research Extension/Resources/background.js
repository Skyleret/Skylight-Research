/**
 * OMNI RESEARCH - BACKGROUND SCRIPT
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "open-dashboard", title: "📊 Open Manager", contexts: ["all"] });
  chrome.contextMenus.create({ id: "sep1", type: "separator", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "hl-parent", title: "🖋️ Highlight...", contexts: ["selection"] });

  const colors = [
    { id: "hl-yellow", title: "🟡 Yellow" },
    { id: "hl-blue", title: "🔵 Blue" },
    { id: "hl-green", title: "🟢 Green" },
    { id: "hl-purple", title: "🟣 Purple" },
    { id: "hl-none", title: "🫥 Transparent" }
  ];

  colors.forEach(c => {
    chrome.contextMenus.create({ id: c.id, parentId: "hl-parent", title: c.title, contexts: ["selection"] });
  });

  chrome.contextMenus.create({ id: "hl-note", title: "📝 Add Note & Highlight", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "remove-hl", title: "❌ Remove Highlight", contexts: ["selection"] });
});

const colorMap = {
  "hl-yellow": "#ffeb3b", "hl-blue": "#81d4fa", "hl-green": "#ccff90", "hl-purple": "#e1bee7", "hl-none": "transparent"
};

// Listen for Alt+H
chrome.commands.onCommand.addListener((command) => {
  if (command === "quick-highlight") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "OPEN_MENU" });
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-dashboard") {
    chrome.tabs.create({ url: "manager.html" });
  } else if (colorMap[info.menuItemId]) {
    chrome.tabs.sendMessage(tab.id, { action: "QUICK_ACTION", color: colorMap[info.menuItemId], isNote: false });
  } else if (info.menuItemId === "hl-note") {
    chrome.tabs.sendMessage(tab.id, { action: "QUICK_ACTION", color: "#ffeb3b", isNote: true });
  } else if (info.menuItemId === "remove-hl") {
    chrome.tabs.sendMessage(tab.id, { action: "SURGICAL_REMOVE" });
  }
});