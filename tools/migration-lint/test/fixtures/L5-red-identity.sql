set lock_timeout = '5s';
alter table accounts add column seq int generated always as identity;
