-- Текстът на разговора към обобщението на срещата: записва се автоматично от разширението.
-- Същите правила за достъп като обобщението (продавачът своите, собственикът всички).
-- Текстът се изтрива след срока на фирмата (Настройки → 7/30/90 дни); обобщението остава година.
-- Изпълнява се веднъж в Supabase → SQL Editor, след 0003.

alter table public.meeting_reports
  add column if not exists lines jsonb not null default '[]'::jsonb;

alter table public.meeting_reports drop constraint if exists meeting_reports_lines_check;
alter table public.meeting_reports add constraint meeting_reports_lines_check
  check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 5000);

-- Изтриване: обобщенията след година, текстът след срока на фирмата. Връща броя засегнати.
create or replace function public.purge_expired_reports() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer; cleared integer;
begin
  delete from public.meeting_reports r
    where r.ended_at < now() - interval '365 days'
      and (auth.uid() is null or public.has_role(r.org_id, array['owner']));
  get diagnostics removed = row_count;
  update public.meeting_reports r set lines = '[]'::jsonb
    from public.orgs o
    where r.org_id = o.id
      and r.lines <> '[]'::jsonb
      and r.ended_at < now() - make_interval(days => o.retention_days)
      and (auth.uid() is null or public.has_role(r.org_id, array['owner']));
  get diagnostics cleared = row_count;
  return removed + cleared;
end;
$$;
