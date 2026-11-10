set lock_timeout = '5s';
alter table accounts add constraint accounts_email_key unique (email);
