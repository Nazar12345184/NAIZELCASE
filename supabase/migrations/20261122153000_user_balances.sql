create table if not exists public.user_balances (
    user_id uuid primary key references auth.users (id) on delete cascade,
    balance numeric(12, 2) not null default 0.00
        check (balance >= 0)
);

alter table public.user_balances enable row level security;

revoke all on table public.user_balances from anon, authenticated;
grant select on table public.user_balances to authenticated;
grant all on table public.user_balances to service_role;

create policy "Users can view their own balance"
    on public.user_balances
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

insert into public.user_balances (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_user_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.user_balances (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_balance on auth.users;
create trigger on_auth_user_created_balance
    after insert on auth.users
    for each row execute function public.create_user_balance();
