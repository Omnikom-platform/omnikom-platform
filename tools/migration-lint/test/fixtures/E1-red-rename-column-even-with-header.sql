-- contract: expanded in 20260101000001_base.sql
set lock_timeout = '5s';
alter table accounts rename column note to memo;
