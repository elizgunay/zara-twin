-- Табло на Zara Copilot: фирми, хора и роли, покани, запазени срещи, предложения за памет,
-- одобрена памет и дневник. Регион: Франкфурт (Р22). Всеки ред принадлежи на една фирма
-- и правилата за достъп (RLS) в самата база пазят фирмите една от друга.
-- Изпълнява се веднъж в Supabase → SQL Editor. Проверка: supabase/tests/0001_isolation.sql.
-- Звук не се пази никъде. В дневника няма текст от срещите.

-- ---------- Таблици ----------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  -- Колко дни се пази текстът на запазените срещи (7, 30 или 90).
  retention_days integer not null default 30 check (retention_days in (7, 30, 90)),
  created_at timestamptz not null default now()
);

-- owner: всичко · catalog_editor: само каталогът · support: настройки и дневник, без срещи и памет.
create table public.members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'catalog_editor', 'support')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Никой не се регистрира сам: собственикът кани по имейл, поканата се приема при вход.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null check (role in ('owner', 'catalog_editor', 'support')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

-- Текстът на една среща: само при „Запази“ в разширението. lines = [{speaker, text, at}].
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  meeting_code text not null check (length(meeting_code) between 1 and 64),
  started_at timestamptz not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  unique (org_id, meeting_code, started_at)
);

-- „Клиентът X иска 2 робота T8 до март“: чака решение на собственика (Р8).
create table public.memory_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete cascade,
  subject text not null check (length(subject) between 1 and 200),
  fact text not null check (length(fact) between 1 and 2000),
  -- Цитатът от срещата, от който идва предложението: шефът вижда на какво се основава.
  quote text check (quote is null or length(quote) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz
);

-- Одобрената памет: само тя стига до подсказките в разширението.
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  subject text not null check (length(subject) between 1 and 200),
  fact text not null check (length(fact) between 1 and 2000),
  source_meeting_id uuid references public.meetings (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Кой какво е направил. Без текст от срещите и без самите факти.
create table public.audit_log (
  id bigint generated always as identity primary key,
  -- Без външен ключ: при изтриване на фирма каскадата пише в дневника, докато фирмата изчезва.
  org_id uuid not null,
  actor uuid,
  action text not null,
  target_table text not null,
  target_id uuid,
  at timestamptz not null default now()
);

create index on public.members (user_id);
create index on public.meetings (org_id, saved_at desc);
create index on public.memory_proposals (org_id, status);
create index on public.memories (org_id, subject);
create index on public.audit_log (org_id, at desc);

-- ---------- Проверки за права (ползват се в правилата) ----------
-- security definer: четат members, без да минават през правилата на members (иначе безкраен кръг).

create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.org_id = org and m.user_id = auth.uid());
$$;

create function public.has_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.org_id = org and m.user_id = auth.uid() and m.role = any (roles));
$$;

-- ---------- Правила за достъп ----------

alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.meetings enable row level security;
alter table public.memory_proposals enable row level security;
alter table public.memories enable row level security;
alter table public.audit_log enable row level security;

-- Без вход: нищо.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

create policy orgs_read on public.orgs for select to authenticated using (public.is_member(id));
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_role(id, array['owner'])) with check (public.has_role(id, array['owner']));
-- Нова фирма само през create_org() (тя прави създателя собственик).

create policy members_read on public.members for select to authenticated using (public.is_member(org_id));
create policy members_write on public.members for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

create policy invitations_owner on public.invitations for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

-- Срещите, предложенията и паметта: само собственикът (шефът).
create policy meetings_owner on public.meetings for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));
create policy proposals_owner on public.memory_proposals for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));
create policy memories_owner on public.memories for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

-- Дневникът се чете от собственика и поддръжката; пише се само от тригерите.
create policy audit_read on public.audit_log for select to authenticated
  using (public.has_role(org_id, array['owner', 'support']));

-- ---------- Функции за таблото ----------

-- Нова фирма: създателят става собственик. Връща id на фирмата.
create function public.create_org(org_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Нужен е вход.'; end if;
  insert into public.orgs (name) values (org_name) returning id into new_id;
  insert into public.members (org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

-- При вход: приема поканите за имейла на влезлия. Връща колко покани е приел.
create function public.accept_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare my_email text := lower(coalesce(auth.jwt() ->> 'email', '')); accepted integer;
begin
  if auth.uid() is null or my_email = '' then return 0; end if;
  insert into public.members (org_id, user_id, role)
    select i.org_id, auth.uid(), i.role from public.invitations i where i.email = my_email
    on conflict (org_id, user_id) do nothing;
  delete from public.invitations i where i.email = my_email;
  get diagnostics accepted = row_count;
  return accepted;
end;
$$;

-- Изтрива изтеклите срещи на фирмите, в които влезлият е собственик. Връща броя.
-- Таблото я вика при отваряне; може и по график (pg_cron), без да се променя.
create function public.purge_expired_meetings() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.meetings m using public.orgs o
    where m.org_id = o.id
      and m.saved_at < now() - make_interval(days => o.retention_days)
      and (auth.uid() is null or public.has_role(o.id, array['owner']));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.create_org(text) from anon, public;
revoke execute on function public.accept_invitations() from anon, public;
revoke execute on function public.purge_expired_meetings() from anon, public;
grant execute on function public.create_org(text) to authenticated;
grant execute on function public.accept_invitations() to authenticated;
grant execute on function public.purge_expired_meetings() to authenticated;

-- ---------- Дневник ----------

create function public.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data record := coalesce(new, old);
begin
  insert into public.audit_log (org_id, actor, action, target_table, target_id)
    values (row_data.org_id, auth.uid(), lower(tg_op), tg_table_name, row_data.id);
  return row_data;
end;
$$;

create trigger audit_meetings after insert or delete on public.meetings
  for each row execute function public.audit();
create trigger audit_proposals after insert or update or delete on public.memory_proposals
  for each row execute function public.audit();
create trigger audit_memories after insert or update or delete on public.memories
  for each row execute function public.audit();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger memories_touch before update on public.memories
  for each row execute function public.touch_updated_at();
