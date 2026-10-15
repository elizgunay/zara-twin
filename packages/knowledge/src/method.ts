/**
 * Пакет „Метод“ (Р21): КАК се продава, независимо КАКВО се продава.
 * Един метод работи с всеки профил на бизнес: съветът „споменете гаранцията“
 * взима текста на гаранцията от профила на конкретния клиент.
 */
export interface MethodPack {
  id: string;
  version: string;
  kind: "method";
  language: string;
  objections: Objection[];
  /** Колко да говори продавачът. По избор: без него се ползват стойностите по подразбиране. */
  talkRatio?: TalkRatioRules;
}

export interface TalkRatioRules {
  /** Над този дял от говоренето (0–1) Copilot напомня да се даде думата на клиента. */
  maxOwnerShare: number;
  /** За какъв период се смята делът (последните N минути, не цялата среща). */
  windowMinutes: number;
  /** Монолог: толкова секунди говорене без клиентът да се включи. */
  monologueSeconds: number;
}

export interface Objection {
  id: string;
  /** Заглавие на подсказката, напр. „Възражение: цена“. */
  label: string;
  /** Фрази, по които се разпознава. Малки букви; окончанията се допускат автоматично. */
  triggers: string[];
  tips: Tip[];
}

export interface Tip {
  text: string;
  /** Ако е зададено, към съвета се добавя политиката от профила с тази тема (напр. „Гаранция“). */
  policyTopic?: string;
}

export function validateMethodPack(value: unknown): MethodPack {
  const pack = value as MethodPack;
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) throw new Error("Методът не е обект.");
  if (pack.kind !== "method") problems.push("Полето „kind“ трябва да е „method“.");
  if (!pack.id || !pack.version) problems.push("Липсва id или version.");
  if (!Array.isArray(pack.objections) || pack.objections.length === 0) problems.push("Няма възражения.");
  const ids = new Set<string>();
  for (const objection of pack.objections ?? []) {
    if (ids.has(objection.id)) problems.push(`Повторено възражение „${objection.id}“.`);
    ids.add(objection.id);
    if (!objection.label) problems.push(`„${objection.id}“: липсва заглавие.`);
    if (!objection.triggers?.length) problems.push(`„${objection.id}“: няма фрази за разпознаване.`);
    if (objection.triggers?.some((t) => t !== t.toLowerCase())) problems.push(`„${objection.id}“: фразите трябва да са с малки букви.`);
    if (!objection.tips?.length || objection.tips.length > 3) problems.push(`„${objection.id}“: трябват 1–3 съвета (повече не се четат по време на разговор).`);
  }
  const talk = pack.talkRatio;
  if (talk !== undefined) {
    if (!(talk.maxOwnerShare > 0 && talk.maxOwnerShare < 1)) problems.push("talkRatio.maxOwnerShare трябва да е между 0 и 1.");
    if (!(talk.windowMinutes >= 1)) problems.push("talkRatio.windowMinutes трябва да е поне 1.");
    if (!(talk.monologueSeconds >= 15)) problems.push("talkRatio.monologueSeconds трябва да е поне 15.");
  }
  if (problems.length > 0) throw new Error(`Невалиден метод:\n- ${problems.join("\n- ")}`);
  return pack;
}
