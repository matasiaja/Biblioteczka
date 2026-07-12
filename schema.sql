-- ============================================
-- Biblioteczka — katalog książek/filmów/muzyki + wypożyczenia
-- Uruchom to w Supabase SQL Editor po utworzeniu projektu
-- ============================================

create extension if not exists "pgcrypto";

create table items (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  type text not null check (type in ('book','movie','music')),
  title text not null,
  creator text,              -- autor / reżyser / artysta
  format text,                -- np. papierowa/twarda, Blu-ray, DVD, CD, winyl
  year integer,
  cover_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index items_barcode_idx on items(barcode);
create index items_type_idx on items(type);

-- Historia i aktualny stan wypożyczeń
create table loans (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  borrower_name text not null,
  borrowed_at timestamptz not null default now(),
  returned_at timestamptz
);

create index loans_item_idx on loans(item_id);
create index loans_active_idx on loans(item_id) where returned_at is null;
-- tylko jedno aktywne wypożyczenie na przedmiot naraz
create unique index loans_one_active_uidx on loans(item_id) where returned_at is null;

-- ============================================
-- RLS — dostęp tylko dla zalogowanych (Ty)
-- ============================================
alter table items enable row level security;
alter table loans enable row level security;

create policy "auth_full_access" on items for all
  to authenticated using (true) with check (true);

create policy "auth_full_access" on loans for all
  to authenticated using (true) with check (true);

-- ============================================
-- Auto-update updated_at
-- ============================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_items_updated_at
  before update on items
  for each row execute function set_updated_at();
