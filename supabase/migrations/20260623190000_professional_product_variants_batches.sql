-- ERP profissional: cadastro mestre separado de variantes e rastreabilidade por lote.

alter table public.products
  add column if not exists has_variants boolean not null default false,
  add column if not exists track_lots boolean not null default false,
  add column if not exists track_expiry boolean not null default false;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  code text not null,
  barcode text,
  sku text,
  color text,
  size text,
  label text not null,
  current_stock integer not null default 0 check (current_stock >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  maximum_stock integer not null default 0 check (maximum_stock >= 0),
  current_cost numeric(10,2) not null default 0 check (current_cost >= 0),
  selling_price numeric(10,2) not null default 0 check (selling_price >= 0),
  physical_location text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, code)
);

create unique index if not exists idx_product_variants_barcode
  on public.product_variants(barcode) where barcode is not null;
create unique index if not exists idx_product_variants_sku
  on public.product_variants(sku) where sku is not null;
create index if not exists idx_product_variants_product
  on public.product_variants(product_id, active, sort_order);

alter table public.receiving_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete restrict,
  add column if not exists lot_number text,
  add column if not exists manufacturing_date date,
  add column if not exists expiry_date date;

alter table public.inventory_transactions
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists batch_id uuid;

alter table public.sale_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete restrict,
  add column if not exists batch_id uuid;

create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete restrict,
  receiving_item_id uuid references public.receiving_items(id) on delete set null,
  lot_number text,
  manufacturing_date date,
  expiry_date date,
  received_quantity integer not null check (received_quantity > 0),
  available_quantity integer not null check (available_quantity >= 0),
  unit_cost numeric(10,2) not null default 0 check (unit_cost >= 0),
  status text not null default 'active'
    check (status in ('active', 'depleted', 'expired', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or manufacturing_date is null or expiry_date >= manufacturing_date)
);

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_batch_id_fkey;
alter table public.inventory_transactions
  add constraint inventory_transactions_batch_id_fkey
  foreign key (batch_id) references public.stock_batches(id) on delete set null;

alter table public.sale_items
  drop constraint if exists sale_items_batch_id_fkey;
alter table public.sale_items
  add constraint sale_items_batch_id_fkey
  foreign key (batch_id) references public.stock_batches(id) on delete set null;

create index if not exists idx_stock_batches_product_expiry
  on public.stock_batches(product_id, variant_id, expiry_date, status);
create index if not exists idx_receiving_items_variant
  on public.receiving_items(receiving_id, product_id, variant_id);

-- Converte variantes antigas que eram gravadas indevidamente como produtos.
insert into public.product_variants (
  id, product_id, code, barcode, sku, color, size, label,
  current_stock, minimum_stock, maximum_stock, current_cost, selling_price,
  physical_location, active, sort_order, created_at, updated_at
)
select
  child.id,
  child.parent_product_id,
  coalesce(child.barcode, child.sku, child.internal_code, child.id::text),
  child.barcode,
  child.sku,
  child.variant_color,
  child.variant_size,
  coalesce(child.variant_label, concat_ws(' / ', child.variant_color, child.variant_size), child.name),
  greatest(child.current_stock, 0),
  greatest(child.minimum_stock, 0),
  greatest(child.maximum_stock, 0),
  greatest(child.current_cost, 0),
  greatest(child.selling_price, 0),
  child.physical_location,
  child.active,
  row_number() over (partition by child.parent_product_id order by child.created_at, child.id),
  child.created_at,
  child.updated_at
from public.products child
where child.parent_product_id is not null
on conflict (id) do nothing;

update public.receiving_items item
set variant_id = item.product_id,
    product_id = child.parent_product_id
from public.products child
where child.id = item.product_id
  and child.parent_product_id is not null;

update public.inventory_transactions movement
set variant_id = movement.product_id,
    product_id = child.parent_product_id
from public.products child
where child.id = movement.product_id
  and child.parent_product_id is not null;

update public.sale_items item
set variant_id = item.product_id,
    product_id = child.parent_product_id
from public.products child
where child.id = item.product_id
  and child.parent_product_id is not null;

update public.products parent
set has_variants = true,
    current_stock = coalesce((
      select sum(variant.current_stock)
      from public.product_variants variant
      where variant.product_id = parent.id
    ), parent.current_stock)
where exists (
  select 1 from public.product_variants variant where variant.product_id = parent.id
);

delete from public.products where parent_product_id is not null;

create or replace function public.sync_product_variant_stock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product_id uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products
  set current_stock = coalesce((
        select sum(current_stock)
        from public.product_variants
        where product_id = v_product_id and active = true
      ), 0),
      has_variants = exists (
        select 1 from public.product_variants where product_id = v_product_id
      ),
      updated_at = now()
  where id = v_product_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_product_variant_stock on public.product_variants;
drop trigger if exists trg_sync_product_variant_stock_write on public.product_variants;
drop trigger if exists trg_sync_product_variant_stock_update on public.product_variants;
create trigger trg_sync_product_variant_stock_write
after insert or delete on public.product_variants
for each row execute function public.sync_product_variant_stock();
create trigger trg_sync_product_variant_stock_update
after update of current_stock, active on public.product_variants
for each row execute function public.sync_product_variant_stock();

alter table public.product_variants enable row level security;
alter table public.stock_batches enable row level security;

drop policy if exists product_variants_staff_all on public.product_variants;
create policy product_variants_staff_all on public.product_variants
for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists stock_batches_staff_all on public.stock_batches;
create policy stock_batches_staff_all on public.stock_batches
for all to authenticated using (is_staff()) with check (is_staff());

notify pgrst, 'reload schema';
