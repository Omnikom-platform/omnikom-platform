create table notes (id uuid primary key, n int);
alter table notes add constraint notes_n_pos check (n > 0);
