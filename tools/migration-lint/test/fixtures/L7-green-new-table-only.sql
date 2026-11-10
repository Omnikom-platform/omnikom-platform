create table notes (id uuid primary key, body text);
alter table notes add column extra text;
insert into accounts (id) values (gen_random_uuid());
