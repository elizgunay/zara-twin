// Генерира постоянен ключ на разширението, за да има един и същ идентификатор
// на всеки компютър. Нужно е за Google вход: адресът за пренасочване съдържа идентификатора.
//
// Публичният ключ отива в manifest.json („key“). Частният ключ се записва в
// data/secrets/ (не влиза в git) и трябва само ако пакетираме .crx сами.
// Употреба (веднъж): npm run generate-key -w @zara-twin/extension
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(root, "..", "manifest.json");
const secretsDir = join(root, "..", "..", "..", "data", "secrets");
const privatePath = join(secretsDir, "extension-key.pem");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.key) {
  console.log(`Ключът вече съществува. Идентификатор: ${extensionId(Buffer.from(manifest.key, "base64"))}`);
  process.exit(0);
}
if (existsSync(privatePath)) throw new Error(`${privatePath} съществува, но manifest.json няма ключ. Проверете ръчно.`);

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicDer = publicKey.export({ type: "spki", format: "der" });

await mkdir(secretsDir, { recursive: true });
await writeFile(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
manifest.key = publicDer.toString("base64");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Готово. Идентификатор на разширението: ${extensionId(publicDer)}`);

/** Chrome: първите 16 байта от SHA-256 на публичния ключ, всяка 16-ична цифра → буква a–p. */
function extensionId(der) {
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}
