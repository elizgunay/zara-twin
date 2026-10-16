// Вариант с COOP/COEP (като в Zara Copilot): копие на ../capture-probe.
// Минимален тест на прихващането по официалния пример на Chrome: offscreen документ,
// streamId точно преди употреба, getUserMedia със звук. Без Whisper,
// без content script. Ако тук работи, а в Zara Copilot не, причината е в разширението.

chrome.action.onClicked.addListener(async (tab) => {
  const lines = [`Изолация: ${self.crossOriginIsolated ? "да" : "не"}`, `Chrome ${/Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "?"}`, `Таб: ${tab.url}`];
  try {
    const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Диагностика на прихващането на звука от таб.",
      });
    }
    for (const withVideo of [false, true]) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const result = await chrome.runtime.sendMessage({ type: "probe", streamId, withVideo });
      lines.push(`${withVideo ? "Звук + картина" : "Само звук"}: ${result.ok ? `УСПЕХ, ниво на звука ${result.level}` : result.error}`);
      if (result.ok) break;
    }
  } catch (error) {
    lines.push(`Грешка: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
  await chrome.offscreen.closeDocument().catch(() => {});
  await chrome.tabs.create({ url: `result.html#${encodeURIComponent(lines.join("\n"))}` });
});
