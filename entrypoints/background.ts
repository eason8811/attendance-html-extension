export default defineBackground(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => undefined);
  }
});
