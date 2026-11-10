-- fixture base: two tables that exist before the case runs
create table accounts (id uuid primary key, email text, n int, note text, created_at timestamptz);
create table orders (id uuid primary key, account_id uuid, total int);
