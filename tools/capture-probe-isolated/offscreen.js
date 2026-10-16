chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "probe") return;
  probe(message.streamId, message.withVideo).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: `${error.name}: ${error.message}` }),
  );
  return true;
});

// Прихваща таба за 3 секунди и връща най-високото ниво на звука (0 = тишина).
async function probe(streamId, withVideo) {
  const tab = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: tab },
    ...(withVideo && { video: { mandatory: tab } }),
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  source.connect(context.destination);
  const analyser = context.createAnalyser();
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let peak = 0;
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    analyser.getFloatTimeDomainData(data);
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    await new Promise((r) => setTimeout(r, 50));
  }
  for (const track of stream.getTracks()) track.stop();
  await context.close();
  return { ok: true, level: peak.toFixed(3) };
}
