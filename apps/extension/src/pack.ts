import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";

// Пилот: профилът Zara Robotics и методът за B2B продажби са вградени при изграждане.
// За B2B всеки клиент ще получава своя профил (и вторият бизнес на ръководителя
// ще се избира според срещата, Р21), без промяна в кода.
export const pack = validatePack(rawPack);
export const method = validateMethodPack(rawMethod);
