-- ============================================================
-- Mechanic role — a login that can work on repair tickets and nothing else.
-- Paste into Supabase -> SQL Editor -> Run. Safe to run more than once.
--
-- Roles after this:
--   admin     everything, plus the Team screen
--   partner   everything except the Team screen (unchanged)
--   mechanic  repair tickets only: can see and edit tickets (cannot delete),
--             can look at the car list and shop names to fill a ticket in.
--             Cannot see sales, customers' requests, costs, documents,
--             test drives, shop money or reports.
--
-- This is enforced by the database itself (row level security), not just by
-- hiding buttons, so it holds even if someone pokes at the site directly.
-- ============================================================

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'partner')
  );
$$;

create or replace function public.is_mechanic()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'mechanic'
  );
$$;

-- Everything that used to be "any signed-in user" becomes "admin or partner".
drop policy if exists "dealer manages cars" on public.cars;
create policy "dealer manages cars" on public.cars for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- A mechanic may look at the car list (to pick the car a ticket is for) — read only.
drop policy if exists "mechanic reads cars" on public.cars;
create policy "mechanic reads cars" on public.cars for select to authenticated
  using (public.is_mechanic());

drop policy if exists "dealer manages leads" on public.leads;
create policy "dealer manages leads" on public.leads for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "dealer manages car costs" on public.car_costs;
create policy "dealer manages car costs" on public.car_costs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "dealer manages sales" on public.sales;
create policy "dealer manages sales" on public.sales for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "dealer reads documents" on public.documents;
create policy "dealer reads documents" on public.documents for select to authenticated
  using (public.is_staff());
drop policy if exists "dealer adds documents" on public.documents;
create policy "dealer adds documents" on public.documents for insert to authenticated
  with check (public.is_staff());

drop policy if exists "dealer reads test drives" on public.test_drives;
create policy "dealer reads test drives" on public.test_drives for select to authenticated
  using (public.is_staff());
drop policy if exists "dealer logs test drives" on public.test_drives;
create policy "dealer logs test drives" on public.test_drives for insert to authenticated
  with check (public.is_staff());
drop policy if exists "dealer updates test drives" on public.test_drives;
create policy "dealer updates test drives" on public.test_drives for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- File storage: photos and private documents.
drop policy if exists "dealer uploads car photos" on storage.objects;
create policy "dealer uploads car photos" on storage.objects for all to authenticated
  using (bucket_id = 'car-photos' and public.is_staff())
  with check (bucket_id = 'car-photos' and public.is_staff());
drop policy if exists "dealer reads document storage" on storage.objects;
create policy "dealer reads document storage" on storage.objects for select to authenticated
  using (bucket_id = 'car-documents' and public.is_staff());
drop policy if exists "dealer adds document storage" on storage.objects;
create policy "dealer adds document storage" on storage.objects for insert to authenticated
  with check (bucket_id = 'car-documents' and public.is_staff());

-- Repair shops.
-- Tickets: staff can do everything; a mechanic can see, add and edit (never delete).
drop policy if exists "dealer manages shop tickets" on public.shop_tickets;
create policy "dealer manages shop tickets" on public.shop_tickets for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "mechanic reads shop tickets" on public.shop_tickets;
create policy "mechanic reads shop tickets" on public.shop_tickets for select to authenticated
  using (public.is_mechanic());
drop policy if exists "mechanic adds shop tickets" on public.shop_tickets;
create policy "mechanic adds shop tickets" on public.shop_tickets for insert to authenticated
  with check (public.is_mechanic());
drop policy if exists "mechanic edits shop tickets" on public.shop_tickets;
create policy "mechanic edits shop tickets" on public.shop_tickets for update to authenticated
  using (public.is_mechanic()) with check (public.is_mechanic());

-- Shop money: staff only.
drop policy if exists "dealer manages shop ledger" on public.shop_ledger;
create policy "dealer manages shop ledger" on public.shop_ledger for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Shop setup (shop names, labor split): staff write; a mechanic may read it
-- because the ticket form needs the shop names.
drop policy if exists "dealer manages shop settings" on public.shop_settings;
create policy "dealer manages shop settings" on public.shop_settings for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "mechanic reads shop settings" on public.shop_settings;
create policy "mechanic reads shop settings" on public.shop_settings for select to authenticated
  using (public.is_mechanic());
