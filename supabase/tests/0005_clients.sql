-- Проверка на клиентите и паметта (0005): цялата фирма (собственик и продавачи) вижда клиентите и
-- фактите, поддръжката и другата фирма не виждат нищо; продавачът не трие клиент; изтриване на
-- клиент трие и паметта; срокът тече от последната среща. Всичко е в транзакция и се връща назад.
-- Последният ред при успех: „ПАМЕТТА Е ЗАЩИТЕНА“.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'seller-1@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'seller-2@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a4', 'support-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@example.invalid');
insert into public.orgs (id, name) values
  ('00000000-0000-4000-8000-00000000a000', 'Тест фирма А'),
  ('00000000-0000-4000-8000-00000000b000', 'Тест фирма Б');
insert into public.members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a2', 'seller'),
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a3', 'seller'),
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a4', 'support'),
  ('00000000-0000-4000-8000-00000000b000', '00000000-0000-4000-8000-0000000000b1', 'owner');

set local role authenticated;

-- 1. Продавач 1 създава клиент, среща с него и предложен факт.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$
begin
  insert into public.clients (id, org_id, name, contact, city)
    values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a000', 'Ресторант Тест', 'Иван', 'Хасково');
  insert into public.meeting_reports (id, org_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score, client_id)
    values ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-00000000a000', 'aaa-aaaa-aaa', now() - interval '20 minutes', now(), 60000, 60000, 7, '00000000-0000-4000-8000-0000000c0001');
  insert into public.client_facts (org_id, client_id, report_id, kind, fact, quote)
    values ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000e0001', 'venue', 'Ресторант с 2 зали, под гранитогрес.', 'Имаме две зали.');
  if (select last_meeting_at from public.clients) is null then raise exception 'ГРЕШКА: срещата не поднови срока на клиента.'; end if;
  -- Не може клиент или факт в чужда фирма.
  begin
    insert into public.clients (org_id, name) values ('00000000-0000-4000-8000-00000000b000', 'Чужд');
    raise exception 'ГРЕШКА: продавач 1 създаде клиент във фирма Б.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Продавач 2 (същата фирма) вижда клиента и факта, одобрява го; не може да трие клиента.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare touched integer;
begin
  if (select count(*) from public.clients) <> 1 then raise exception 'ГРЕШКА: продавач 2 не вижда клиента на фирмата.'; end if;
  update public.client_facts set status = 'approved', decided_by = auth.uid(), decided_at = now();
  get diagnostics touched = row_count;
  if touched <> 1 then raise exception 'ГРЕШКА: продавач 2 не може да одобри факт.'; end if;
  delete from public.clients;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'ГРЕШКА: продавач изтри клиент (само собственикът може).'; end if;
end $$;

-- 3. Поддръжката и другата фирма не виждат клиенти и памет.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.clients) + (select count(*) from public.client_facts) <> 0 then raise exception 'ГРЕШКА: поддръжката вижда клиентите.'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.clients) + (select count(*) from public.client_facts) <> 0 then raise exception 'ГРЕШКА: фирма Б вижда клиентите на фирма А.'; end if;
end $$;

-- 4. Собственикът на А трие клиента: паметта изчезва, срещата остава без клиент.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  delete from public.clients where id = '00000000-0000-4000-8000-0000000c0001';
  if (select count(*) from public.client_facts) <> 0 then raise exception 'ГРЕШКА: паметта остана след изтриване на клиента.'; end if;
  if (select count(*) from public.meeting_reports where client_id is null) <> 1 then raise exception 'ГРЕШКА: срещата изчезна или остана вързана.'; end if;
end $$;

-- 5. Без вход: нищо.
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform count(*) from public.clients;
    raise exception 'ГРЕШКА: без вход се четат клиенти.';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;

select 'ПАМЕТТА Е ЗАЩИТЕНА' as "резултат";
