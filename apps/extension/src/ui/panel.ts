import type { AudioSourceKind, MeetingInfo, TranscriptSegment } from "@zara-twin/core";

const SPEAKER_LABEL: Record<TranscriptSegment["speaker"], string> = {
  owner: "Вие",
  counterpart: "Събеседник",
};

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
    }
  }

  /** level е RMS от 0 до 1. Говорът рядко минава 0.3, затова скалата е корен квадратен. */
  setLevel(source: AudioSourceKind, level: number): void {
    const percent = Math.min(100, Math.round(Math.sqrt(level) * 160));
    this.part(`level-${source}`).style.width = `${percent}%`;
  }

  setNotice(tone: "info" | "error", text: string): void {
    const notice = this.part("notice");
    notice.textContent = text;
    notice.className = `notice ${tone}`;
    notice.hidden = false;
  }

  appendSegment(segment: TranscriptSegment): void {
    this.emptyState.hidden = true;
    const row = this.doc.createElement("p");
    const speaker = this.doc.createElement("strong");
    speaker.textContent = `${SPEAKER_LABEL[segment.speaker]}: `;
    row.append(speaker, segment.text);
    this.transcript.append(row);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private part(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  }
}

const TEMPLATE = /* html */ `
<style>
  :host { all: initial; }
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
  .transcript { flex: 1; overflow-y: auto; padding: 4px 12px 12px; }
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
  <div class="consent">Уведомете участниците, че разговорът се транскрибира.</div>
  <div class="notice" data-part="notice" role="status" hidden></div>
  <div class="levels" data-part="levels" hidden>
    <span>Събеседник</span><div class="meter"><div data-part="level-tab"></div></div>
    <span>Вие</span><div class="meter"><div data-part="level-microphone"></div></div>
  </div>
  <div class="transcript" data-part="transcript" aria-live="polite">
    <p class="empty" data-part="empty">Транскрипцията идва в следващата стъпка.</p>
  </div>
</section>
`;
