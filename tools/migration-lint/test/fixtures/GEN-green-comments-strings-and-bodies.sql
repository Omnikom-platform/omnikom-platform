-- alter table accounts drop column note;
/* create index on accounts (n); /* nested */ drop table orders; */
insert into orders (id, account_id) values (gen_random_uuid(), null);
select 'alter table accounts drop column note; create index on accounts (n)';
select E'it\'s a string; drop table orders';
select $q$ lock table accounts; $q$;
create or replace function f() returns void language plpgsql as $$ begin alter table accounts drop column note; create index on accounts (n); end $$;
create view v as select 1 as "drop table orders";
