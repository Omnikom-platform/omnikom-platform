set lock_timeout = '5s';
do $$ begin
  create index accounts_n on accounts (n);
end $$;
