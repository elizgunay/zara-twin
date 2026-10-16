# База данни за таблото: Supabase в ЕС (около 10 минути)

Таблото на Zara Copilot пази срещите, предложенията за памет и одобрената памет в **Supabase, регион Франкфурт** (Р22: данните само в ЕС). Безплатното ниво стига за пилота (Р17).

> **Сигурност**
> - Акаунта и паролата създавате **само вие**. Claude не ги вижда.
> - **Secret key** (`sb_secret_…`) **никога** не се праща в чата, не влиза в git и не се слага в разширението или таблото: той заобикаля всички правила за достъп.
> - **Publishable key** (`sb_publishable_…`) е предвиден за браузъра. Той е безопасен само защото правилата за достъп в базата (стъпка 2 по-долу) пазят данните.

## 1. Акаунт и проект

1. Отворете https://supabase.com → **Start your project** и влезте с GitHub акаунта `elizgunay` или с имейл.
2. **New project**:
   - **Organization:** личната ви (създава се сама).
   - **Project name:** `zara-copilot`.
   - **Database password:** натиснете **Generate a password** и я запазете в мениджър за пароли. В чата не я пращайте.
   - **Region:** **Central EU (Frankfurt)**. Регионът не се сменя след създаването, затова проверете два пъти.
   - **Plan:** **Free**.
3. **Create new project** и изчакайте около 2 минути.

## 2. Таблиците и правата

1. В проекта: **SQL Editor** (лявото меню) → **New query**.
2. Отворете файла `supabase/migrations/0001_dashboard.sql` от проекта, копирайте **целия** текст и го поставете.
3. Натиснете **Run**. Трябва да излезе „Success. No rows returned“.
4. Нова заявка: поставете `supabase/tests/0001_isolation.sql` → **Run**. Последният ред трябва да е **„ИЗОЛАЦИЯТА РАБОТИ“**. Ако излезе грешка, пратете ми текста ѝ.

## 3. Вход

1. **Authentication** → **Sign In / Providers** → **Email**: включено (по подразбиране). Така се влиза с връзка по имейл, без парола.
2. **Authentication** → **URL Configuration**:
   - **Site URL:** `http://localhost:5180` (за пилота; после адресът на таблото).
   - **Redirect URLs:** добавете `http://localhost:5180/**`.

## 4. Ключовете в `.env`

1. **Project Settings** → **API Keys**. Копирайте **Publishable key** (`sb_publishable_…`).
2. **Project Settings** → **Data API** (или бутона **Connect** горе): копирайте **Project URL** (`https://….supabase.co`).
3. В `.env` в корена на проекта добавете:
   ```
   SUPABASE_URL=https://….supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```
4. Напишете на Claude само „готово“, без ключовете.

## 5. Договор за обработка на данни (преди истински клиенти)

Supabase предлага DPA (договор по чл. 28 GDPR). Преди да запазвате срещи с истински клиенти: **Organization settings → Legal Documents** (или страницата им за DPA) и го подпишете.
