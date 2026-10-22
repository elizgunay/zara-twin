import type { AudioSourceKind, MeetingInfo, SpeakerRole } from "@zara-twin/core";
import type { Hint } from "@zara-twin/hints";
import { formatDuration, type MeetingReport } from "../meetings/report";

const SPEAKER_LABEL: Record<SpeakerRole, string> = {
  owner: "Вие",
  counterpart: "Събеседник",
};

/** Повече карти наведнъж не се четат по време на разговор. */
const MAX_HINTS = 3;
/** Информационно съобщение стои толкова, после изчезва. */
const NOTICE_INFO_MS = 8_000;
/** Последните реплики са достатъчни за контекст. Целият разговор не се пази. */
const MAX_TRANSCRIPT_ROWS = 50;

export interface PanelOptions {
  /** Затварянето на панела спира и прихващането на звука. */
  onClose?: () => void;
  /** Бутонът „Логове“: връща редовете за диагностика. */
  onLogs?: () => Promise<string[]>;
  /** Бутонът „Запази“: запазва текста от срещата и връща съобщение за потребителя. */
  onSave?: () => Promise<{ tone: "info" | "error"; text: string }>;
  /** Бутонът „Тест“: отбелязва срещата като тестова (записва се с етикет, отделно от истинските). */
  onTestMode?: (on: boolean) => void;
  /** Мястото на панела и дали разговорът е разгънат: пазят се за следващата среща. */
  onPrefsChange?: (prefs: PanelPrefs) => void;
  /** Избор на клиента за срещата (Р32): съществуващ по id или нов по име. Връща избрания или null. */
  onClientPick?: (choice: { id: string } | { newName: string }) => Promise<PanelClient | null>;
}

/** Клиент на фирмата, както се показва в полето „Клиент“. */
export interface PanelClient {
  id: string;
  name: string;
  city?: string | null;
}

/** Колко съвпадения се показват под полето. */
const MAX_CLIENT_OPTIONS = 5;

export interface PanelPrefs {
  transcriptOpen: boolean;
  /** Горният ляв ъгъл в пиксели; без тях панелът е горе вдясно. */
  x?: number;
  y?: number;
}

export function isPanelPrefs(value: unknown): value is PanelPrefs {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  const coord = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
  return typeof p.transcriptOpen === "boolean" && coord(p.x) && coord(p.y);
}

/**
 * Панелът върху прозореца на Meet (Р6). Живее в Shadow DOM, за да не се смесват
 * стиловете му с тези на Meet. Текстът от разговора е непроверен вход, затова
 * се вмъква само чрез textContent, никога като HTML.
 */
export class CopilotPanel {
  private stageNames: string[] = [];
  private clients: PanelClient[] = [];
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly transcript: HTMLElement;
  private readonly emptyState: HTMLElement;
  /** Текстът на последния ред: при слепено парче се обновява, вместо да се добавя нов ред. */
  private lastLine: Text | null = null;

  constructor(
    private readonly options: PanelOptions = {},
    private readonly doc: Document = document,
  ) {
    this.host = doc.createElement("zara-copilot-panel");
    this.host.hidden = true;
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.innerHTML = TEMPLATE;
    this.transcript = this.part("transcript");
    this.emptyState = this.part("empty");
    this.part("close").addEventListener("click", () => {
      this.hide();
      options.onClose?.();
    });
    this.part("save").addEventListener("click", () => {
      if (!options.onSave) return;
      void options.onSave().then((result) => this.setNotice(result.tone, result.text));
    });
    this.part("logs").addEventListener("click", () => {
      void this.showLogs(options.onLogs);
    });
    this.part("test").addEventListener("click", () => {
      const on = this.part("test").getAttribute("aria-pressed") !== "true";
      this.setTestMode(on);
      options.onTestMode?.(on);
    });
    this.wireClientPicker();
    this.part("transcript-toggle").addEventListener("click", () => {
      this.setTranscriptOpen(!this.prefs.transcriptOpen);
      options.onPrefsChange?.({ ...this.prefs });
    });
    this.enableDrag(() => options.onPrefsChange?.({ ...this.prefs }));
    this.setTranscriptOpen(false);
  }

  private prefs: PanelPrefs = { transcriptOpen: false };

  /** Възстановява мястото и разгънатия разговор от предишната среща. */
  applyPrefs(prefs: PanelPrefs): void {
    this.setTranscriptOpen(prefs.transcriptOpen);
    if (prefs.x !== undefined && prefs.y !== undefined) this.moveTo(prefs.x, prefs.y);
  }

  /** Разговорът е свит по подразбиране (последните 2 реда): подсказките са по-важни. */
  setTranscriptOpen(open: boolean): void {
    this.prefs.transcriptOpen = open;
    this.transcript.classList.toggle("collapsed", !open);
    const toggle = this.part("transcript-toggle");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Разговор ▾" : "Разговор ▸";
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  /** Местене за заглавната лента; панелът остава изцяло в прозореца. */
  private enableDrag(onDone: () => void): void {
    const header = this.root.querySelector<HTMLElement>("header")!;
    let start: { dx: number; dy: number } | null = null;
    header.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
      const rect = this.panelBox().getBoundingClientRect();
      start = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (start) this.moveTo(event.clientX - start.dx, event.clientY - start.dy);
    });
    const end = () => {
      if (!start) return;
      start = null;
      onDone();
    };
    header.addEventListener("pointerup", end);
    header.addEventListener("pointercancel", end);
    // При смяна на размера на прозореца панелът се връща във видимата част.
    this.doc.defaultView?.addEventListener("resize", () => {
      if (this.prefs.x !== undefined && this.prefs.y !== undefined) this.moveTo(this.prefs.x, this.prefs.y);
    });
  }

  private moveTo(x: number, y: number): void {
    const box = this.panelBox();
    const view = this.doc.defaultView;
    const maxX = Math.max(0, (view?.innerWidth ?? 1280) - box.offsetWidth);
    const maxY = Math.max(0, (view?.innerHeight ?? 800) - 48);
    this.prefs.x = Math.round(Math.min(Math.max(0, x), maxX));
    this.prefs.y = Math.round(Math.min(Math.max(0, y), maxY));
    box.style.left = `${this.prefs.x}px`;
    box.style.top = `${this.prefs.y}px`;
    box.style.right = "auto";
    // Преместен надолу панелът пак свършва над долния ръб: подсказките се превъртат, разговорът се вижда.
    box.style.maxHeight = `calc(100vh - ${this.prefs.y + 16}px)`;
  }

  private panelBox(): HTMLElement {
    return this.root.querySelector<HTMLElement>(".panel")!;
  }

  /**
   * Обобщението веднага след срещата: оценка, уговорен час, възражения и връзка към таблото.
   * Всичко чрез textContent: възраженията и бележките идват от разпознат говор.
   */
  showSummary(report: MeetingReport, dashboardUrl: string): void {
    const box = this.part("summary");
    const title = this.doc.createElement("h2");
    title.textContent = `Срещата приключи · ${report.score}/10${report.test ? " · Тест" : ""}`;
    const meta = this.doc.createElement("p");
    meta.className = "summary-meta";
    meta.textContent = `${formatDuration(report.endedAt - report.startedAt)} · ${report.nextStep ? `✓ ${report.nextStep.label}` : "✕ без уговорен час"}`;
    const list = this.doc.createElement("ul");
    for (const note of report.notes.slice(0, 3)) {
      const item = this.doc.createElement("li");
      item.textContent = note;
      list.append(item);
    }
    const objections = [...new Set(report.objections.map((o) => o.label))];
    const parts: Node[] = [title, meta, list];
    if (objections.length) {
      const line = this.doc.createElement("p");
      line.textContent = `Възражения: ${objections.join(", ")}`;
      parts.push(line);
    }
    if (dashboardUrl.startsWith("https://")) {
      const link = this.doc.createElement("a");
      link.href = `${dashboardUrl.replace(/\/$/, "")}/#/meetings`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Отвори в таблото";
      parts.push(link);
    }
    box.replaceChildren(...parts);
    box.hidden = false;
  }

  hideSummary(): void {
    this.part("summary").hidden = true;
  }

  /** Тестова среща: обобщението се записва с етикет „Тест“. */
  setTestMode(on: boolean): void {
    this.part("test").setAttribute("aria-pressed", String(on));
    this.part("test-note").hidden = !on;
  }

  mount(): void {
    // Панел от предишна версия (разширението е презаредено без F5 на таба) вече не отговаря:
    // махаме го, за да няма два панела един върху друг.
    for (const old of Array.from(this.doc.querySelectorAll("zara-copilot-panel"))) if (old !== this.host) old.remove();
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
  }

  show(): void {
    this.host.hidden = false;
  }

  hide(): void {
    this.host.hidden = true;
  }

  setMeeting(meeting: MeetingInfo | null): void {
    this.part("meeting").textContent = meeting ? `Среща: ${meeting.id}` : "Няма активна среща";
  }

  setRecording(active: boolean): void {
    this.part("recording").hidden = !active;
    this.part("levels").hidden = !active;
    if (!active) {
      this.setLevel("tab", 0);
      this.setLevel("microphone", 0);
      this.part("talk").hidden = true;
      this.part("stt").hidden = true;
      this.part("mic").hidden = true;
    }
  }

  /** level е RMS от 0 до 1. Говорът рядко минава 0.3, затова скалата е корен квадратен. */
  setLevel(source: AudioSourceKind, level: number): void {
    const percent = Math.min(100, Math.round(Math.sqrt(level) * 160));
    this.part(`level-${source}`).style.width = `${percent}%`;
  }

  /** Колко след края на изречението е дошъл текстът (диагностика за пилота). */
  setSttLatency(latencyMs: number): void {
    const stt = this.part("stt");
    stt.hidden = false;
    stt.textContent = `Разпознаване: ${(latencyMs / 1000).toFixed(1).replace(".", ",")} s след изречението`;
  }

  /** Дял на говоренето (0–1) за последните минути; null = още никой не е говорил. */
  setTalkShare(ownerShare: number | null, maxOwnerShare: number): void {
    const row = this.part("talk");
    if (ownerShare === null) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    const owner = Math.round(ownerShare * 100);
    this.part("talk-text").textContent = `Вие ${owner}% · Клиент ${100 - owner}%`;
    const bar = this.part("talk-owner");
    bar.style.width = `${owner}%`;
    bar.classList.toggle("over", ownerShare > maxOwnerShare);
  }

  /** Клиентите на фирмата за полето „Клиент“; null = няма вход в таблото и полето е скрито. */
  setClients(list: PanelClient[] | null): void {
    this.clients = list ?? [];
    this.part("client").hidden = list === null;
  }

  /** Избраният клиент за срещата (видим през цялата среща) или празно поле за търсене. */
  setClient(client: PanelClient | null): void {
    const name = this.part("client-name");
    const input = this.part("client-input") as HTMLInputElement;
    name.textContent = client ? (client.city ? `${client.name} · ${client.city}` : client.name) : "";
    name.hidden = client === null;
    this.part("client-change").hidden = client === null;
    input.hidden = client !== null;
    input.value = "";
    this.part("client-options").hidden = true;
  }

  private wireClientPicker(): void {
    const input = this.part("client-input") as HTMLInputElement;
    const options = this.part("client-options");
    const pick = (choice: { id: string } | { newName: string }) => {
      options.hidden = true;
      input.disabled = true;
      void (this.options.onClientPick?.(choice) ?? Promise.resolve(null))
        .then((client) => {
          if (client) {
            if (!this.clients.some((c) => c.id === client.id)) this.clients = [...this.clients, client];
            this.setClient(client);
          } else this.setNotice("error", "Клиентът не беше записан. Проверете входа в Опции → Табло.");
        })
        .finally(() => {
          input.disabled = false;
        });
    };
    const render = () => {
      const text = input.value.trim();
      const query = text.toLowerCase();
      const matches = query ? this.clients.filter((c) => c.name.toLowerCase().includes(query)).slice(0, MAX_CLIENT_OPTIONS) : [];
      const exact = matches.some((c) => c.name.toLowerCase() === query);
      const buttons = matches.map((client) => {
        const button = this.doc.createElement("button");
        button.type = "button";
        button.textContent = client.city ? `${client.name} · ${client.city}` : client.name;
        button.addEventListener("click", () => pick({ id: client.id }));
        return button;
      });
      if (text && !exact) {
        const add = this.doc.createElement("button");
        add.type = "button";
        add.className = "new";
        add.textContent = `+ Нов: „${text.slice(0, 120)}“`;
        add.addEventListener("click", () => pick({ newName: text.slice(0, 120) }));
        buttons.push(add);
      }
      options.replaceChildren(...buttons);
      options.hidden = buttons.length === 0;
    };
    input.addEventListener("input", render);
    // Клавишите не стигат до Meet (там буквите са преки пътища, напр. за микрофона).
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") (options.querySelector("button") as HTMLButtonElement | null)?.click();
      if (event.key === "Escape") options.hidden = true;
    });
    this.part("client-change").addEventListener("click", () => {
      this.setClient(null);
      input.focus();
    });
  }

  /** Стъпките на сценария (кратките имена); без тях лентата е скрита. */
  setStages(names: string[]): void {
    this.stageNames = names;
    const dots = this.part("stage-dots");
    dots.replaceChildren(
      ...names.map((name) => {
        const dot = this.doc.createElement("span");
        dot.title = name;
        return dot;
      }),
    );
    this.part("stages").hidden = names.length === 0;
  }

  /** Текущата стъпка (0 = първата): предишните са взети, текущата свети. */
  setStage(index: number): void {
    const names = this.stageNames;
    if (names.length === 0) return;
    const current = Math.max(0, Math.min(names.length - 1, index));
    Array.from(this.part("stage-dots").children).forEach((dot, i) => {
      dot.className = i < current ? "done" : i === current ? "now" : "";
    });
    this.part("stage-name").textContent = `Стъпка ${current + 1} от ${names.length} · ${names[current]}`;
  }

  /** Бутонът „Запази“ се вижда само ако запазването е включено в Опции. */
  setSaveAvailable(available: boolean): void {
    this.part("save").hidden = !available;
  }

  /** Отделно от setNotice: състоянието на разпознаването не бива да скрива проблем с микрофона. */
  setMicProblem(text: string): void {
    const mic = this.part("mic");
    mic.textContent = text;
    mic.hidden = false;
  }

  /** Показва логовете за копиране и ги слага в клипборда, ако браузърът позволи. */
  private async showLogs(load: PanelOptions["onLogs"]): Promise<void> {
    const box = this.part("logs-box") as HTMLTextAreaElement;
    // Второ натискане скрива логовете, за да не заемат място.
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    const lines = load ? await load().catch((error: unknown) => [`Логовете не се заредиха: ${String(error)}`]) : [];
    box.value = lines.join("\n");
    box.hidden = false;
    box.select();
    const copied = await navigator.clipboard.writeText(box.value).then(() => true, () => false);
    this.setNotice("info", copied ? "Логовете са копирани. Поставете ги в чата (Ctrl+V)." : "Маркирайте текста долу и го копирайте (Ctrl+C).");
  }

  setNotice(tone: "info" | "error", text: string): void {
    const notice = this.part("notice");
    notice.textContent = text;
    notice.className = `notice ${tone}`;
    notice.hidden = false;
    // Информацията („разпознаването е включено“) изчезва сама, за да не заема място; грешките остават.
    clearTimeout(this.noticeTimer);
    if (tone === "info") this.noticeTimer = setTimeout(() => (notice.hidden = true), NOTICE_INFO_MS);
  }

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** merged: парчето продължава предишния ред (същият човек, без пауза): редът се обновява. */
  appendSegment(segment: { speaker: SpeakerRole; text: string }, merged = false): void {
    this.emptyState.hidden = true;
    if (merged && this.lastLine) {
      this.lastLine.textContent = segment.text;
      this.transcript.scrollTop = this.transcript.scrollHeight;
      return;
    }
    const row = this.doc.createElement("p");
    const speaker = this.doc.createElement("strong");
    speaker.textContent = `${SPEAKER_LABEL[segment.speaker]}: `;
    this.lastLine = this.doc.createTextNode(segment.text);
    row.append(speaker, this.lastLine);
    this.transcript.append(row);
    while (this.transcript.querySelectorAll("p:not([data-part])").length > MAX_TRANSCRIPT_ROWS) {
      this.transcript.querySelector("p:not([data-part])")!.remove();
    }
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  /** Най-новата подсказка е най-отгоре. Всичко се вмъква чрез textContent. */
  showHint(hint: Hint): void {
    const hints = this.part("hints");
    const card = this.doc.createElement("article");
    card.className = `hint ${hint.kind}`;

    const title = this.doc.createElement("h2");
    title.textContent = hint.title;
    if (hint.byAi) {
      // Съставено от AI: продавачът да провери с поглед, преди да го каже.
      const tag = this.doc.createElement("span");
      tag.className = "by-meaning";
      tag.title = "Съставено от AI от фактите на фирмата (няма готова карта)";
      tag.textContent = "AI";
      title.append(" ", tag);
    }
    if (hint.byMeaning) {
      // Разпознато по смисъл, не по точна фраза: продавачът да е готов, че може да е неточно.
      const tag = this.doc.createElement("span");
      tag.className = "by-meaning";
      tag.title = "Разпознато по смисъл (локален модел), не по точна фраза";
      tag.textContent = "по смисъл";
      title.append(" ", tag);
    }
    card.append(title);

    // Готовите реплики се четат на един поглед: едър шрифт, в кавички, първата е основната.
    hint.say?.forEach((line, index) => {
      const quote = this.doc.createElement("p");
      quote.className = index === 0 ? "say main" : "say";
      quote.textContent = `„${line}“`;
      card.append(quote);
    });

    if (hint.lines.length > 0) {
      const list = this.doc.createElement("ul");
      for (const line of hint.lines) {
        const item = this.doc.createElement("li");
        item.textContent = line;
        list.append(item);
      }
      card.append(list);
    }

    if (hint.sourceUrl?.startsWith("https://")) {
      const source = this.doc.createElement("a");
      source.href = hint.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = "източник";
      card.append(source);
    }

    hints.prepend(card);
    while (hints.children.length > MAX_HINTS) hints.lastElementChild!.remove();
  }

  clearHints(): void {
    this.part("hints").replaceChildren();
  }

  private part(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  }
}

const TEMPLATE = /* html */ `
<style>
  :host { all: initial; }
  /* „all: initial“ отменя и скриването чрез атрибута hidden (стилът на страницата побеждава
     вградения в браузъра), затова скриваме хоста изрично. Без това панелът се виждаше винаги. */
  :host([hidden]) { display: none !important; }
  [hidden] { display: none !important; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: #1f2430; color: #e8eaed; border: 1px solid #3c4352; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font: 13px/1.45 "Segoe UI", Roboto, Arial, sans-serif;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #3c4352; cursor: move; user-select: none; touch-action: none; }
  header button { cursor: pointer; }
  header h1 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; }
  header > * { white-space: nowrap; }
  .badge { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #3c4352; color: #bdc1c6; }
  .rec { font-size: 11px; font-weight: 600; color: #f28b82; display: flex; align-items: center; gap: 4px; }
  .rec::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #f28b82; animation: pulse 1.6s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .rec::before { animation: none; } }
  button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; color: #bdc1c6; font-size: 16px; }
  button:hover { background: #3c4352; color: #fff; }
  button:focus-visible { outline: 2px solid #8ab4f8; }
  .meta { padding: 8px 12px 0; color: #9aa0a6; font-size: 12px; }
  .client { position: relative; display: flex; align-items: center; gap: 6px; padding: 6px 12px 0; font-size: 12px; color: #9aa0a6; }
  .client-name { color: #e8eaed; font-weight: 600; }
  .client input { flex: 1; min-width: 0; font: inherit; color: #e8eaed; background: #11151c; border: 1px solid #3c4352; border-radius: 6px; padding: 4px 8px; }
  .client input:focus { outline: none; border-color: #8ab4f8; }
  .client-options { position: absolute; left: 62px; right: 12px; top: 32px; z-index: 2; display: grid; background: #263041; border: 1px solid #3c4352; border-radius: 6px; overflow: hidden; }
  .client-options button { text-align: left; font: inherit; color: #e8eaed; background: transparent; border: 0; padding: 6px 8px; cursor: pointer; }
  .client-options button:hover, .client-options button:first-child { background: #303b4f; }
  .client-options button.new { color: #81c995; }
  .consent, .notice { margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px; }
  .consent { background: #3b2f12; color: #fdd663; border-left: 3px solid #fdd663; }
  .notice.info { background: #1e3a5f; color: #aecbfa; border-left: 3px solid #8ab4f8; }
  .notice.error { background: #4a1f1f; color: #f6aea9; border-left: 3px solid #f28b82; }
  .levels { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; padding: 10px 12px 0; font-size: 12px; color: #bdc1c6; }
  .meter { height: 6px; border-radius: 3px; background: #3c4352; overflow: hidden; }
  .meter > div { height: 100%; width: 0; background: #81c995; transition: width 90ms linear; }
  .talk { padding: 10px 12px 0; font-size: 12px; color: #bdc1c6; }
  .stages { padding: 8px 12px 0; font-size: 12px; color: #bdc1c6; }
  .stage-dots { display: flex; gap: 3px; margin-bottom: 4px; }
  .stage-dots span { flex: 1; height: 5px; border-radius: 3px; background: #3c4352; }
  .stage-dots span.done { background: #81c995; }
  .stage-dots span.now { background: #fdd663; }
  .stage-name { font-weight: 600; color: #e8eaed; }
  .talk-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .talk-bar { height: 6px; border-radius: 3px; background: #8ab4f8; overflow: hidden; }
  .talk-bar > div { height: 100%; width: 50%; background: #81c995; transition: width 300ms; }
  .talk-bar > div.over { background: #fdd663; }
  .hint.talk { border-left-color: #fdd663; }
  /* Подреждане по височина: горните части не се свиват; подсказките заемат мястото и се превъртат;
     разговорът е винаги видим най-долу (свит: 2 реда, разгънат: до 35% от екрана). */
  .panel > * { flex-shrink: 0; }
  .hints { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 4px; flex: 1 1 auto; min-height: 72px; overflow-y: auto; }
  .hints:empty { display: none; }
  .hint { padding: 8px 10px; border-radius: 8px; background: #263041; border-left: 3px solid #8ab4f8; }
  .hint.no-data, .hint.calendar { border-left-color: #fdd663; }
  .hint.calendar-free { border-left-color: #81c995; }
  .hint.objection { border-left-color: #c58af9; background: #2d2638; }
  .hint.answer { border-left-color: #81c995; background: #1f3329; }
  .hint.answer .say { color: #c8ecd3; }
  .hint.calendar-busy { border-left-color: #f28b82; background: #3a2526; }
  .hint h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #fff; }
  .hint h2 .by-meaning { font-size: 10px; font-weight: 500; color: #c4c7c5; border: 1px solid #5f6368; border-radius: 4px; padding: 0 4px; vertical-align: 1px; }
  /* Най-новата подсказка е отгоре и изпъква; по-старите са бледи и по-дребни. */
  .hints .hint:first-child { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18); }
  .hints .hint:not(:first-child) { opacity: 0.55; padding: 5px 10px; }
  /* По-старите: заглавието и основната реплика цяла (по-дребно), без резервната, за да не избутват разговора. */
  .hints .hint:not(:first-child) ul, .hints .hint:not(:first-child) .say:not(.main), .hints .hint:not(:first-child) a { display: none; }
  .hints .hint:not(:first-child) h2 { margin: 0; }
  .hints .hint:not(:first-child) .say.main { font-size: 12px; font-weight: 500; margin-top: 2px; }
  .hint ul { margin: 0; padding-left: 16px; color: #d2d6db; }
  .hint li { margin: 2px 0; }
  .hint .say { margin: 6px 0 0; font-size: 13px; line-height: 1.4; color: #d7c4f5; }
  .hint .say.main { font-size: 15px; font-weight: 600; color: #fff; }
  .hint .say + ul { margin-top: 6px; font-size: 12px; color: #9aa0a6; }
  .hint a { display: inline-block; margin-top: 4px; font-size: 11px; color: #8ab4f8; }
  .section-toggle { margin: 10px 0 0; padding: 6px 12px; border-top: 1px solid #3c4352; border-radius: 0; font-size: 12px; font-weight: 600; color: #9aa0a6; text-align: left; }
  .transcript { flex: 0 1 auto; max-height: 35vh; overflow-y: auto; padding: 0 12px 12px; }
  /* Свит разговор: само последните 2 реда, подсказките остават главното. */
  .transcript.collapsed { flex: none; max-height: 3.2em; overflow: hidden; padding-bottom: 8px; color: #9aa0a6; }
  .transcript.collapsed p { margin: 2px 0; }
  .transcript p { margin: 6px 0; }
  .transcript strong { color: #8ab4f8; font-weight: 600; }
  .empty { color: #9aa0a6; font-style: italic; }
  button.small { font-size: 11px; padding: 2px 6px; background: #3c4352; }
  button.test[aria-pressed="true"] { background: #fdd663; color: #202124; font-weight: 600; }
  .test-note { color: #fdd663; }
  .summary { margin: 10px 12px 0; padding: 10px 12px; border-radius: 8px; background: #1e3a5f; border-left: 3px solid #8ab4f8; }
  .summary h2 { margin: 0 0 4px; font-size: 15px; color: #fff; }
  .summary .summary-meta { margin: 0 0 6px; color: #aecbfa; font-weight: 600; }
  .summary ul { margin: 0 0 6px; padding-left: 16px; color: #d2d6db; }
  .summary p { margin: 0 0 6px; color: #d2d6db; }
  .summary a { display: inline-block; padding: 4px 10px; border-radius: 6px; background: #8ab4f8; color: #1f2430; font-weight: 600; text-decoration: none; }
  .summary a:focus-visible { outline: 2px solid #fff; }
  .logs { margin: 8px 12px 0; height: 120px; resize: vertical; background: #11151c; color: #bdc1c6; border: 1px solid #3c4352; border-radius: 6px; font: 10px/1.3 Consolas, monospace; }
</style>
<section class="panel" role="complementary" aria-label="Zara Copilot">
  <header>
    <h1>Zara Copilot</h1>
    <span class="rec" data-part="recording" hidden>Запис</span>
    <button type="button" class="small test" data-part="test" aria-pressed="false" title="Тестова среща: записва се с етикет „Тест“, отделно от истинските">Тест</button>
    <button type="button" class="small" data-part="save" title="Запази текста от срещата на този компютър" hidden>Запази</button>
    <button type="button" class="small" data-part="logs" title="Копирай логовете за диагностика">Логове</button>
    <button type="button" data-part="close" aria-label="Спри и скрий панела" title="Спри и скрий">×</button>
  </header>
  <div class="meta" data-part="meeting">Няма активна среща</div>
  <div class="client" data-part="client" hidden>
    <span class="client-label">Клиент:</span>
    <span class="client-name" data-part="client-name" hidden></span>
    <button type="button" class="small" data-part="client-change" hidden>смени</button>
    <input type="text" data-part="client-input" maxlength="120" autocomplete="off" spellcheck="false" placeholder="търсете или напишете ново име" aria-label="Клиент">
    <div class="client-options" data-part="client-options" hidden></div>
  </div>
  <div class="meta" data-part="stt" hidden></div>
  <div class="meta test-note" data-part="test-note" hidden>Тестова среща: записва се с етикет „Тест“.</div>
  <div class="consent">Уведомете участниците, че разговорът се записва като текст.</div>
  <section class="summary" data-part="summary" role="status" hidden></section>
  <div class="notice" data-part="notice" role="status" hidden></div>
  <div class="notice error" data-part="mic" role="alert" hidden></div>
  <div class="levels" data-part="levels" hidden>
    <span>Събеседник</span><div class="meter"><div data-part="level-tab"></div></div>
    <span>Вие</span><div class="meter"><div data-part="level-microphone"></div></div>
  </div>
  <div class="talk" data-part="talk" hidden>
    <div class="talk-head"><span title="Последните 3 минути">Говорене</span><span data-part="talk-text"></span></div>
    <div class="talk-bar"><div data-part="talk-owner"></div></div>
  </div>
  <div class="stages" data-part="stages" hidden>
    <div class="stage-dots" data-part="stage-dots"></div>
    <span class="stage-name" data-part="stage-name">Стъпка 1 · очаква разговора</span>
  </div>
  <textarea class="logs" data-part="logs-box" readonly hidden></textarea>
  <div class="hints" data-part="hints" aria-live="polite" aria-label="Подсказки"></div>
  <button type="button" class="section-toggle" data-part="transcript-toggle" aria-expanded="false">Разговор ▸</button>
  <div class="transcript" data-part="transcript">
    <p class="empty" data-part="empty">Текстът от разговора ще се появи тук.</p>
  </div>
</section>
`;
