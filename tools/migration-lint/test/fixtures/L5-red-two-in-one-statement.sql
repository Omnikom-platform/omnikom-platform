set lock_timeout = '5s';
alter table accounts add column a uuid default gen_random_uuid(), add column b float default random();
