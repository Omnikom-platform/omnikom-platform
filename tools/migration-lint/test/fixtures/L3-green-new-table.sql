create table notes (id uuid primary key, body text);
alter table notes alter column body set not null;
