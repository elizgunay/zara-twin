-- Проверка на дневника на срещите: продавачът вижда и пише само своите обобщения,
-- собственикът вижда всички в своята фирма, а другата фирма не вижда нищо.
-- Изпълнява се в Supabase → SQL Editor след 0002_meeting_reports.sql. Всичко е в транзакция и
-- накрая се връща назад. Последният ред при успех: „ДНЕВНИКЪТ Е ЗАЩИТЕН“.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'seller-1@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'seller-2@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@example.invalid');
insert into public.orgs (id, name) values
  ('00000000-0000-4000-8000-00000000a000', 'Тест фирма А'),
  ('00000000-0000-4000-8000-00000000b000', 'Тест фирма Б');
insert into public.members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a2', 'seller'),
  ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a3', 'seller'),
  ('00000000-0000-4000-8000-00000000b000', '00000000-0000-4000-8000-0000000000b1', 'owner');

set local role authenticated;

-- 1. Продавач 1 записва своя среща, но не от чуждо име и не в чужда фирма.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$
begin
  insert into public.meeting_reports (org_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score)
    values ('00000000-0000-4000-8000-00000000a000', 'aaa-aaaa-aaa', '2026-10-19 10:00+00', '2026-10-19 10:20+00', 60000, 60000, 7);
  -- Обновяване на същата среща (както прави разширението всяка минута).
  insert into public.meeting_reports (org_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score)
    values ('00000000-0000-4000-8000-00000000a000', 'aaa-aaaa-aaa', '2026-10-19 10:00+00', '2026-10-19 10:30+00', 90000, 90000, 8)
    on conflict (org_id, user_id, meeting_code, started_at) do update set ended_at = excluded.ended_at, score = excluded.score;
  if (select score from public.meeting_reports) <> 8 then raise exception 'ГРЕШКА: срещата не се обнови.'; end if;
  begin
    insert into public.meeting_reports (org_id, user_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score)
      values ('00000000-0000-4000-8000-00000000a000', '00000000-0000-4000-8000-0000000000a3', 'fake', now(), now(), 0, 0, 10);
    raise exception 'ГРЕШКА: продавач 1 записа среща от името на продавач 2.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.meeting_reports (org_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score)
      values ('00000000-0000-4000-8000-00000000b000', 'bbb', now(), now(), 0, 0, 5);
    raise exception 'ГРЕШКА: продавач 1 записа среща във фирма Б.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Продавач 2 записва своя среща и не вижда, не променя и не трие тази на продавач 1.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare touched integer;
begin
  insert into public.meeting_reports (org_id, meeting_code, started_at, ended_at, owner_ms, counterpart_ms, score)
    values ('00000000-0000-4000-8000-00000000a000', 'ccc-cccc-ccc', now(), now(), 0, 0, 4);
  if (select count(*) from public.meeting_reports) <> 1 then raise exception 'ГРЕШКА: продавач 2 вижда срещи на продавач 1.'; end if;
  update public.meeting_reports set score = 1 where meeting_code = 'aaa-aaaa-aaa';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'ГРЕШКА: продавач 2 промени среща на продавач 1.'; end if;
  delete from public.meeting_reports where meeting_code = 'aaa-aaaa-aaa';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'ГРЕШКА: продавач 2 изтри среща на продавач 1.'; end if;
end $$;

-- 3. Собственикът на А вижда и двете срещи, с непроменената оценка.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.meeting_reports) <> 2 then raise exception 'ГРЕШКА: собственикът на А не вижда всички срещи.'; end if;
  if (select score from public.meeting_reports where meeting_code = 'aaa-aaaa-aaa') <> 8 then raise exception 'ГРЕШКА: оценката е променена.'; end if;
end $$;

-- 4. Собственикът на Б не вижда нищо от А.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.meeting_reports) <> 0 then raise exception 'ГРЕШКА: фирма Б вижда срещите на фирма А.'; end if;
end $$;

-- 5. Без вход: нищо.
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform 1 from public.meeting_reports;
  raise exception 'ГРЕШКА: без вход се четат срещи.';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;

select 'ДНЕВНИКЪТ Е ЗАЩИТЕН' as "резултат";
