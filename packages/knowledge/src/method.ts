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
  /**
   * Думи на самия продавач, след които трябва конкретна стъпка („ще се опитам“, „ще ви пратя“
   * без ден и час). По избор: от реалните разговори видяхме, че срещата често свършва така.
   */
  nudges?: Nudge[];
  /**
   * Реплики без въпрос или възражение („Добре.“, „Чувате ли ме?“, „Не е скъпо.“). Разпознаването
   * по смисъл ги ползва като „нищо особено“: ако изречението е най-близо до тях, подсказка няма.
   */
  neutralExamples?: string[];
  /**
   * Сценарият на разговора: целта, стъпките по ред и правилата. AI отговорите го ползват,
   * за да предложат следващата реплика и на изказване на клиента, не само на въпрос. По избор.
   */
  playbook?: Playbook;
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
  /** 1–2 готови изречения, които продавачът казва дословно. Първото е основното. */
  say: string[];
  /** Цели изречения на клиента със същия смисъл, но други думи. За разпознаване по смисъл. По избор. */
  examples?: string[];
  /** 1–2 по-настоятелни реплики, ако клиентът повтори същото възражение в същата среща. */
  escalate?: string[];
  /** 0–1 кратко напомняне (факт от профила), показва се дребно под репликите. */
  tips?: Tip[];
}

export interface Playbook {
  /** Напр. „Уговорено демо с ден и час“. */
  goal: string;
  /** Стъпките по ред, всяка с примерна реплика. */
  steps: string[];
  /** Кратки правила („Никога без дата“). */
  rules: string[];
}

export interface Nudge {
  id: string;
  label: string;
  /** Фрази на продавача. Малки букви. */
  triggers: string[];
  /** 1–2 изречения за казване вместо неясното обещание (до 140 знака). */
  say: string[];
}

export interface Tip {
  text: string;
  /** Ако е зададено, към съвета се добавя политиката от профила с тази тема (напр. „Гаранция“). */
  policyTopic?: string;
}

/** Примерните изречения: по избор, но ако ги има – непразни и кратки. */
export function validExamples(examples: unknown): boolean {
  if (examples === undefined) return true;
  return Array.isArray(examples) && examples.every((e) => typeof e === "string" && e.trim().length > 0 && e.length <= 200);
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
    // По време на разговор се чете само кратко: 1–2 реплики и най-много едно напомняне.
    if (!objection.say?.length || objection.say.length > 2) problems.push(`„${objection.id}“: трябват 1–2 реплики (повече не се четат по време на разговор).`);
    if (objection.escalate !== undefined && (objection.escalate.length === 0 || objection.escalate.length > 2)) problems.push(`„${objection.id}“: трябват 1–2 настоятелни реплики.`);
    if ([...(objection.say ?? []), ...(objection.escalate ?? [])].some((line) => line.length > 140)) problems.push(`„${objection.id}“: репликата е твърде дълга (до 140 знака).`);
    if (!validExamples(objection.examples)) problems.push(`„${objection.id}“: примерните изречения трябва да са до 200 знака.`);
    if ((objection.tips?.length ?? 0) > 1) problems.push(`„${objection.id}“: най-много едно напомняне.`);
  }
  for (const nudge of pack.nudges ?? []) {
    if (!nudge.id || !nudge.label) problems.push("Подсказка за продавача без id или заглавие.");
    if (!nudge.triggers?.length || nudge.triggers.some((t) => t !== t.toLowerCase())) problems.push(`„${nudge.id}“: фразите трябва да са с малки букви.`);
    if (!nudge.say?.length || nudge.say.length > 2 || nudge.say.some((s) => s.length > 140)) problems.push(`„${nudge.id}“: трябват 1–2 реплики до 140 знака.`);
  }
  const book = pack.playbook;
  if (book !== undefined) {
    const texts = (v: unknown, max: number) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((t) => typeof t === "string" && t.trim() && t.length <= 400);
    if (typeof book.goal !== "string" || !book.goal.trim() || !texts(book.steps, 12) || !texts(book.rules, 12)) problems.push("playbook: трябват цел, 1–12 стъпки и 1–12 правила (до 400 знака).");
  }
  if (!validExamples(pack.neutralExamples)) problems.push("neutralExamples: изреченията трябва да са до 200 знака.");
  const talk = pack.talkRatio;
  if (talk !== undefined) {
    if (!(talk.maxOwnerShare > 0 && talk.maxOwnerShare < 1)) problems.push("talkRatio.maxOwnerShare трябва да е между 0 и 1.");
    if (!(talk.windowMinutes >= 1)) problems.push("talkRatio.windowMinutes трябва да е поне 1.");
    if (!(talk.monologueSeconds >= 15)) problems.push("talkRatio.monologueSeconds трябва да е поне 15.");
  }
  if (problems.length > 0) throw new Error(`Невалиден метод:\n- ${problems.join("\n- ")}`);
  return pack;
}
