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

-- ---------- lifecycle stage + warranty disclosure + inspection, added to
-- the already-existing cars/sales tables. Uses ALTER ... ADD COLUMN IF NOT
-- EXISTS rather than the CREATE TABLE blocks above, since those only run on
-- a brand-new table and this dealer's cars/sales tables already exist.
--
-- stage tracks the pre-listing workflow (buy -> recon -> ready -> listed);
-- published/pending/sold keep driving "is this for sale / sold" exactly as
-- they already did, nothing about that changes.
alter table public.cars add column if not exists stage text not null default 'intake';
-- 'intake' | 'recon' | 'ready' | 'listed' (kept in sync with published) | 'sold' (kept in sync)

-- Virginia law requires every vehicle be safety-inspected between intake and
-- retail sale, with a written disclosure to the buyer if it wasn't. This is
-- what gates a car out of 'recon' into 'ready'.
alter table public.cars add column if not exists safety_inspected      boolean not null default false;
alter table public.cars add column if not exists safety_inspected_date date;

-- Warranty terms disclosed while the car is listed (what the printed Buyer's
-- Guide on the vehicle says) — copied onto the sale record at time of sale
-- so historical sales keep the terms that actually applied, even if the
-- car's own listing terms are later changed for the next buyer.
alter table public.cars add column if not exists warranty_type        text    not null default 'as_is';
-- 'as_is' | 'dealer_full' | 'dealer_limited' | 'implied_only'
alter table public.cars add column if not exists warranty_systems     text    default '';
alter table public.cars add column if not exists warranty_duration    text    default '';
alter table public.cars add column if not exists warranty_pct_labor   numeric default 0;
alter table public.cars add column if not exists warranty_pct_parts   numeric default 0;

alter table public.sales add column if not exists warranty_type              text    not null default 'as_is';
alter table public.sales add column if not exists warranty_systems           text    default '';
alter table public.sales add column if not exists warranty_duration         text    default '';
alter table public.sales add column if not exists warranty_pct_labor        numeric default 0;
alter table public.sales add column if not exists warranty_pct_parts        numeric default 0;
-- MVDB-44 (rev. 2012) lists this as a required line item, from when VA let
-- a driver pay $500 at registration instead of carrying insurance. That
-- option was repealed effective July 1, 2024 — insurance is now mandatory,
-- so this no longer applies to a normal sale. Column kept (always 0, no
-- longer shown in the UI or printed order) rather than dropped, in case a
-- historical record ever needs it.
alter table public.sales add column if not exists uninsured_motor_vehicle_fee numeric not null default 0;
-- Code of Virginia requires the Buyer's Guide be signed/dated by the buyer
-- and incorporated into the buyer's order — this tracks that the signed
-- paper copy has actually been collected, not just printed.
alter table public.sales add column if not exists buyers_guide_signed       boolean not null default false;

-- ---------- compliance documents: bill of sale, title, repair receipts,
-- buyer's orders, condition reports — whatever a dealer-board inquiry might
-- ask for. car_id/sale_id are "on delete set null" (not cascade) and vin/
-- vehicle are captured at upload time, so a record stays identifiable and
-- retrievable even if the car listing itself is later deleted.
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid references public.cars (id) on delete set null,
  sale_id     uuid references public.sales (id) on delete set null,
  category    text        not null default 'other', -- 'intake' | 'repair' | 'sale' | 'other'
  label       text        default '',
  vin         text        default '',
  vehicle     text        default '',
  file_name   text        default '',
  path        text        not null,
  uploaded_by text        default '',
  created_at  timestamptz not null default now()
);

create index if not exists documents_car_id_idx   on public.documents (car_id);
create index if not exists documents_sale_id_idx  on public.documents (sale_id);
create index if not exists documents_category_idx on public.documents (category);
create index if not exists documents_vin_idx      on public.documents (vin);

alter table public.cars       enable row level security;
alter table public.leads      enable row level security;
alter table public.car_costs  enable row level security;
alter table public.sales      enable row level security;
alter table public.documents  enable row level security;

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

-- Compliance documents are never public — same "no anon policy at all" rule
-- as car_costs/sales above. Deliberately no DELETE policy at all (and no
-- UPDATE either, so a row can't be edited after the fact): once a document
-- is on file, it stays on file for a dealer-board inquiry. Insert/select
-- only.
drop policy if exists "dealer manages documents" on public.documents;
drop policy if exists "dealer reads documents" on public.documents;
drop policy if exists "dealer adds documents" on public.documents;
create policy "dealer reads documents"
  on public.documents for select
  to authenticated
  using (true);
create policy "dealer adds documents"
  on public.documents for insert
  to authenticated
  with check (true);

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

-- ---------- compliance document storage (private — unlike car-photos, this
-- bucket is never public; documents can hold buyer names, signatures, and
-- other info that has no business being world-readable) ----------
insert into storage.buckets (id, name, public)
values ('car-documents', 'car-documents', false)
on conflict (id) do nothing;

-- Same immutability rule as the documents table: select/insert only, no
-- delete or overwrite once a file is uploaded.
drop policy if exists "dealer manages document storage" on storage.objects;
drop policy if exists "dealer reads document storage" on storage.objects;
drop policy if exists "dealer adds document storage" on storage.objects;
create policy "dealer reads document storage"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'car-documents');
create policy "dealer adds document storage"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'car-documents');
