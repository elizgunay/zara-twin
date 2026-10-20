import type { Embed } from "@zara-twin/hints";

/**
 * Кеш на векторите за фразите от пакета (IndexedDB на разширението): смятат се веднъж,
 * после всяка среща тръгва за секунди. Ключът е моделът + текстът, затова промяна в пакета
 * смята наново само новите фрази. Изречения от разговора не влизат тук.
 */
const DB_NAME = "zara-meaning";
const STORE = "vectors";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function get(db: IDBDatabase, keys: string[]): Promise<(Float32Array | undefined)[]> {
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return Promise.all(
    keys.map(
      (key) =>
        new Promise<Float32Array | undefined>((resolve) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result instanceof Float32Array ? request.result : undefined);
          request.onerror = () => resolve(undefined);
        }),
    ),
  );
}

function put(db: IDBDatabase, entries: [string, Float32Array][]): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const [key, vector] of entries) tx.objectStore(STORE).put(vector, key);
    tx.oncomplete = () => resolve();
    // Кешът е само за скорост: ако не се запише, следващия път пак ще се сметне.
    tx.onerror = () => resolve();
  });
}

/** embed с кеш. onBatch: колко фрази са готови (за напредъка при първото пускане). */
export async function cachedEmbed(model: string, embed: Embed, onBatch?: (count: number) => void): Promise<Embed> {
  const db = await open().catch(() => null);
  return async (texts) => {
    const key = (text: string) => `${model}|${text}`;
    const found = db ? await get(db, texts.map(key)) : texts.map(() => undefined);
    const missing = texts.filter((_, i) => !found[i]);
    const computed = missing.length > 0 ? await embed(missing) : [];
    if (db && computed.length > 0) await put(db, missing.map((text, i) => [key(text), Float32Array.from(computed[i]!)]));
    let next = 0;
    const result = found.map((vector) => (vector ? Array.from(vector) : computed[next++]!));
    onBatch?.(texts.length);
    return result;
  };
}
