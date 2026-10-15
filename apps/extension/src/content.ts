import { GoogleMeetAdapter } from "./meet/googleMeetAdapter";
import { isCopilotMessage } from "./shared/messages";
import { CopilotPanel } from "./ui/panel";

// Content script: работи вътре в meet.google.com. Панелът се показва само
// когато собственикът натисне иконата на разширението.
const adapter = new GoogleMeetAdapter();
const panel = new CopilotPanel();
panel.mount();

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isCopilotMessage(message)) return;
  switch (message.type) {
    case "toggle-panel":
      // Meet сменя адреса без презареждане (SPA), затова срещата се чете наново.
      panel.setMeeting(adapter.currentMeeting());
      panel.toggle();
      break;
  }
});
