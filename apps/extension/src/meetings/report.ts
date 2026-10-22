import type { Hint, TalkStats } from "@zara-twin/hints";

/**
 * Обобщение на една среща, без AI и без текста на разговора: само това, което Copilot
 * вече е забелязал (възражения, роботи, уговорен час, кой колко говори).
 * Пази се на този компютър, за да видите след срещата как е минала.
 */
export interface MeetingReport {
  /** Кодът на срещата + началото: същата среща се презаписва с по-пълните данни. */
  id: string;
  meetingCode: string;
  startedAt: number;
  endedAt: number;
  ownerMs: number;
  counterpartMs: number;
  /** Колко пъти сте говорили над минута без пауза. */
  monologues: number;
  /** Възраженията по реда, в който ги е казал клиентът. atMs е от началото на срещата. */
  objections: { id: string; label: string; atMs: number; again: boolean }[];
  /** Роботите, за които е ставало дума (заглавията на картите). */
  products: string[];
  /** Последният споменат ден и час, напр. „четвъртък, 10:00“. null = няма уговорка. */
  nextStep: { label: string; atMs: number } | null;
  hints: number;
  /** Тестова среща (бутон „Тест“ в панела): записва се, но се показва отделно. */
  test?: boolean;
  /** Клиентът, избран в панела (Р32); без него срещата не е вързана с клиент. */
  clientId?: string;
  /** 1–10 по прости правила (виж scoreReport). */
  score: number;
  /** Кратки изводи за показване, най-важният първи. */
  notes: string[];
}

/** Говорене над този дял от времето е твърде много (като напомнянето в панела). */
const MAX_OWNER_SHARE = 0.65;
const MAX_ITEMS = 50;

export class MeetingRecorder {
  private readonly objections: MeetingReport["objections"] = [];
  private readonly products: string[] = [];
  private nextStep: MeetingReport["nextStep"] = null;
  private monologues = 0;
  private hints = 0;

  constructor(
    private readonly meetingCode: string,
    private readonly startedAt: number,
  ) {}

  /** Всяка показана подсказка минава оттук. */
  onHint(hint: Hint, at: number): void {
    this.hints++;
    const atMs = Math.max(0, at - this.startedAt);
    if (hint.kind === "objection" && this.objections.length < MAX_ITEMS) {
      const again = hint.key.endsWith(":again");
      const id = hint.key.replace(/^objection:/, "").replace(/:again$/, "");
      this.objections.push({ id, label: hint.title.replace(/ – пак$/, ""), atMs, again });
    } else if (hint.kind === "product" && !this.products.includes(hint.title) && this.products.length < MAX_ITEMS) {
      this.products.push(hint.title);
    } else if (hint.key === "talk:monologue") {
      this.monologues++;
    } else if (hint.kind.startsWith("calendar")) {
      // Заглавието е „Час: …“, „Свободен: …“, „Зает: …“ или само денят; пазим деня и часа.
      this.nextStep = { label: hint.title.replace(/^(Час|Свободен|Зает):\s*/, ""), atMs };
    }
  }

  report(talk: TalkStats, endedAt: number, test = false): MeetingReport {
    const base = {
      test,
      id: `${this.meetingCode}@${this.startedAt}`,
      meetingCode: this.meetingCode,
      startedAt: this.startedAt,
      endedAt,
      ownerMs: talk.ownerMs,
      counterpartMs: talk.counterpartMs,
      monologues: this.monologues,
      objections: [...this.objections],
      products: [...this.products],
      nextStep: this.nextStep,
      hints: this.hints,
    };
    return { ...base, ...scoreReport(base) };
  }
}

/**
 * Оценка по три неща, които решават срещата: следваща стъпка с ден и час,
 * колко говори клиентът и как минават възраженията. Не е присъда, а ориентир.
 */
export function scoreReport(r: Omit<MeetingReport, "score" | "notes">): Pick<MeetingReport, "score" | "notes"> {
  let score = 10;
  const notes: string[] = [];
  const total = r.ownerMs + r.counterpartMs;
  const share = total > 0 ? r.ownerMs / total : null;
  const think = r.objections.filter((o) => o.id === "think");

  if (r.nextStep) notes.push(`Следваща стъпка: ${r.nextStep.label}.`);
  else {
    score -= 3;
    notes.push("Няма уговорен ден и час за следваща стъпка.");
    if (think.length > 0) {
      score -= 1;
      notes.push("Клиентът каза „ще си помисля“ и разговорът приключи без дата.");
    }
  }

  if (share !== null && total >= 60_000) {
    const percent = Math.round(share * 100);
    if (share > 0.75) {
      score -= 3;
      notes.push(`Говорихте ${percent}% от времето: клиентът почти не се изказа.`);
    } else if (share > MAX_OWNER_SHARE) {
      score -= 2;
      notes.push(`Говорихте ${percent}% от времето (добре е под ${Math.round(MAX_OWNER_SHARE * 100)}%).`);
    } else {
      notes.push(`Говорихте ${percent}% от времето: клиентът имаше място да говори.`);
    }
  }

  if (r.monologues > 0) {
    score -= Math.min(2, r.monologues);
    notes.push(`${r.monologues} ${r.monologues === 1 ? "път" : "пъти"} говорихте над минута без пауза.`);
  }

  const repeated = r.objections.filter((o) => o.again).map((o) => o.label);
  if (repeated.length > 0) {
    score -= 1;
    notes.push(`Клиентът повтори: ${[...new Set(repeated)].join(", ")}.`);
  }

  return { score: Math.max(1, Math.min(10, score)), notes };
}

/** „12 мин“, „1 ч 05 мин“. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

/** „03:12“ от началото на срещата. */
export function formatOffset(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const isText = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const isTime = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Проверка на запис, дошъл от content script-а или прочетен от хранилището. */
export function isMeetingReport(value: unknown): value is MeetingReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isText(r.id, 100) &&
    isText(r.meetingCode, 64) &&
    (r.meetingCode as string).length > 0 &&
    isTime(r.startedAt) &&
    isTime(r.endedAt) &&
    (r.endedAt as number) >= (r.startedAt as number) &&
    isTime(r.ownerMs) &&
    isTime(r.counterpartMs) &&
    isTime(r.monologues) &&
    isTime(r.hints) &&
    (r.test === undefined || typeof r.test === "boolean") &&
    (r.clientId === undefined || (typeof r.clientId === "string" && /^[0-9a-f-]{36}$/i.test(r.clientId))) &&
    typeof r.score === "number" &&
    r.score >= 1 &&
    r.score <= 10 &&
    Array.isArray(r.objections) &&
    r.objections.length <= MAX_ITEMS &&
    r.objections.every((o: unknown) => {
      const x = o as Record<string, unknown>;
      return typeof o === "object" && o !== null && isText(x.id, 40) && isText(x.label, 120) && isTime(x.atMs) && typeof x.again === "boolean";
    }) &&
    Array.isArray(r.products) &&
    r.products.length <= MAX_ITEMS &&
    r.products.every((p) => isText(p, 120)) &&
    (r.nextStep === null ||
      (typeof r.nextStep === "object" && isText((r.nextStep as Record<string, unknown>).label, 120) && isTime((r.nextStep as Record<string, unknown>).atMs))) &&
    Array.isArray(r.notes) &&
    r.notes.length <= 20 &&
    r.notes.every((n) => isText(n, 300))
  );
}
