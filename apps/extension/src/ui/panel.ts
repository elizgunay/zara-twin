import type { MeetingInfo, TranscriptSegment } from "@zara-twin/core";

const SPEAKER_LABEL: Record<TranscriptSegment["speaker"], string> = {
  owner: "Вие",
  counterpart: "Събеседник",
};

/**
 * Панелът върху прозореца на Meet (Р6). Живее в Shadow DOM, за да не се смесват
 * стиловете му с тези на Meet. Текстът от разговора е непроверен вход, затова
 * се вмъква само чрез textContent, никога като HTML.
 */
export class CopilotPanel {
  private readonly host: HTMLElement;
  private readonly meetingLabel: HTMLElement;
  private readonly transcript: HTMLElement;
  private readonly emptyState: HTMLElement;

  constructor(private readonly doc: Document = document) {
    this.host = doc.createElement("zara-copilot-panel");
    this.host.hidden = true;
    const shadow = this.host.attachShadow({ mode: "closed" });
    shadow.innerHTML = TEMPLATE;
    this.meetingLabel = shadow.querySelector<HTMLElement>("[data-meeting]")!;
    this.transcript = shadow.querySelector<HTMLElement>("[data-transcript]")!;
    this.emptyState = shadow.querySelector<HTMLElement>("[data-empty]")!;
    shadow.querySelector("[data-close]")!.addEventListener("click", () => this.hide());
  }

  mount(): void {
    if (!this.host.isConnected) this.doc.documentElement.append(this.host);
  }

  toggle(): void {
    this.host.hidden = !this.host.hidden;
  }

  hide(): void {
    this.host.hidden = true;
  }

  setMeeting(meeting: MeetingInfo | null): void {
    this.meetingLabel.textContent = meeting ? `Среща: ${meeting.id}` : "Няма активна среща";
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
}

const TEMPLATE = /* html */ `
<style>
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 320px; max-height: 60vh; display: flex; flex-direction: column;
    background: #1f2430; color: #e8eaed; border: 1px solid #3c4352; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font: 13px/1.45 "Segoe UI", Roboto, Arial, sans-serif;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #3c4352; }
  header h1 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
  .badge { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #3c4352; color: #bdc1c6; }
  button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; color: #bdc1c6; font-size: 16px; }
  button:hover { background: #3c4352; color: #fff; }
  button:focus-visible { outline: 2px solid #8ab4f8; }
  .meta { padding: 8px 12px 0; color: #9aa0a6; font-size: 12px; }
  .notice {
    margin: 8px 12px; padding: 8px 10px; border-radius: 8px;
    background: #3b2f12; color: #fdd663; border-left: 3px solid #fdd663;
  }
  .transcript { flex: 1; overflow-y: auto; padding: 4px 12px 12px; }
  .transcript p { margin: 6px 0; }
  .transcript strong { color: #8ab4f8; font-weight: 600; }
  .empty { color: #9aa0a6; font-style: italic; }
</style>
<section class="panel" role="complementary" aria-label="Zara Copilot">
  <header>
    <h1>Zara Copilot</h1>
    <span class="badge">Фаза 1.0</span>
    <button type="button" data-close aria-label="Скрий панела">×</button>
  </header>
  <div class="meta" data-meeting>Няма активна среща</div>
  <div class="notice">Преди старт уведомете участниците, че разговорът се транскрибира.</div>
  <div class="transcript" data-transcript aria-live="polite">
    <p class="empty" data-empty>Транскрипцията още не е включена. Идва в следващата стъпка.</p>
  </div>
</section>
`;
