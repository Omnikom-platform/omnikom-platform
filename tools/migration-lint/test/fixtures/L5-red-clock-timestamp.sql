set lock_timeout = '5s';
alter table accounts add column seen timestamptz default clock_timestamp();
