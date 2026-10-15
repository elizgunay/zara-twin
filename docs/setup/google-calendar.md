# Свързване на Google Calendar (≈ 15 минути, безплатно)

Copilot проверява дали ръководителят е свободен, когато се уговаря среща.
Вижда **само заетите часове** (обхват `calendar.freebusy`): без заглавия, участници или описания.

> - **Без банкова карта и без таксуване:** Calendar API е безплатен и не изисква активиране на плащания.
> - Паролите въвежда **само собственикът** на календара в прозореца на Google. Claude не ги вижда.
> - Client ID не е тайна, но не го пращайте в чата. Записва се в `.env`.

## Данни за разширението

| | |
|---|---|
| Идентификатор на разширението | `nkejcgbbdabkaciokleacemponljolgb` |
| Адрес за пренасочване (Authorized redirect URI) | `https://nkejcgbbdabkaciokleacemponljolgb.chromiumapp.org/` |

Идентификаторът е постоянен (ключът е в `manifest.json`). Същото се вижда и в настройките на разширението.

## Стъпки в Google Cloud

1. Отворете https://console.cloud.google.com с Gmail акаунта. Ако е за първи път, приемете условията.
   **Не е нужно да активирате плащания (Billing).**
2. Създайте проект `zara-copilot` (меню горе вляво, после **New project**).
3. В търсачката напишете **Google Calendar API** и натиснете **Enable**.
4. **OAuth consent screen** (Google Auth Platform, после **Branding / Audience**):
   - User type: **External**.
   - App name: `Zara Copilot`. Support email: вашият.
   - **Audience:** оставете **Testing** и в **Test users** добавете Gmail адреса на ръководителя, т.е. акаунта, чийто календар се проверява.
   - **Data access / Scopes:** добавете `.../auth/calendar.freebusy`.
5. **Clients**, после **Create client**:
   - Application type: **Web application**.
   - Name: `Zara Copilot extension`.
   - **Authorized redirect URIs:** `https://nkejcgbbdabkaciokleacemponljolgb.chromiumapp.org/`
   - **Create.** Копирайте **Client ID** (завършва на `.apps.googleusercontent.com`).
6. В `.env` (в корена на проекта) попълнете `GOOGLE_OAUTH_CLIENT_ID=...`.
7. Изградете разширението отново:

   ```bash
   npm run build:extension
   ```

8. В `chrome://extensions` натиснете бутона за презареждане на разширението. Ако е зареждано преди тази промяна, премахнете го и го заредете отново, за да вземе новия постоянен идентификатор.
9. Десен бутон върху иконата на Zara Copilot, после **Options** (Опции), после **Свържи календара**. Ръководителят влиза със своя Gmail и разрешава достъпа.

## Как работи

- Токенът за достъп се пази **само в паметта** на браузъра и изчезва при затварянето му.
- Докато Google сесията е активна, Copilot подновява достъпа сам, без прозорци.
- **„Прекъсни“** в настройките отнема разрешението и в Google.
- В режим **Testing** Google показва предупреждение „непроверено приложение“. Това е нормално за пилот. Преди продажба на клиенти приложението минава проверка от Google (виж риска в стратегията).
