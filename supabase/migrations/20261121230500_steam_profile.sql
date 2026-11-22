alter table public.steam_accounts
    add column if not exists persona_name text,
    add column if not exists avatar_url text;
