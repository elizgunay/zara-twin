-- Тестовите срещи (бутон „Тест“ в панела) също се записват, но с етикет, за да се виждат
-- отделно от истинските в таблото. Изпълнява се веднъж в Supabase → SQL Editor, след 0002.

alter table public.meeting_reports
  add column if not exists is_test boolean not null default false;
