set lock_timeout = '5s';
alter table accounts add column seen timestamptz not null default now(), add column flag boolean not null default false, add column kind text default 'x';
