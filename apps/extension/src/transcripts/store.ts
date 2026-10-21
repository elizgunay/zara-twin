import type { SpeakerRole } from "@zara-twin/core";

/**
 * Запазени текстове от срещи: само на този компютър (chrome.storage.local), само при
 * натиснат „Запази“ и с автоматично изтриване след срок. Основата за Фаза 2 (памет).
 * Звук не се пази никога, а в логовете не влиза текст от тук.
 */
export interface SavedLine {
  speaker: SpeakerRole;
  text: string;
  /** Милисекунди от епохата. */
  at: number;
  /** Картите, които Copilot показа за реда (заглавие, реплики, откъде). */
  cards?: { title: string; say?: string[]; via: "phrase" | "meaning" | "ai" }[];
}

export interface SavedMeeting {
  /** Уникален ключ на записа: кодът на срещата + началото. */
  id: string;
  meetingCode: string;
  startedAt: number;
  savedAt: number;
  lines: SavedLine[];
}

/** Подмножеството на chrome.storage.local, което ползваме (подменя се в тестовете). */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const MEETINGS_KEY = "savedMeetings";
/**
 * Запазването е изключено по подразбиране: докато Фаза 1 се тества, текстът от тестовите
 * срещи не се пази. Включва се изрично в Опции (за Фаза 2).
 */
export const SAVING_ENABLED_KEY = "transcriptSavingEnabled";
export const RETENTION_KEY = "transcriptRetentionDays";
export const DEFAULT_RETENTION_DAYS = 30;
export const RETENTION_CHOICES = [7, 30, 90] as const;
/** Защита срещу препълване на хранилището (10 MB за разширение без unlimitedStorage). */
export const MAX_LINES_PER_MEETING = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class TranscriptStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async retentionDays(): Promise<number> {
    const value: unknown = (await this.storage.get(RETENTION_KEY))[RETENTION_KEY];
    return typeof value === "number" && (RETENTION_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_RETENTION_DAYS;
  }

  async setRetentionDays(days: number): Promise<void> {
    if (!(RETENTION_CHOICES as readonly number[]).includes(days)) throw new Error(`Непозволен срок: ${days} дни.`);
    await this.storage.set({ [RETENTION_KEY]: days });
    await this.prune();
  }

  /** Записва срещата (същата среща се презаписва с по-пълния текст). Връща колко реда са запазени. */
  async save(meeting: Omit<SavedMeeting, "id" | "savedAt">): Promise<SavedMeeting> {
    const saved: SavedMeeting = {
      ...meeting,
      id: `${meeting.meetingCode}@${meeting.startedAt}`,
      savedAt: this.now(),
      lines: meeting.lines.slice(-MAX_LINES_PER_MEETING),
    };
    const others = (await this.list()).filter((item) => item.id !== saved.id);
    await this.write([saved, ...others]);
    await this.prune();
    return saved;
  }

  /** Най-новите първи. Повредени записи се пропускат. */
  async list(): Promise<SavedMeeting[]> {
    const value: unknown = (await this.storage.get(MEETINGS_KEY))[MEETINGS_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter(isSavedMeeting).sort((a, b) => b.startedAt - a.startedAt);
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((item) => item.id !== id));
  }

  async removeAll(): Promise<void> {
    await this.write([]);
  }

  /** Изтрива по-старите от срока (по деня на запазване). */
  async prune(): Promise<number> {
    const limit = this.now() - (await this.retentionDays()) * DAY_MS;
    const all = await this.list();
    const kept = all.filter((item) => item.savedAt >= limit);
    if (kept.length !== all.length) await this.write(kept);
    return all.length - kept.length;
  }

  private async write(meetings: SavedMeeting[]): Promise<void> {
    await this.storage.set({ [MEETINGS_KEY]: meetings });
  }
}

/** Текстов файл за изтегляне: „[10:42] Вие: …“. */
export function meetingToText(meeting: SavedMeeting): string {
  const time = (at: number) => new Date(at).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });
  const who = (speaker: SpeakerRole) => (speaker === "owner" ? "Вие" : "Събеседник");
  const header = [
    `Среща: ${meeting.meetingCode}`,
    `Начало: ${new Date(meeting.startedAt).toLocaleString("bg-BG")}`,
    "Текстът е автоматично разпознат и може да съдържа грешки.",
    "",
  ];
  return [...header, ...meeting.lines.map((line) => `[${time(line.at)}] ${who(line.speaker)}: ${line.text}`)].join("\n");
}

function isSavedMeeting(value: unknown): value is SavedMeeting {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.meetingCode === "string" &&
    typeof item.startedAt === "number" &&
    typeof item.savedAt === "number" &&
    Array.isArray(item.lines)
  );
}
