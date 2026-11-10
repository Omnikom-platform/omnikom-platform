-- no-transaction
set lock_timeout = '5s';
set statement_timeout = '0';
create index concurrently accounts_email on accounts (email);
