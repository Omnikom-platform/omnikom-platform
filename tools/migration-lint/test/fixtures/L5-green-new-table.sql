create table notes (id uuid primary key);
alter table notes add column ref uuid default gen_random_uuid();
