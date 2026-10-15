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
  if (problems.length > 0) throw new Error(`Невалиден метод:\n- ${problems.join("\n- ")}`);
  return pack;
}
