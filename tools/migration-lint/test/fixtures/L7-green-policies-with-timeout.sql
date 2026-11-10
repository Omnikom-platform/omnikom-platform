set lock_timeout = '5s';
create policy accounts_read on accounts for select using (true);
alter policy accounts_read on accounts using (n > 0);
drop policy if exists accounts_read on accounts;
