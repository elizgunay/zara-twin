/**
 * Кодът на среща в Google Meet е във формат xxx-xxxx-xxx (малки латински букви),
 * напр. https://meet.google.com/abc-defg-hij. Началната страница, /landing и /new не са срещи.
 */
const MEET_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/;

export function parseMeetCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "meet.google.com") {
    return null;
  }
  return MEET_CODE.exec(parsed.pathname)?.[1] ?? null;
}
