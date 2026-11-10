set lock_timeout = '5s';
alter table accounts add column ref uuid default gen_random_uuid();
