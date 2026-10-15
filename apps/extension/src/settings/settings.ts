import { getStoredToken, GOOGLE_CLIENT_ID, isConnected, signIn, signOut } from "../calendar/token";

// Страница с настройки (десен бутон върху иконата → „Опции“). Тук ръководителят
// свързва Google Calendar с изрично натискане на бутон.

const connect = document.querySelector<HTMLButtonElement>("#connect")!;
const disconnect = document.querySelector<HTMLButtonElement>("#disconnect")!;
const status = document.querySelector<HTMLElement>("#status")!;

document.querySelector("#redirect")!.textContent = chrome.identity.getRedirectURL();
document.querySelector("#extension-id")!.textContent = chrome.runtime.id;

function show(text: string, tone: "ok" | "err" | "" = "") {
  status.textContent = text;
  status.className = tone;
}

async function refresh(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    connect.disabled = true;
    disconnect.disabled = true;
    show("Календарът още не е настроен (липсва Client ID). Виж docs/setup/google-calendar.md.", "err");
    return;
  }
  const connected = (await getStoredToken()) !== null || (await isConnected());
  connect.textContent = connected ? "Свържи отново" : "Свържи календара";
  disconnect.disabled = !connected;
  show(connected ? "Календарът е свързан." : "Календарът не е свързан.", connected ? "ok" : "");
}

connect.addEventListener("click", async () => {
  connect.disabled = true;
  try {
    await signIn(true);
  } catch (error) {
    show(`Неуспешно свързване: ${error instanceof Error ? error.message : error}`, "err");
    connect.disabled = false;
    return;
  }
  connect.disabled = false;
  await refresh();
});

disconnect.addEventListener("click", async () => {
  await signOut();
  await refresh();
});

void refresh();
