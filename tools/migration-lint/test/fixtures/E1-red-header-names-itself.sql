-- contract: expanded in 20260102000000_E1-red-header-names-itself.sql
set lock_timeout = '5s';
alter table accounts drop column note;
