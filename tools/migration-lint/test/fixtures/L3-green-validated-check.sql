set lock_timeout = '5s';
alter table accounts add constraint accounts_email_nn check (email is not null) not valid;
alter table accounts validate constraint accounts_email_nn;
alter table accounts alter column email set not null;
