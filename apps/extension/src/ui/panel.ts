import type { AudioSourceKind, MeetingInfo, SpeakerRole } from "@zara-twin/core";
import type { Hint } from "@zara-twin/hints";

const SPEAKER_LABEL: Record<SpeakerRole, string> = {
  owner: "Вие",
  counterpart: "Събеседник",
};

/** Повече карти наведнъж не се четат по време на разговор. */
const MAX_HINTS = 3;
/** Последните реплики са достатъчни за контекст. Целият разговор не се пази. */
const MAX_TRANSCRIPT_ROWS = 50;

export interface PanelOptions {
  /** Затварянето на панела спира и прихващането на звука. */
  onClose?: () => void;
}

/**
 * Панелът върху прозореца на Meet (Р6). Живее в Shadow DOM, за да не се смесват
 * стиловете му с тези на Meet. Текстът от разговора е непроверен вход, затова
 * се вмъква само чрез textContent, никога като HTML.
 */
export class CopilotPanel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly transcript: HTMLElement;
  private readonly emptyState: HTMLElement;

  constructor(
    options: PanelOptions = {},
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
  }

  mount(): void {
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

  /** Отделно от setNotice: състоянието на разпознаването не бива да скрива проблем с микрофона. */
  setMicProblem(text: string): void {
    const mic = this.part("mic");
    mic.textContent = text;
    mic.hidden = false;
  }

  setNotice(tone: "info" | "error", text: string): void {
    const notice = this.part("notice");
    notice.textContent = text;
    notice.className = `notice ${tone}`;
    notice.hidden = false;
  }

  appendSegment(segment: { speaker: SpeakerRole; text: string }): void {
    this.emptyState.hidden = true;
    const row = this.doc.createElement("p");
    const speaker = this.doc.createElement("strong");
    speaker.textContent = `${SPEAKER_LABEL[segment.speaker]}: `;
    row.append(speaker, segment.text);
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
    card.append(title);

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
    width: 320px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: #1f2430; color: #e8eaed; border: 1px solid #3c4352; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font: 13px/1.45 "Segoe UI", Roboto, Arial, sans-serif;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #3c4352; }
  header h1 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
  .badge { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #3c4352; color: #bdc1c6; }
  .rec { font-size: 11px; font-weight: 600; color: #f28b82; display: flex; align-items: center; gap: 4px; }
  .rec::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #f28b82; animation: pulse 1.6s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .rec::before { animation: none; } }
  button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; color: #bdc1c6; font-size: 16px; }
  button:hover { background: #3c4352; color: #fff; }
  button:focus-visible { outline: 2px solid #8ab4f8; }
  .meta { padding: 8px 12px 0; color: #9aa0a6; font-size: 12px; }
  .consent, .notice { margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px; }
  .consent { background: #3b2f12; color: #fdd663; border-left: 3px solid #fdd663; }
  .notice.info { background: #1e3a5f; color: #aecbfa; border-left: 3px solid #8ab4f8; }
  .notice.error { background: #4a1f1f; color: #f6aea9; border-left: 3px solid #f28b82; }
  .levels { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; padding: 10px 12px 0; font-size: 12px; color: #bdc1c6; }
  .meter { height: 6px; border-radius: 3px; background: #3c4352; overflow: hidden; }
  .meter > div { height: 100%; width: 0; background: #81c995; transition: width 90ms linear; }
  .talk { padding: 10px 12px 0; font-size: 12px; color: #bdc1c6; }
  .talk-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .talk-bar { height: 6px; border-radius: 3px; background: #8ab4f8; overflow: hidden; }
  .talk-bar > div { height: 100%; width: 50%; background: #81c995; transition: width 300ms; }
  .talk-bar > div.over { background: #fdd663; }
  .hint.talk { border-left-color: #fdd663; }
  .hints { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 0; }
  .hints:empty { display: none; }
  .hint { padding: 8px 10px; border-radius: 8px; background: #263041; border-left: 3px solid #8ab4f8; }
  .hint.no-data, .hint.calendar { border-left-color: #fdd663; }
  .hint.calendar-free { border-left-color: #81c995; }
  .hint.objection { border-left-color: #c58af9; background: #2d2638; }
  .hint.calendar-busy { border-left-color: #f28b82; background: #3a2526; }
  .hint h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #fff; }
  .hint ul { margin: 0; padding-left: 16px; color: #d2d6db; }
  .hint li { margin: 2px 0; }
  .hint a { display: inline-block; margin-top: 4px; font-size: 11px; color: #8ab4f8; }
  .transcript { flex: 1; overflow-y: auto; padding: 4px 12px 12px; border-top: 1px solid #3c4352; margin-top: 10px; }
  .transcript p { margin: 6px 0; }
  .transcript strong { color: #8ab4f8; font-weight: 600; }
  .empty { color: #9aa0a6; font-style: italic; }
</style>
<section class="panel" role="complementary" aria-label="Zara Copilot">
  <header>
    <h1>Zara Copilot</h1>
    <span class="rec" data-part="recording" hidden>Запис</span>
    <span class="badge">Фаза 1.0</span>
    <button type="button" data-part="close" aria-label="Спри и скрий панела" title="Спри и скрий">×</button>
  </header>
  <div class="meta" data-part="meeting">Няма активна среща</div>
  <div class="meta" data-part="stt" hidden></div>
  <div class="consent">Уведомете участниците, че разговорът се транскрибира.</div>
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
  <div class="hints" data-part="hints" aria-live="polite" aria-label="Подсказки"></div>
  <div class="transcript" data-part="transcript">
    <p class="empty" data-part="empty">Текстът от разговора ще се появи тук.</p>
  </div>
</section>
`;
