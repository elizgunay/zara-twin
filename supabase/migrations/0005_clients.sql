-- Фаза 2, памет (Р31–Р35): клиентите на фирмата и фактите за всеки от тях.
-- Продавачът избира клиента в панела (Р32); след срещата AI предлага факти, а собственикът или
-- продавачът ги одобрява (Р33). Клиентите и паметта се виждат от цялата фирма (Р34) и се трият
-- 2 години след последната среща (Р35). Регион: Франкфурт (Р22). Само нужните данни (GDPR).
-- Изпълнява се веднъж в Supabase → SQL Editor, след 0004. Може да се пусне повторно.
-- Проверка: supabase/tests/0005_clients.sql.

-- ---------- Клиенти ----------

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- Фирмата или обектът на клиента, напр. „Ресторант Мома“.
  name text not null check (length(btrim(name)) between 1 and 120),
  contact text check (contact is null or length(contact) <= 120),
  city text check (city is null or length(city) <= 80),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Последната среща с клиента: оттук тече срокът от 2 години (Р35).
  last_meeting_at timestamptz,
  -- За връзките с фактите и срещите: клиентът е винаги от същата фирма.
  unique (id, org_id)
);

create index if not exists clients_org_name on public.clients (org_id, lower(name));

-- ---------- Факти за клиента (паметта) ----------

create table if not exists public.client_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  -- Срещата, от която идва фактът (ако срещата се изтрие, фактът остава).
  report_id uuid references public.meeting_reports (id) on delete set null,
  -- venue: обектът · pain: болката · objection: възражение · price: казана цена или бюджет ·
  -- decision: кой решава · next_step: обещана стъпка · other: друго.
  kind text not null default 'other' check (kind in ('venue', 'pain', 'objection', 'price', 'decision', 'next_step', 'other')),
  fact text not null check (length(btrim(fact)) between 1 and 500),
  -- Цитат от разговора, на който се основава: одобряващият вижда откъде е.
  quote text check (quote is null or length(quote) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade
);

create index if not exists client_facts_client on public.client_facts (client_id, status, created_at desc);
create index if not exists client_facts_pending on public.client_facts (org_id, status);

-- ---------- Среща → клиент ----------

alter table public.meeting_reports add column if not exists client_id uuid;
alter table public.meeting_reports drop constraint if exists meeting_reports_client_fk;
alter table public.meeting_reports add constraint meeting_reports_client_fk
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete set null (client_id);
create index if not exists meeting_reports_client on public.meeting_reports (client_id, started_at desc);

-- Срещата с клиента подновява срока от 2 години (Р35).
create or replace function public.touch_client_meeting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is not null then
    update public.clients c set last_meeting_at = greatest(coalesce(c.last_meeting_at, new.ended_at), new.ended_at)
      where c.id = new.client_id and c.org_id = new.org_id;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_reports_client_touch on public.meeting_reports;
create trigger meeting_reports_client_touch after insert or update of client_id, ended_at on public.meeting_reports
  for each row execute function public.touch_client_meeting();

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
drop trigger if exists client_facts_touch on public.client_facts;
create trigger client_facts_touch before update on public.client_facts
  for each row execute function public.touch_updated_at();

-- Дневник: кой е създал, одобрил или изтрил (без самите факти).
drop trigger if exists audit_clients on public.clients;
create trigger audit_clients after insert or update or delete on public.clients
  for each row execute function public.audit();
drop trigger if exists audit_client_facts on public.client_facts;
create trigger audit_client_facts after insert or update or delete on public.client_facts
  for each row execute function public.audit();

-- ---------- Правила за достъп (Р34: цялата фирма; без поддръжката и каталога) ----------

alter table public.clients enable row level security;
alter table public.client_facts enable row level security;
revoke all on public.clients, public.client_facts from anon;

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using (public.has_role(org_id, array['owner', 'seller']));
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.has_role(org_id, array['owner', 'seller']));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (public.has_role(org_id, array['owner', 'seller']))
  with check (public.has_role(org_id, array['owner', 'seller']));
-- Изтриване на клиент (заедно с паметта му, GDPR): само собственикът.
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated
  using (public.has_role(org_id, array['owner']));

-- Фактите: собственикът и продавачите четат, предлагат, одобряват, поправят и махат (Р33).
drop policy if exists client_facts_all on public.client_facts;
create policy client_facts_all on public.client_facts for all to authenticated
  using (public.has_role(org_id, array['owner', 'seller']))
  with check (public.has_role(org_id, array['owner', 'seller']));

-- ---------- Срок: 2 години от последната среща (Р35) ----------

-- Трие клиентите (и паметта им) без среща от 2 години. Таблото я вика при отваряне. Връща броя.
create or replace function public.purge_expired_clients() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.clients c
    where coalesce(c.last_meeting_at, c.created_at) < now() - interval '2 years'
      and (auth.uid() is null or public.has_role(c.org_id, array['owner']));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.purge_expired_clients() from anon, public;
grant execute on function public.purge_expired_clients() to authenticated;
revoke execute on function public.touch_client_meeting() from anon, public;
