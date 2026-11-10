create table if not exists public.things (id uuid primary key, n int);
create index things_n on public.things (n);
alter table public.things add constraint things_n_pos check (n > 0);
alter table things alter column n set not null;
