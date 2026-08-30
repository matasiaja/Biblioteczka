-- ============================================
-- Biblioteczka — katalog książek/filmów/muzyki + wypożyczenia
-- Uruchom to w Supabase SQL Editor po utworzeniu projektu
-- ============================================

create extension if not exists "pgcrypto";

create table items (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  index_number text,          -- numer "Indeks" drukowany na polskich książkach obok kodu kreskowego
  type text not null check (type in ('book','movie','music','videogame','boardgame')),
  title text not null,
  creator text,              -- autor / reżyser / artysta
  publisher text,             -- wydawnictwo (tylko książki)
  format text,                -- np. papierowa/twarda, Blu-ray, DVD, CD, winyl
  year integer,
  cover_url text,
  notes text,             -- "Opis" w UI (opis pozycji, np. streszczenie/fabuła)
  personal_notes text,     -- "Notatki" w UI (prywatne notatki użytkownika)
  rating integer check (rating between 1 and 5),
  status text not null default 'owned' check (status in ('owned','wishlist')), -- 'wishlist' = chcę kupić, jeszcze nie mam
  watched boolean not null default false, -- obejrzane/przeczytane/odsłuchane
  queue_position integer, -- pozycja w kolejce "co dalej" (null = nie w kolejce)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index items_barcode_idx on items(barcode);
create index items_type_idx on items(type);
create index items_status_idx on items(status);
create index items_watched_idx on items(watched);

-- Historia i aktualny stan wypożyczeń
-- direction 'out' = ja pożyczam ten przedmiot komuś (mój, ktoś go ma)
-- direction 'in'  = ktoś pożyczył mi ten przedmiot (nie mój, ja go mam)
create table loans (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  borrower_name text not null,
  direction text not null default 'out' check (direction in ('out','in')),
  borrowed_at timestamptz not null default now(),
  returned_at timestamptz
);

create index loans_item_idx on loans(item_id);
create index loans_active_idx on loans(item_id) where returned_at is null;
-- tylko jedno aktywne wypożyczenie na przedmiot naraz
create unique index loans_one_active_uidx on loans(item_id) where returned_at is null;

-- Ustawienia appki (jeden wiersz) — m.in. publiczne udostępnianie kolekcji (tylko odczyt)
create table app_settings (
  id integer primary key default 1,
  share_enabled boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ============================================
-- RLS — dostęp tylko dla zalogowanych (Ty)
-- ============================================
alter table items enable row level security;
alter table loans enable row level security;
alter table app_settings enable row level security;

create policy "auth_full_access" on items for all
  to authenticated using (true) with check (true);

create policy "auth_full_access" on loans for all
  to authenticated using (true) with check (true);

create policy "auth_full_access" on app_settings for all
  to authenticated using (true) with check (true);

-- Publiczny, tylko-do-odczytu dostęp do kolekcji przez link współdzielenia — bez tabel
-- udostępnianych bezpośrednio anonimom: ta funkcja (SECURITY DEFINER) sama sprawdza,
-- czy udostępnianie jest włączone i czy podany token się zgadza, zanim cokolwiek zwróci.
-- Zwraca kolekcję I listę życzeń (status, queue_position) — celowo NIE zwraca barcode,
-- index_number, publisher, personal_notes ani nic o wypożyczeniach (dane innej osoby).
create or replace function get_shared_collection(token uuid)
returns table (
  id uuid,
  title text,
  type text,
  creator text,
  format text,
  year integer,
  cover_url text,
  notes text,
  rating integer,
  watched boolean,
  status text,
  queue_position integer
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.title, i.type, i.creator, i.format, i.year, i.cover_url, i.notes, i.rating, i.watched, i.status, i.queue_position
  from items i
  where exists (
    select 1 from app_settings s
    where s.share_enabled = true and s.share_token = token
  )
  order by i.title;
$$;

grant execute on function get_shared_collection(uuid) to anon;

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

-- ============================================
-- Storage — ręcznie wgrywane okładki (zdjęcia z telefonu)
-- ============================================
insert into storage.buckets (id, name, public) values ('covers', 'covers', true) on conflict (id) do nothing;

create policy "Public read covers" on storage.objects for select using (bucket_id = 'covers');
create policy "Authenticated upload covers" on storage.objects for insert to authenticated with check (bucket_id = 'covers');
create policy "Authenticated update covers" on storage.objects for update to authenticated using (bucket_id = 'covers');
create policy "Authenticated delete covers" on storage.objects for delete to authenticated using (bucket_id = 'covers');

-- ============================================
-- MIGRACJA: lista życzeń (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje —
-- powyższy `create table items` już zawiera tę kolumnę dla nowych instalacji)
-- ============================================
alter table items add column if not exists status text not null default 'owned' check (status in ('owned','wishlist'));
create index if not exists items_status_idx on items(status);

-- ============================================
-- MIGRACJA: "do obejrzenia" (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje)
-- ============================================
alter table items add column if not exists watched boolean not null default false;
create index if not exists items_watched_idx on items(watched);

-- ============================================
-- MIGRACJA: osobne pole "Notatki" obok "Opisu" (uruchom ręcznie w SQL Editorze,
-- jeśli baza już istnieje — istniejąca kolumna `notes` zostaje jako "Opis")
-- ============================================
alter table items add column if not exists personal_notes text;

-- ============================================
-- MIGRACJA: publiczne udostępnianie kolekcji (uruchom ręcznie w SQL Editorze,
-- jeśli baza już istnieje — patrz sekcje wyżej dla nowych instalacji)
-- ============================================
create table if not exists app_settings (
  id integer primary key default 1,
  share_enabled boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;

drop policy if exists "auth_full_access" on app_settings;
create policy "auth_full_access" on app_settings for all
  to authenticated using (true) with check (true);

create or replace function get_shared_collection(token uuid)
returns table (
  id uuid,
  title text,
  type text,
  creator text,
  format text,
  year integer,
  cover_url text,
  notes text,
  rating integer,
  watched boolean
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.title, i.type, i.creator, i.format, i.year, i.cover_url, i.notes, i.rating, i.watched
  from items i
  where i.status = 'owned'
    and exists (
      select 1 from app_settings s
      where s.share_enabled = true and s.share_token = token
    )
  order by i.title;
$$;

grant execute on function get_shared_collection(uuid) to anon;

-- ============================================
-- MIGRACJA: kolejka "co dalej" (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje)
-- ============================================
alter table items add column if not exists queue_position integer;

-- ============================================
-- MIGRACJA: rozszerzenie publicznego demo o listę życzeń, kolejkę i status
-- (uruchom ręcznie w SQL Editorze, jeśli wcześniej uruchamiałeś/aś starszą wersję
-- get_shared_collection() — Postgres nie pozwala zmienić kolumn zwracanych przez
-- CREATE OR REPLACE, więc trzeba najpierw usunąć starą wersję funkcji)
-- ============================================
drop function if exists get_shared_collection(uuid);

create function get_shared_collection(token uuid)
returns table (
  id uuid,
  title text,
  type text,
  creator text,
  format text,
  year integer,
  cover_url text,
  notes text,
  rating integer,
  watched boolean,
  status text,
  queue_position integer
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.title, i.type, i.creator, i.format, i.year, i.cover_url, i.notes, i.rating, i.watched, i.status, i.queue_position
  from items i
  where exists (
    select 1 from app_settings s
    where s.share_enabled = true and s.share_token = token
  )
  order by i.title;
$$;

grant execute on function get_shared_collection(uuid) to anon;

-- ============================================
-- MIGRACJA: ręczna kolejność na liście "Do obejrzenia/przeczytania/odsłuchania"
-- (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje)
-- ============================================
alter table items add column if not exists to_consume_position integer;

-- ============================================
-- MIGRACJA: cache wyników skanowania kodu kreskowego (uruchom ręcznie w SQL Editorze,
-- jeśli baza już istnieje)
-- Zapisuje udany wynik rozpoznania kodu (UPCitemdb/OMDb/MusicBrainz/Discogs), żeby ponowne
-- zeskanowanie tego samego kodu (np. po usunięciu i ponownym dodaniu pozycji) nie zużywało
-- kolejnego zapytania z dziennego limitu UPCitemdb (~100/dzień, bez klucza).
-- ============================================
create table if not exists barcode_lookup_cache (
  barcode text primary key,
  guess jsonb not null,
  created_at timestamptz not null default now()
);

alter table barcode_lookup_cache enable row level security;

drop policy if exists "auth_full_access" on barcode_lookup_cache;
create policy "auth_full_access" on barcode_lookup_cache for all
  to authenticated using (true) with check (true);

-- ============================================
-- MIGRACJA: nowe rodzaje pozycji — gry wideo i gry planszowe (uruchom ręcznie
-- w SQL Editorze, jeśli baza już istnieje — powyższy `create table items` już
-- zawiera te wartości dla nowych instalacji)
-- ============================================
alter table items drop constraint if exists items_type_check;
alter table items add constraint items_type_check
  check (type in ('book','movie','music','videogame','boardgame'));

-- ============================================
-- MIGRACJA: wyceny rynkowe (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje)
-- purchase_price/purchase_currency — cena zakupu wpisywana ręcznie przez właściciela.
-- market_prices — surowy wynik ostatniego sprawdzenia CEX/eBay (tablica JSON, po jednym
-- obiekcie na źródło — patrz cf-worker/worker.js: cexLookup()/ebayLookup()), różne źródła
-- celowo zostają w swoich oryginalnych walutach zamiast przeliczania na jedną (brak API
-- kursów walut w projekcie) — UI pokazuje je osobno.
-- price_history — log każdego sprawdzenia w czasie (ręcznego i z cyklicznego odświeżania
-- w Workerze), do przyszłych wykresów trendu wartości.
-- ============================================
alter table items add column if not exists purchase_price numeric;
alter table items add column if not exists purchase_currency text default 'GBP';
alter table items add column if not exists market_prices jsonb;
alter table items add column if not exists market_price_updated_at timestamptz;

create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  market_prices jsonb not null,
  checked_at timestamptz not null default now()
);
create index if not exists price_history_item_idx on price_history(item_id);

alter table price_history enable row level security;
drop policy if exists "auth_full_access" on price_history;
create policy "auth_full_access" on price_history for all
  to authenticated using (true) with check (true);

-- ============================================
-- MIGRACJA: domyślna waluta ceny zakupu — GBP zamiast PLN (uruchom ręcznie w SQL
-- Editorze, jeśli wcześniej uruchamiałeś/aś powyższą migrację z domyślnym PLN —
-- dotyczy tylko nowo dodawanych pozycji bez podanej waluty, istniejące wiersze
-- zostają bez zmian)
-- ============================================
alter table items alter column purchase_currency set default 'GBP';

-- ============================================
-- MIGRACJA: nadpisanie już zapisanych pozycji z PLN na GBP (uruchom ręcznie w SQL
-- Editorze — to dotyczy pozycji, którym cena zakupu została wpisana zanim domyślną
-- walutę zmieniono na GBP; zmienia tylko te, u których waluta wciąż jest 'PLN', więc
-- jest bezpieczna do wielokrotnego uruchomienia)
-- ============================================
update items set purchase_currency = 'GBP' where purchase_currency = 'PLN';

-- ============================================
-- MIGRACJA: wyczyszczenie "przypadkowej" waluty przy pozycjach bez ceny (uruchom ręcznie
-- w SQL Editorze) — do tej pory formularz zapisywał purchase_currency przy KAŻDEJ edycji
-- pozycji, nawet gdy pole ceny zostało puste, więc appka potem fałszywie "pamiętała" ostatnio
-- wybraną walutę jako domyślną, mimo że ceny nigdy nie wpisano. index.html już tego nie robi
-- (patrz saveItem()) — ta migracja czyści to, co już zostało tak zapisane.
-- ============================================
update items set purchase_currency = null where purchase_price is null and purchase_currency is not null;

-- ============================================
-- MIGRACJA: tytuł oryginału i kraj zakupu (uruchom ręcznie w SQL Editorze, jeśli baza
-- już istnieje) — oba pola opcjonalne, przydatne przy pozycjach kupionych za granicą
-- w innym wydaniu/tytule niż polski.
-- ============================================
alter table items add column if not exists original_title text;
alter table items add column if not exists purchase_country text;

-- ============================================
-- MIGRACJA: flaga "prezent" (uruchom ręcznie w SQL Editorze, jeśli baza już istnieje) —
-- czysto informacyjna, nie wyłącza sprawdzania wyceny rynkowej (CEX/eBay) ani nie
-- wymusza pustej ceny zakupu.
-- ============================================
alter table items add column if not exists is_gift boolean not null default false;
