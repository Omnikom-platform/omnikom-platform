-- no-transaction
set lock_timeout = '5s';
create index concurrently accounts_email on accounts (email);
drop index concurrently if exists accounts_old;
vacuum accounts;
