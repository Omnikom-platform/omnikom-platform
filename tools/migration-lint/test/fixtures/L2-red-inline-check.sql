set lock_timeout = '5s';
alter table accounts add column age int check (age >= 0);
