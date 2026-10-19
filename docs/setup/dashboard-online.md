# Таблото онлайн: Cloudflare Pages (около 15 минути)

Таблото става достъпно на един адрес от всеки компютър и телефон. В Cloudflare стоят само
файловете на страницата. Данните остават в Supabase във Франкфурт (Р22). Безплатно е (Р17).
Всеки път, когато в GitHub влезе нова версия, Cloudflare изгражда и публикува таблото само.

Преди това: базата е настроена по `docs/setup/supabase.md` (разделите 1–4 и 6).

## 1. Акаунт

1. Отворете **dash.cloudflare.com** и направете безплатен акаунт (имейл и парола). Карта не се иска.

## 2. Свързване с GitHub

1. **Workers & Pages** → **Create** → раздел **Pages** → **Connect to Git**.
2. **GitHub** → разрешете достъп **само до хранилището `zara-twin`** („Only select repositories“).
3. Изберете `elizgunay/zara-twin` → **Begin setup**.

## 3. Настройки на изграждането

| Поле | Стойност |
|---|---|
| Project name | `zara-copilot` (от него идва адресът `zara-copilot.pages.dev`) |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build -w @zara-twin/dashboard` |
| Build output directory | `apps/dashboard/dist` |

**Environment variables** (бутон „Add variable“), от вашия `.env`:

| Име | Стойност |
|---|---|
| `SUPABASE_URL` | адресът на проекта (`https://….supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |

Само тези два. **Никога Secret key** (`sb_secret_…`): изграждането спира с грешка, ако го сложите.

Натиснете **Save and Deploy**. След 2–4 минути излиза адресът, например `https://zara-copilot.pages.dev`.

## 4. Supabase: новият адрес

**Authentication** → **URL Configuration** → **Site URL:** адресът от Cloudflare.

## 5. Проверка

1. Отворете адреса. Трябва да видите „Вход“ с имейл и парола.
2. Влезте с акаунта си. Първия път: **„Създай фирмата“** → `Zara Robotics`.
3. Ако пише „Таблото не е настроено“, променливите в т. 3 липсват или са с грешно име. Поправете ги в **Settings → Variables and Secrets** и натиснете **Retry deployment**.

## По желание: собствен адрес

**Custom domains** → `tablo.zararobotics.com`. Cloudflare показва какъв DNS запис да добавите при хостинга на домейна. После сменете и Site URL в Supabase.
