create table if not exists public.steam_accounts (
    steam_id text primary key check (steam_id ~ '^[0-9]{17}$'),
    user_id uuid not null unique references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

create table if not exists public.steam_auth_states (
    state text primary key,
    flow text not null check (flow in ('login', 'link')),
    user_id uuid references auth.users (id) on delete cascade,
    site_origin text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    check ((flow = 'link' and user_id is not null) or (flow = 'login' and user_id is null))
);

alter table public.steam_accounts enable row level security;
alter table public.steam_auth_states enable row level security;

revoke all on table public.steam_accounts from anon, authenticated;
revoke all on table public.steam_auth_states from anon, authenticated;
grant all on table public.steam_accounts to service_role;
grant all on table public.steam_auth_states to service_role;
