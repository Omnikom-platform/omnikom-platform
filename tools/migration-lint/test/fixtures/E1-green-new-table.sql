create table notes (id uuid primary key, body text);
alter table notes drop column body;
drop table notes;
