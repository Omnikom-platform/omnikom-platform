set lock_timeout = '5s';
alter table accounts add constraint accounts_n_pos check (n > 0);
