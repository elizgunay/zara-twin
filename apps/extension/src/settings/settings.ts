import { getStoredToken, GOOGLE_CLIENT_ID, isConnected, signIn, signOut } from "../calendar/token";
import { MeetingLog, REPORTS_KEY } from "../meetings/log";
import { formatDuration, formatOffset, type MeetingReport } from "../meetings/report";
import { meetingToText, RETENTION_CHOICES, SAVING_ENABLED_KEY, TranscriptStore, type SavedMeeting } from "../transcripts/store";
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

// Запазени срещи: списък, изтегляне като текст, изтриване, срок.
const store = new TranscriptStore(chrome.storage.local);
const retention = document.querySelector<HTMLSelectElement>("#retention")!;
const meetingsList = document.querySelector<HTMLUListElement>("#meetings")!;
const meetingsStatus = document.querySelector<HTMLElement>("#meetings-status")!;
const savingEnabled = document.querySelector<HTMLInputElement>("#saving-enabled")!;

savingEnabled.addEventListener("change", async () => {
  await chrome.storage.local.set({ [SAVING_ENABLED_KEY]: savingEnabled.checked });
  meetingsStatus.textContent = savingEnabled.checked
    ? "Бутонът „Запази“ ще се показва в панела от следващото включване на Copilot."
    : "Бутонът „Запази“ е скрит. Нищо не се пази.";
  meetingsStatus.className = "ok";
});

async function loadMeetings(): Promise<void> {
  retention.value = String(await store.retentionDays());
  savingEnabled.checked = (await chrome.storage.local.get(SAVING_ENABLED_KEY))[SAVING_ENABLED_KEY] === true;
  const meetings = await store.list();
  meetingsList.replaceChildren(...meetings.map(meetingRow));
  meetingsStatus.textContent = meetings.length === 0 ? "Няма запазени срещи." : "";
  meetingsStatus.className = "";
}

function meetingRow(meeting: SavedMeeting): HTMLLIElement {
  const row = document.createElement("li");
  row.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)";
  const label = document.createElement("span");
  label.style.flex = "1";
  // Само дата, код и брой редове: самият текст не се показва тук.
  label.textContent = `${new Date(meeting.startedAt).toLocaleString("bg-BG")} · ${meeting.meetingCode} · ${meeting.lines.length} реда`;
  const download = button("Изтегли", "primary", () => {
    const blob = new Blob([meetingToText(meeting)], { type: "text/plain;charset=utf-8" });
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `среща-${meeting.meetingCode}-${new Date(meeting.startedAt).toISOString().slice(0, 10)}.txt`,
    });
    link.click();
    URL.revokeObjectURL(link.href);
  });
  const remove = button("Изтрий", "secondary", async () => {
    await store.remove(meeting.id);
    await loadMeetings();
  });
  row.append(label, download, remove);
  return row;
}

function button(text: string, kind: "primary" | "secondary", onClick: () => void | Promise<void>): HTMLButtonElement {
  const element = Object.assign(document.createElement("button"), { type: "button", textContent: text, className: kind });
  element.addEventListener("click", () => void onClick());
  return element;
}

retention.addEventListener("change", async () => {
  const days = Number(retention.value);
  if (!(RETENTION_CHOICES as readonly number[]).includes(days)) return;
  await store.setRetentionDays(days);
  await loadMeetings();
  meetingsStatus.textContent = `Срокът е ${days} дни. По-старите записи са изтрити.`;
  meetingsStatus.className = "ok";
});

document.querySelector("#delete-all")!.addEventListener("click", async () => {
  if (!confirm("Да се изтрият ли всички запазени срещи? Това не може да се върне.")) return;
  await store.removeAll();
  await loadMeetings();
});

void loadMeetings();

// Дневник на срещите: обобщенията, най-новите първи; всяка се разгъва за подробности.
const meetingLog = new MeetingLog(chrome.storage.local);
const reportsList = document.querySelector<HTMLUListElement>("#reports")!;
const reportsSummary = document.querySelector<HTMLElement>("#reports-summary")!;
const reportsStatus = document.querySelector<HTMLElement>("#reports-status")!;

function el(tag: string, className: string, text = ""): HTMLElement {
  return Object.assign(document.createElement(tag), { className, textContent: text });
}

async function loadReports(): Promise<void> {
  const reports = await meetingLog.list();
  reportsList.replaceChildren(...reports.map(reportRow));
  reportsStatus.textContent = reports.length === 0 ? "Още няма срещи в дневника." : "";
  reportsStatus.className = "";
  // Общо за последните 30 дни: колко срещи, средна оценка и колко завършват с уговорен час.
  const recent = reports.filter((r) => r.startedAt >= Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (recent.length === 0) return reportsSummary.replaceChildren();
  const average = recent.reduce((sum, r) => sum + r.score, 0) / recent.length;
  const withStep = recent.filter((r) => r.nextStep).length;
  const think = recent.filter((r) => r.objections.some((o) => o.id === "think")).length;
  const stat = (label: string, value: string) => {
    const item = el("span", "");
    item.append(`${label}: `, el("strong", "", value));
    return item;
  };
  reportsSummary.replaceChildren(
    stat("Срещи (30 дни)", String(recent.length)),
    stat("Средна оценка", `${average.toFixed(1).replace(".", ",")}/10`),
    stat("С уговорен час", `${withStep} от ${recent.length}`),
    stat("„Ще си помисля“", `${think} ${think === 1 ? "среща" : "срещи"}`),
  );
}

function reportRow(report: MeetingReport): HTMLLIElement {
  const row = document.createElement("li");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const tone = report.score <= 4 ? "low" : report.score <= 7 ? "mid" : "high";
  const when = `${new Date(report.startedAt).toLocaleString("bg-BG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${formatDuration(report.endedAt - report.startedAt)}`;
  const objections = [...new Set(report.objections.map((o) => o.label))];
  summary.append(
    el("span", `score ${tone}`, `${report.score}/10`),
    el("span", "when", when),
    el("span", "tagline", [report.nextStep ? `✓ ${report.nextStep.label}` : "✕ без уговорен час", ...objections].join(" · ")),
  );

  const body = el("div", "body");
  const notes = document.createElement("ul");
  for (const note of report.notes) notes.append(el("li", "", note));
  body.append(notes);
  if (report.objections.length > 0) {
    body.append(el("p", "label", "Възражения"));
    const list = document.createElement("ul");
    for (const o of report.objections) list.append(el("li", "", `${formatOffset(o.atMs)} ${o.label}${o.again ? " (пак)" : ""}`));
    body.append(list);
  }
  if (report.products.length > 0) body.append(el("p", "label", "Роботи"), el("p", "", report.products.join(", ")));
  const total = report.ownerMs + report.counterpartMs;
  if (total > 0) {
    const owner = Math.round((report.ownerMs / total) * 100);
    body.append(el("p", "label", "Говорене"), el("p", "", `Вие ${owner}% · Клиент ${100 - owner}%`));
  }
  body.append(el("p", "label", `Среща ${report.meetingCode} · ${report.hints} подсказки`));
  const actions = el("div", "actions");
  actions.append(
    button("Изтрий", "secondary", async () => {
      await meetingLog.remove(report.id);
      await loadReports();
    }),
  );
  body.append(actions);
  details.append(summary, body);
  row.append(details);
  return row;
}

document.querySelector("#reports-delete-all")!.addEventListener("click", async () => {
  if (!confirm("Да се изтрие ли целият дневник на срещите? Това не може да се върне.")) return;
  await meetingLog.removeAll();
  await loadReports();
});

// Обновява списъка, ако среща приключи, докато страницата е отворена.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && REPORTS_KEY in changes) void loadReports();
});

void loadReports();
