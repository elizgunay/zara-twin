import { buildAuthUrl, parseAuthRedirect, type StoredToken } from "./google";

// Токенът живее само в chrome.storage.session: в паметта, изтрива се при затваряне на браузъра
// и никога не се записва на диска. На диска пазим само флаг „свързан ли е календарът“.
const TOKEN_KEY = "googleCalendarToken";
const CONNECTED_KEY = "googleCalendarConnected";

export const GOOGLE_CLIENT_ID: string = __GOOGLE_CLIENT_ID__;

export async function getStoredToken(): Promise<StoredToken | null> {
  const stored = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as StoredToken | undefined;
  return stored && stored.expiresAt > Date.now() ? stored : null;
}

export async function isConnected(): Promise<boolean> {
  return (await chrome.storage.local.get(CONNECTED_KEY))[CONNECTED_KEY] === true;
}

/** interactive = true само от страницата с настройки, по натискане на бутон. */
export async function signIn(interactive: boolean): Promise<StoredToken> {
  if (!GOOGLE_CLIENT_ID) throw new Error("not-configured");
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: buildAuthUrl(GOOGLE_CLIENT_ID, chrome.identity.getRedirectURL(), interactive),
    interactive,
  });
  if (!redirect) throw new Error("not-connected");
  const token = parseAuthRedirect(redirect, Date.now());
  await chrome.storage.session.set({ [TOKEN_KEY]: token });
  await chrome.storage.local.set({ [CONNECTED_KEY]: true });
  return token;
}

export async function signOut(): Promise<void> {
  const token = await getStoredToken();
  await chrome.storage.session.remove(TOKEN_KEY);
  await chrome.storage.local.remove(CONNECTED_KEY);
  if (token) {
    // Отнема разрешението и в Google, не само локално.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, {
      method: "POST",
    }).catch(() => {});
  }
}

export async function forgetToken(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_KEY);
}
