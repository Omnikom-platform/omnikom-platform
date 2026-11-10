-- contract: expanded in 20260101000009_nothing.sql
set lock_timeout = '5s';
alter table accounts drop column note;
