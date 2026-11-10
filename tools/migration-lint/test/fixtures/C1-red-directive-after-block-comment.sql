/* a block comment first: the applier reads only the leading -- lines, so the directive below is not seen */
-- no-transaction
set lock_timeout = '5s';
create index concurrently accounts_email on accounts (email);
