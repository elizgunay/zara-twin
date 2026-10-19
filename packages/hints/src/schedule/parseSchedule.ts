import type { TimeRange } from "@zara-twin/core";

/**
 * Разпознава уговаряне на час в изречение на български:
 * „следващата сряда в 10“, „утре в 2 следобед“, „на 22 октомври в 11 часа“, „в петък следобед“.
 *
 * За да няма шум, изречението трябва да съдържа ден И (точен час ИЛИ дума за среща).
 * „В петък доставихме три робота“ не е уговаряне.
 * Резултатът винаги съдържа конкретната дата, за да е ясно какво значи „следващата сряда“.
 */
export interface ScheduleMention extends TimeRange {
  /** true, ако е казан точен час; иначе е част от деня или целия работен ден. */
  exactTime: boolean;
  /** Напр. „сряда, 21 окт., 10:00“ или „петък, 16 окт., следобед“. */
  label: string;
}

const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

const WEEKDAYS = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
const WEEKDAY_LABELS = WEEKDAYS;
const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const MONTH_LABELS = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];

const PARTS_OF_DAY: { pattern: RegExp; label: string; from: number; to: number }[] = [
  { pattern: new RegExp(`${B}сутрин(?:та)?${E}`, "iu"), label: "сутринта", from: 9, to: 12 },
  { pattern: new RegExp(`${B}(?:на\\s+)?об[яе]д${E}`, "iu"), label: "на обяд", from: 12, to: 14 },
  { pattern: new RegExp(`${B}следобед${E}`, "iu"), label: "следобед", from: 13, to: 18 },
  { pattern: new RegExp(`${B}вечер(?:та)?${E}`, "iu"), label: "вечерта", from: 18, to: 21 },
];

const INTENT = new RegExp(
  `${B}(срещ[аи]|да\\s+се\\s+(?:видим|чуем|срещнем)|оглед|демонстраци|обаждане|разговор|удобно|свобод|ангажимент|да\\s+дойд|да\\s+мин[ае]|зает|заета)`,
  "iu",
);

const RELATIVE_DAY = new RegExp(`${B}(днес|утре|вдругиден)${E}`, "iu");
const WEEKDAY = new RegExp(
  `${B}(?:(следващ(?:ия|ата|ото)|друг(?:ия|ата|ото))\\s+)?(${WEEKDAYS.join("|")})${E}`,
  "iu",
);
const NEXT_WEEK = new RegExp(`${B}(?:следващата|другата)\\s+седмица${E}`, "iu");
// „21 октомври“, „21-ви октомври“ и „21 ви октомври“ (така го пише разпознаването на говор).
const MONTH_DATE = new RegExp(`${B}(\\d{1,2})(?:[-\\s]?(?:ви|ри|ти|ми))?\\s+(${MONTHS.join("|")})${E}`, "iu");
const NUMERIC_DATE = new RegExp(`${B}на\\s+(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?${E}`, "iu");
// „в 10“, „в 10:30“, „в 10.30“, „в 10 и 30“, „в 10 и половина“, „към 9 часа“
const TIME = new RegExp(
  `${B}(?:в|във|към|около|от)\\s+(\\d{1,2})(?:[:.](\\d{2})|\\s+и\\s+(половина|\\d{1,2}))?(?:\\s*(ч\\.?|часа?|часът))?(?=\\s|[,.!?;]|$)`,
  "iu",
);
// „за 10 часа“: само с „часа“ след числото (иначе „за 3 етажа“ би станало час).
const FOR_TIME = new RegExp(`${B}за\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:ч\\.?|часа?)(?=\\s|[,.!?;]|$)`, "iu");
// Часовете с думи: „в десет“, „за десет часа“, „към два“ → цифри, само след предлог за време.
const HOUR_WORDS: Record<string, number> = {
  един: 1, една: 1, два: 2, две: 2, три: 3, четири: 4, пет: 5, шест: 6, седем: 7, осем: 8, девет: 9, десет: 10,
  единадесет: 11, единайсет: 11, дванадесет: 12, дванайсет: 12,
};
const HOUR_WORD = new RegExp(`${B}(в|във|към|около|от|за)\\s+(${Object.keys(HOUR_WORDS).join("|")})${E}`, "giu");
// „в 3 етажа“, „в 2 години“ не са час: след числото стои мерна единица или предмет.
const QUANTITY_AFTER = /^\s*(?:етаж|ста[яи]|кг|килограм|робот|машин|месец|годин|дни|ден|седмиц|метр|м²|м2|кв|души|човек|хора|бр\.?|броя|процент|%|евро|€|лв|лева|нив[ао]|смен|минут)/iu;

const DEFAULT_DURATION_MIN = 60;
const WORKDAY = { from: 9, to: 18 };

export function parseSchedule(input: string, now: Date): ScheduleMention | null {
  const text = input.replace(HOUR_WORD, (_, prep: string, word: string) => `${prep} ${HOUR_WORDS[word.toLowerCase()]}`);
  const day = resolveDay(text, now);
  if (day === null) return null;

  const time = parseTime(text);
  if (time === null && !INTENT.test(text)) return null;

  const part = PARTS_OF_DAY.find((p) => p.pattern.test(text));
  const dayLabel = formatDay(day);

  if (time !== null) {
    let hour = time.hour;
    // В бизнес разговор „в 3“ значи 15:00, а „в 2 следобед“ също 14:00.
    if (hour >= 1 && hour <= 7) hour += 12;
    else if (part && part.from >= 13 && hour < 12) hour += 12;
    const start = at(day, hour, time.minute);
    const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
    return { start, end, exactTime: true, label: `${dayLabel}, ${formatTime(start)}` };
  }

  const range = part ?? { label: "", ...WORKDAY };
  return {
    start: at(day, range.from, 0),
    end: at(day, range.to, 0),
    exactTime: false,
    label: part ? `${dayLabel}, ${part.label}` : dayLabel,
  };
}

function resolveDay(text: string, now: Date): Date | null {
  const today = at(now, 0, 0);

  const relative = RELATIVE_DAY.exec(text);
  if (relative) {
    const offset = { днес: 0, утре: 1, вдругиден: 2 }[relative[1]!.toLowerCase() as "днес" | "утре" | "вдругиден"];
    return addDays(today, offset);
  }

  const monthDate = MONTH_DATE.exec(text);
  if (monthDate) {
    return futureDate(today, Number(monthDate[1]), MONTHS.indexOf(monthDate[2]!.toLowerCase()));
  }

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const month = Number(numeric[2]) - 1;
    if (month >= 0 && month < 12) {
      const year = numeric[3] ? Number(numeric[3]) : null;
      return year ? new Date(year, month, Number(numeric[1])) : futureDate(today, Number(numeric[1]), month);
    }
  }

  const weekday = WEEKDAY.exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!.toLowerCase());
    const todayIndex = (today.getDay() + 6) % 7; // понеделник = 0
    if (weekday[1] || NEXT_WEEK.test(text)) {
      // „следващата сряда“ / „другата седмица в сряда“ = сряда от следващата седмица.
      const nextMonday = addDays(today, 7 - todayIndex);
      return addDays(nextMonday, target);
    }
    let diff = target - todayIndex;
    if (diff <= 0) diff += 7;
    return addDays(today, diff);
  }
  return null;
}

function parseTime(text: string): { hour: number; minute: number } | null {
  const match = TIME.exec(text);
  if (!match) {
    const forTime = FOR_TIME.exec(text);
    if (!forTime) return null;
    const hour = Number(forTime[1]);
    const minute = forTime[2] !== undefined ? Number(forTime[2]) : 0;
    return hour > 23 || minute > 59 ? null : { hour, minute };
  }
  const hasMinutes = match[2] !== undefined || match[3] !== undefined;
  if (!hasMinutes && match[4] === undefined && QUANTITY_AFTER.test(text.slice(match.index + match[0].length))) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = match[2] !== undefined ? Number(match[2]) : match[3] === "половина" ? 30 : Number(match[3] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function futureDate(today: Date, day: number, month: number): Date | null {
  if (month < 0 || day < 1 || day > 31) return null;
  let date = new Date(today.getFullYear(), month, day);
  if (date < today) date = new Date(today.getFullYear() + 1, month, day);
  return date;
}

function at(date: Date, hour: number, minute: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function formatDay(date: Date): string {
  return `${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTH_LABELS[date.getMonth()]}.`;
}

export function formatTime(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}
