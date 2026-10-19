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

  it("дневник на срещите (0002): всеки продавач вижда своите, собственикът всички", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(read("../migrations/0001_dashboard.sql"));
    await db.exec(read("../migrations/0002_meeting_reports.sql"));
    // 0001 продължава да минава след 0002.
    const first = await db.exec(read("./0001_isolation.sql"));
    expect((first.at(-1)?.rows.at(0) as Record<string, string>)["резултат"]).toBe("ИЗОЛАЦИЯТА РАБОТИ");
    const results = await db.exec(read("./0002_reports.sql"));
    expect((results.at(-1)?.rows.at(0) as Record<string, string>)["резултат"]).toBe("ДНЕВНИКЪТ Е ЗАЩИТЕН");
    await db.close();
  }, 60_000);

  it("тестови срещи (0003): поле is_test, по подразбиране false, правилата остават", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(read("../migrations/0001_dashboard.sql"));
    await db.exec(read("../migrations/0002_meeting_reports.sql"));
    await db.exec(read("../migrations/0003_test_meetings.sql"));
    // Повторно пускане не чупи нищо.
    await db.exec(read("../migrations/0003_test_meetings.sql"));
    const results = await db.exec(read("./0002_reports.sql"));
    expect((results.at(-1)?.rows.at(0) as Record<string, string>)["резултат"]).toBe("ДНЕВНИКЪТ Е ЗАЩИТЕН");
    const column = await db.query<{ column_default: string; is_nullable: string }>(
      "select column_default, is_nullable from information_schema.columns where table_name = 'meeting_reports' and column_name = 'is_test'",
    );
    expect(column.rows[0]).toEqual({ column_default: "false", is_nullable: "NO" });
    await db.close();
  }, 60_000);

  it("текст на разговора (0004): пази се с обобщението и се трие след срока на фирмата", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    for (const m of ["0001_dashboard", "0002_meeting_reports", "0003_test_meetings", "0004_meeting_text"]) {
      await db.exec(read(`../migrations/${m}.sql`));
    }
    await db.exec(read("../migrations/0004_meeting_text.sql")); // повторно пускане не чупи
    const results = await db.exec(read("./0002_reports.sql"));
    expect((results.at(-1)?.rows.at(0) as Record<string, string>)["резултат"]).toBe("ДНЕВНИКЪТ Е ЗАЩИТЕН");

    await db.exec(`
      insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a1');
      insert into public.orgs (id, name, retention_days) values ('00000000-0000-4000-8000-00000000a000', 'А', 7);
      insert into public.meeting_reports (org_id, user_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score, lines) values
        ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a1', 'old', now() - interval '10 days', now() - interval '10 days', 0, 0, 5, '[{"speaker":"owner","text":"стар","at":0}]'),
        ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a1', 'new', now() - interval '1 day', now() - interval '1 day', 0, 0, 5, '[{"speaker":"owner","text":"нов","at":0}]');
    `);
    // Без вход (както по график): текстът на старата среща се трие, обобщението остава.
    await db.query("select public.purge_expired_reports()");
    const rows = await db.query<{ meeting_code: string; n: number }>(
      "select meeting_code, jsonb_array_length(lines) as n from public.meeting_reports order by meeting_code",
    );
    expect(rows.rows).toEqual([{ meeting_code: "new", n: 1 }, { meeting_code: "old", n: 0 }]);
    await expect(db.exec(`update public.meeting_reports set lines = '{}'::jsonb`)).rejects.toThrow(/lines_check/);
    await db.close();
  }, 60_000);

  it("продавач, който чете чужди срещи, спира проверката на 0002", async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(read("../migrations/0001_dashboard.sql"));
    await db.exec(read("../migrations/0002_meeting_reports.sql"));
    await db.exec("drop policy reports_read on public.meeting_reports; create policy leak on public.meeting_reports for select to authenticated using (public.is_member(org_id));");
    await expect(db.exec(read("./0002_reports.sql"))).rejects.toThrow(/ГРЕШКА: продавач 2 вижда срещи на продавач 1/);
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
