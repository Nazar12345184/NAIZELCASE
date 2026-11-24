create table if not exists public.balance_topups (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    invoice_id text unique,
    amount numeric(12, 2) not null check (amount > 0),
    status text not null default 'created'
        check (status in ('created', 'processing', 'finalized', 'failed', 'expired')),
    provider_status text,
    page_url text,
    created_at timestamptz not null default now(),
    finalized_at timestamptz
);

alter table public.balance_topups
    add column if not exists provider_status text;

alter table public.balance_topups enable row level security;

revoke all on table public.balance_topups from anon, authenticated;
grant select on table public.balance_topups to authenticated;
grant all on table public.balance_topups to service_role;

create policy "Users can view their own topups"
    on public.balance_topups
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create or replace function public.finalize_balance_topup(p_invoice_id text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_topup public.balance_topups%rowtype;
    v_balance numeric;
begin
    select *
    into v_topup
    from public.balance_topups
    where invoice_id = p_invoice_id
    for update;

    if not found then
        raise exception 'Top-up invoice not found';
    end if;

    if v_topup.status = 'finalized' then
        select balance into v_balance
        from public.user_balances
        where user_id = v_topup.user_id;
        return coalesce(v_balance, 0);
    end if;

    update public.balance_topups
    set status = 'finalized',
        provider_status = 'approved',
        finalized_at = now()
    where id = v_topup.id;

    insert into public.user_balances (user_id, balance)
    values (v_topup.user_id, v_topup.amount)
    on conflict (user_id) do update
    set balance = public.user_balances.balance + excluded.balance;

    select balance into v_balance
    from public.user_balances
    where user_id = v_topup.user_id;

    return v_balance;
end;
$$;

revoke all on function public.finalize_balance_topup(text) from public, anon, authenticated;
grant execute on function public.finalize_balance_topup(text) to service_role;
