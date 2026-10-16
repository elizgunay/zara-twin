import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// Пуска миграцията и проверката за изолация в PGlite (PostgreSQL в Node), с макет на
// онова, което Supabase дава наготово: ролите anon/authenticated, схемата auth,
// auth.uid() и auth.jwt() от request.jwt.claims и правата по подразбиране.
// Така грешка в SQL-а или в правилата за достъп се хваща тук, преди истинската база.

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("база на таблото (Supabase)", () => {
  it("миграцията минава, а фирмите не виждат данните една на друга", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(read("../migrations/0001_dashboard.sql"));
    const results = await db.exec(read("./0001_isolation.sql"));
    const last = results.at(-1)?.rows.at(0) as Record<string, string> | undefined;
    expect(last?.["резултат"]).toBe("ИЗОЛАЦИЯТА РАБОТИ");
    // Транзакцията на проверката се връща назад: тестовите данни не остават.
    const left = await db.query<{ n: number }>("select count(*)::int as n from public.orgs");
    expect(left.rows[0]!.n).toBe(0);
    await db.close();
  }, 60_000);

  it("нарушение на правилата спира проверката с грешка", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(read("../migrations/0001_dashboard.sql"));
    // Счупено правило: всеки влязъл чете всички срещи.
    await db.exec("drop policy meetings_owner on public.meetings; create policy leak on public.meetings for select to authenticated using (true);");
    await expect(db.exec(read("./0001_isolation.sql"))).rejects.toThrow(/ГРЕШКА: собственикът на А вижда чужди срещи/);
    await db.close();
  }, 60_000);
});
