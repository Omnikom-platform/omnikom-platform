create trigger accounts_touch before insert on accounts for each row execute function accounts_touch();
