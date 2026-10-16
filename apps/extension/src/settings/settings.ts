import { getStoredToken, GOOGLE_CLIENT_ID, isConnected, signIn, signOut } from "../calendar/token";
import {
  isSttMode,
  SPEECHMATICS_KEY_STORAGE_KEY,
  SPEECHMATICS_TEMP_KEY_URL,
  STT_MODE_STORAGE_KEY,
  type SttMode,
} from "../stt/cloud";

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

// Разпознаване на говор: на компютъра или в облака (Speechmatics, ЕС).
const keyInput = document.querySelector<HTMLInputElement>("#sm-key")!;
const sttStatus = document.querySelector<HTMLElement>("#stt-status")!;
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="stt-mode"]'));

function showStt(text: string, tone: "ok" | "err" | "" = "") {
  sttStatus.textContent = text;
  sttStatus.className = tone;
}

function selectedMode(): SttMode {
  const value = modeInputs.find((input) => input.checked)?.value;
  return isSttMode(value) ? value : "local";
}

async function loadStt(): Promise<void> {
  const stored = await chrome.storage.local.get([STT_MODE_STORAGE_KEY, SPEECHMATICS_KEY_STORAGE_KEY]);
  const mode: unknown = stored[STT_MODE_STORAGE_KEY];
  const current = isSttMode(mode) ? mode : "local";
  for (const input of modeInputs) input.checked = input.value === current;
  const key: unknown = stored[SPEECHMATICS_KEY_STORAGE_KEY];
  // Ключът не се показва обратно: полето само подсказва, че има записан.
  keyInput.placeholder = typeof key === "string" && key ? "Записан ключ (въведете нов, за да го смените)" : "Поставете ключа тук";
  showStt(current === "speechmatics" ? "Избрано: облак (Speechmatics, ЕС)." : "Избрано: на компютъра.");
}

document.querySelector("#stt-save")!.addEventListener("click", async () => {
  const mode = selectedMode();
  const key = keyInput.value.trim();
  const stored = (await chrome.storage.local.get(SPEECHMATICS_KEY_STORAGE_KEY))[SPEECHMATICS_KEY_STORAGE_KEY];
  if (mode === "speechmatics" && !key && !stored) {
    showStt("За облака е нужен API ключ от Speechmatics.", "err");
    return;
  }
  await chrome.storage.local.set({ [STT_MODE_STORAGE_KEY]: mode, ...(key && { [SPEECHMATICS_KEY_STORAGE_KEY]: key }) });
  keyInput.value = "";
  await loadStt();
  showStt(`${sttStatus.textContent} Запазено. Важи от следващото включване на Copilot.`, "ok");
});

document.querySelector("#sm-test")!.addEventListener("click", async () => {
  const key = keyInput.value.trim() || (await chrome.storage.local.get(SPEECHMATICS_KEY_STORAGE_KEY))[SPEECHMATICS_KEY_STORAGE_KEY];
  if (typeof key !== "string" || !key) {
    showStt("Няма ключ за проверка.", "err");
    return;
  }
  showStt("Проверка…");
  // Само издава временен ключ за 60 s: не праща звук и не харчи минути.
  const response = await fetch(SPEECHMATICS_TEMP_KEY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ ttl: 60 }),
  }).catch(() => null);
  if (response?.ok) showStt("Ключът работи.", "ok");
  else showStt(response ? `Ключът не е приет (HTTP ${response.status}).` : "Няма връзка със Speechmatics.", "err");
});

void loadStt();
