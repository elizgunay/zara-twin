/**
 * Пакет със знания = профилът на един бизнес (Р21). Ядрото не знае нищо за
 * роботи или уеб сайтове: всичко специфично за клиента е в JSON файл.
 *
 * Правило за точност: всеки факт има източник. Copilot-ът подсказва само факти
 * от пакета, никога измислени стойности. Липсващото се изброява в `missing`.
 */
export interface KnowledgePack {
  /** Уникален идентификатор, напр. "zara-robotics". */
  id: string;
  version: string;
  business: BusinessInfo;
  families: ProductFamily[];
  products: Product[];
  policies: SourcedFact[];
  faq: FaqEntry[];
  /** Готови отговори на чести въпроси на клиента: показват се като изречения за казване. */
  answers?: Answer[];
  /** Какво още не знаем. Copilot-ът казва „няма данни“, вместо да гадае. */
  missing: string[];
  /**
   * „owner“: цените и отстъпките ги казва собственикът сам. Тогава Copilot-ът не го
   * съветва „не давайте цифра“ при въпрос за цена, а само показва продукта.
   */
  pricing?: "owner";
  source: { description: string; retrievedAt: string };
}

export interface BusinessInfo {
  name: string;
  website: string;
  description: string;
  language: string;
  currency: string;
}

export interface ProductFamily {
  id: string;
  name: string;
  /** Как хората казват името на глас, вкл. на кирилица. Малки букви. */
  aliases: string[];
}

export interface Product {
  id: string;
  name: string;
  familyId: string;
  /** Кодът на модела, напр. "C40S". По него се разпознава в разговора. */
  code: string;
  category: string;
  summary: string;
  /** Групи → характеристика → стойност, точно както са в източника. */
  specs: Record<string, Record<string, string>>;
  sourceUrl: string;
}

export interface SourcedFact {
  topic: string;
  text: string;
  sourceUrl: string;
}

/**
 * Въпрос на клиента → готово изречение за отговор. Само от фактите на бизнеса (политики,
 * FAQ, продукти); за липсващо („срок за доставка“) отговорът обещава конкретен срок, без цифри.
 */
export interface Answer {
  id: string;
  /** Заглавие на картата, напр. „Гаранция“. */
  label: string;
  /** Думи и фрази на клиента, по които се разпознава. Малки букви; окончанията се допускат. */
  triggers: string[];
  /** 1–2 изречения за казване дословно (до 140 знака). */
  say: string[];
  sourceUrl: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
  sourceUrl: string;
}
