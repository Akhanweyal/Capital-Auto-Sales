-- ============================================================
-- Capital Auto Sales — database setup
-- Paste this whole file into Supabase -> SQL Editor -> Run.
-- Safe to run once on a brand new project.
-- ============================================================

-- ---------- inventory ----------
create table if not exists public.cars (
  id          uuid primary key default gen_random_uuid(),
  year        int          not null,
  make        text         not null,
  model       text         not null,
  trim        text         default '',
  price       numeric      not null default 0,
  mileage     int          not null default 0,
  condition   text         not null default 'Good',
  description text         default '',
  vin         text         default '',
  published   boolean      not null default false,
  sold        boolean      not null default false,
  pending     boolean      not null default false,
  featured    boolean      not null default false,
  cover_url   text         default '',
  photos      jsonb        not null default '[]'::jsonb,
  created_at  timestamptz  not null default now()
);

-- ---------- customer requests ----------
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  phone      text        not null,
  note       text        default '',
  car_id     uuid        references public.cars (id) on delete set null,
  car_label  text        default '',
  price      numeric     default 0,
  handled    boolean     not null default false,
  created_at timestamptz not null default now()
);

-- ---------- what each car cost you (never public) ----------
create table if not exists public.car_costs (
  car_id     uuid        primary key references public.cars (id) on delete cascade,
  cost       numeric     not null default 0,
  expenses   jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- buyer's orders / sales records (never public) ----------
create table if not exists public.sales (
  id           uuid primary key default gen_random_uuid(),
  car_id       uuid references public.cars (id) on delete set null,
  sale_date    date        not null default current_date,
  stock_number text        default '',

  vehicle       jsonb not null default '{}'::jsonb,
  buyer         jsonb not null default '{}'::jsonb,
  co_buyer_name text  default '',
  trade_in      jsonb not null default '{}'::jsonb,
  insurance     jsonb not null default '{}'::jsonb,
  lien_holder   jsonb not null default '{}'::jsonb,
  remarks       text  default '',
  salesperson   text  default '',

  vehicle_price         numeric not null default 0,
  processing_fee        numeric not null default 0,
  gross_trade_allowance numeric not null default 0,
  trade_payoff          numeric not null default 0,
  sales_tax             numeric not null default 0,
  license_fee           numeric not null default 0,
  title_fee             numeric not null default 0,
  registration_fee      numeric not null default 0,
  highway_use_fee       numeric not null default 0,
  dealer_biz_tax        numeric not null default 0,
  online_filing_fee     numeric not null default 0,
  other_charges         jsonb   not null default '[]'::jsonb,
  deposit               numeric not null default 0,
  down_payment          numeric not null default 0,
  payment_type          text    not null default 'cash',

  car_cost     numeric not null default 0,
  car_expenses jsonb   not null default '[]'::jsonb,

  finalized  boolean     not null default false,
  created_at timestamptz not null default now()
);

alter table public.cars       enable row level security;
alter table public.leads      enable row level security;
alter table public.car_costs  enable row level security;
alter table public.sales      enable row level security;

-- ---------- who can do what ----------
-- Anyone (a visitor) can read cars you have published.
drop policy if exists "public reads published cars" on public.cars;
create policy "public reads published cars"
  on public.cars for select
  to anon
  using (published = true);

-- You, signed in, can read and change everything.
drop policy if exists "dealer manages cars" on public.cars;
create policy "dealer manages cars"
  on public.cars for all
  to authenticated
  using (true) with check (true);

-- Anyone can send you a request, but only you can read them.
drop policy if exists "public creates leads" on public.leads;
create policy "public creates leads"
  on public.leads for insert
  to anon
  with check (true);

drop policy if exists "dealer manages leads" on public.leads;
create policy "dealer manages leads"
  on public.leads for all
  to authenticated
  using (true) with check (true);

-- Only you can ever see what a car cost you or read a sale record —
-- no policy at all for anon means the public API always gets nothing back.
drop policy if exists "dealer manages car costs" on public.car_costs;
create policy "dealer manages car costs"
  on public.car_costs for all
  to authenticated
  using (true) with check (true);

drop policy if exists "dealer manages sales" on public.sales;
create policy "dealer manages sales"
  on public.sales for all
  to authenticated
  using (true) with check (true);

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public)
values ('car-photos', 'car-photos', true)
on conflict (id) do nothing;

drop policy if exists "public views car photos" on storage.objects;
create policy "public views car photos"
  on storage.objects for select
  to anon
  using (bucket_id = 'car-photos');

drop policy if exists "dealer uploads car photos" on storage.objects;
create policy "dealer uploads car photos"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'car-photos') with check (bucket_id = 'car-photos');
