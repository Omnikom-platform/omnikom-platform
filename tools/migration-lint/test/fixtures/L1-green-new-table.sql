create table notes (id uuid primary key, body text);
create index notes_body on notes (body);
