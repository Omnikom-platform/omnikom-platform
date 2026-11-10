create table notes (id uuid primary key);
alter table notes enable row level security;
create policy notes_read on notes for select using (true);
