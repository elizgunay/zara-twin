import { validatePack } from "@zara-twin/knowledge";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";

// Пилот: пакетът на Zara Robotics е вграден в разширението при изграждане.
// За B2B всеки клиент ще получава своя пакет (и вторият бизнес на ръководителя
// ще се избира според срещата, Р21), без промяна в кода.
export const pack = validatePack(rawPack);
