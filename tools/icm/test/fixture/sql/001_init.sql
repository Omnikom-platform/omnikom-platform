-- create table ghost (a comment, must not be read)
create or replace function public.do_it() returns int language sql as $$ select 1 $$;
CREATE TABLE IF NOT EXISTS public.leads (id int);
create table "public"."quoted" (id int);
