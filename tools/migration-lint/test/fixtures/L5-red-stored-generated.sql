set lock_timeout = '5s';
alter table accounts add column n2 int generated always as (n + 1) stored;
