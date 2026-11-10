-- no-transaction
set lock_timeout = '5s';
create index concurrently if not exists accounts_email on accounts (email);
