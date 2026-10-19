-- Дневник на срещите в таблото: обобщението на всяка среща от разширението, без текста на
-- разговора (кой колко говори, възражения, роботи, уговорен час, оценка). Регион: Франкфурт (Р22).
-- Всеки продавач вижда своите срещи, собственикът вижда всички в своята фирма.
-- Изпълнява се веднъж в Supabase → SQL Editor, след 0001. Проверка: supabase/tests/0002_reports.sql.

-- ---------- Роля „Продавач“: ползва Copilot в срещи ----------

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'catalog_editor', 'support', 'seller'));
alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('owner', 'catalog_editor', 'support', 'seller'));

-- ---------- Обобщения на срещите ----------

create table public.meeting_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- Кой е водил срещата. По подразбиране влезлият: никой не пише от чужде име (виж правилата).
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meeting_code text not null check (length(meeting_code) between 1 and 64),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  owner_ms integer not null check (owner_ms >= 0),
  counterpart_ms integer not null check (counterpart_ms >= 0),
  monologues integer not null default 0 check (monologues >= 0),
  hints integer not null default 0 check (hints >= 0),
  score smallint not null check (score between 1 and 10),
  -- [{id, label, atMs, again}] · ["Keenon Dinerbot T9", …] · {label, atMs} или null · ["…", …]
  objections jsonb not null default '[]'::jsonb check (jsonb_typeof(objections) = 'array' and jsonb_array_length(objections) <= 50),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array' and jsonb_array_length(products) <= 50),
  next_step jsonb check (next_step is null or jsonb_typeof(next_step) = 'object'),
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at),
  -- Разширението обновява същата среща всяка минута: един ред на среща и продавач.
  unique (org_id, user_id, meeting_code, started_at)
);

create index on public.meeting_reports (org_id, started_at desc);
create index on public.meeting_reports (user_id, started_at desc);

create trigger meeting_reports_touch before update on public.meeting_reports
  for each row execute function public.touch_updated_at();

-- ---------- Правила за достъп ----------

alter table public.meeting_reports enable row level security;
revoke all on public.meeting_reports from anon;

-- Чете: своите срещи (ако още е във фирмата) или всички срещи на фирмата, ако е собственик.
create policy reports_read on public.meeting_reports for select to authenticated
  using ((user_id = auth.uid() and public.is_member(org_id)) or public.has_role(org_id, array['owner']));

-- Пише: само своите срещи и само във фирма, в която членува.
create policy reports_insert on public.meeting_reports for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(org_id));
create policy reports_update on public.meeting_reports for update to authenticated
  using (user_id = auth.uid() and public.is_member(org_id))
  with check (user_id = auth.uid() and public.is_member(org_id));

-- Трие: своите срещи или собственикът.
create policy reports_delete on public.meeting_reports for delete to authenticated
  using (user_id = auth.uid() or public.has_role(org_id, array['owner']));

-- ---------- Срок ----------

-- Обобщенията се пазят една година (за тенденции); таблото я вика при отваряне. Връща броя.
create function public.purge_expired_reports() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.meeting_reports r
    where r.ended_at < now() - interval '365 days'
      and (auth.uid() is null or public.has_role(r.org_id, array['owner']));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.purge_expired_reports() from anon, public;
grant execute on function public.purge_expired_reports() to authenticated;
