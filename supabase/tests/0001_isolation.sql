-- Проверка, че фирмите не виждат данните една на друга (правилата за достъп работят).
-- Изпълнява се в Supabase → SQL Editor след 0001_dashboard.sql. Всичко е в транзакция и
-- накрая се връща назад: в базата не остава нищо. При проблем спира с грешка на български.
-- Последният ред при успех: „ИЗОЛАЦИЯТА РАБОТИ“.

begin;

-- Тестови хора и фирми (само в тази транзакция).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'test-b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c1', 'test-c@example.invalid');
insert into public.orgs (id, name) values
  ('00000000-0000-4000-8000-00000000a000', 'Тест фирма А'),
  ('00000000-0000-4000-8000-00000000b000', 'Тест фирма Б');
insert into public.members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-00000000b000', '00000000-0000-4000-8000-0000000000b1', 'owner');
insert into public.meetings (org_id, meeting_code, started_at, lines) values
  ('00000000-0000-4000-8000-00000000a000', 'aaa-aaaa-aaa', now(), '[{"speaker":"owner","text":"А","at":0}]'),
  ('00000000-0000-4000-8000-00000000b000', 'bbb-bbbb-bbb', now(), '[{"speaker":"owner","text":"Б","at":0}]');
insert into public.memories (org_id, subject, fact) values
  ('00000000-0000-4000-8000-00000000a000', 'Клиент А', 'Факт на А'),
  ('00000000-0000-4000-8000-00000000b000', 'Клиент Б', 'Факт на Б');
insert into public.invitations (org_id, email, role) values
  ('00000000-0000-4000-8000-00000000a000', 'test-c@example.invalid', 'catalog_editor');

-- 1. Собственикът на А вижда само А.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","email":"test-a@example.invalid","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.meetings) <> 1 or exists (select 1 from public.meetings where meeting_code <> 'aaa-aaaa-aaa') then
    raise exception 'ГРЕШКА: собственикът на А вижда чужди срещи.';
  end if;
  if (select count(*) from public.memories) <> 1 then raise exception 'ГРЕШКА: собственикът на А вижда чужда памет.'; end if;
  if (select count(*) from public.orgs) <> 1 then raise exception 'ГРЕШКА: собственикът на А вижда чужда фирма.'; end if;
  update public.memories set fact = 'пробив' where org_id = '00000000-0000-4000-8000-00000000b000';
  begin
    insert into public.meetings (org_id, meeting_code, started_at) values ('00000000-0000-4000-8000-00000000b000', 'xxx', now());
    raise exception 'ГРЕШКА: собственикът на А записа среща във фирма Б.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Собственикът на Б вижда само Б, а паметта на Б не е пипана от А.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","email":"test-b@example.invalid","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.meetings) <> 1 or exists (select 1 from public.meetings where meeting_code <> 'bbb-bbbb-bbb') then
    raise exception 'ГРЕШКА: собственикът на Б вижда чужди срещи.';
  end if;
  if (select fact from public.memories) <> 'Факт на Б' then raise exception 'ГРЕШКА: А промени паметта на Б.'; end if;
end $$;

-- 3. Поканеният редактор на каталога влиза във фирма А, но не вижда срещи и памет.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","email":"test-c@example.invalid","role":"authenticated"}', true);
do $$
begin
  if public.accept_invitations() <> 1 then raise exception 'ГРЕШКА: поканата не беше приета.'; end if;
  if (select count(*) from public.orgs) <> 1 then raise exception 'ГРЕШКА: редакторът не вижда фирмата си.'; end if;
  if (select count(*) from public.meetings) <> 0 then raise exception 'ГРЕШКА: редакторът на каталога вижда срещи.'; end if;
  if (select count(*) from public.memories) <> 0 then raise exception 'ГРЕШКА: редакторът на каталога вижда памет.'; end if;
end $$;

-- 4. Без вход: нищо.
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform 1 from public.meetings;
    raise exception 'ГРЕШКА: без вход се четат срещи.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5. Нова фирма през create_org: създателят става собственик.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","email":"test-b@example.invalid","role":"authenticated"}', true);
do $$
declare new_org uuid;
begin
  new_org := public.create_org('Тест фирма В');
  if not public.has_role(new_org, array['owner']) then raise exception 'ГРЕШКА: create_org не направи създателя собственик.'; end if;
end $$;

reset role;
rollback;

select 'ИЗОЛАЦИЯТА РАБОТИ' as "резултат";
