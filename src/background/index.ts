
  // 工具栏图标打开侧边栏（与 default_popup 互斥，已移除 manifest 中的 popup）
function configureSidePanel() {
  // const p1 = chrome.sidePanel.setOptions({ path: "panel.html" });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Promise.all([p1, p2]).catch((e) => console.warn("[sidePanel] configure failed:", e));
}

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);
configureSidePanel();