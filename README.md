# Biblioteczka

Katalog domowej kolekcji książek (papierowych), filmów (Blu-ray/DVD) i muzyki (CD/winyl) ze śledzeniem wypożyczeń — komu i kiedy pożyczono daną pozycję.

## Funkcje
- Skanowanie kodu kreskowego kamerą telefonu przy dodawaniu pozycji
- Automatyczne uzupełnianie danych po kodzie kreskowym:
  - książki (ISBN) — Open Library, z fallbackiem na Google Books
  - filmy/muzyka (EAN/UPC) — UPCitemdb (darmowy limit ok. 100 zapytań/dzień, bez klucza)
- Ręczne dodawanie/poprawianie pozycji, gdy baza nie rozpozna kodu
- Śledzenie wypożyczeń: komu, od kiedy, oznaczenie zwrotu
- Logowanie przez Supabase Auth — dostęp tylko dla właściciela

## Stack
- Czysty HTML/JS (jeden plik `index.html`), bez buildu
- [Supabase](https://supabase.com) — baza danych, autoryzacja
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) — skanowanie kodów kreskowych
- [Open Library API](https://openlibrary.org/dev/docs/api/books) i [Google Books API](https://developers.google.com/books) — dane książek po ISBN
- [UPCitemdb](https://www.upcitemdb.com/) — dane filmów/muzyki po kodzie EAN/UPC

## Konfiguracja
Baza danych i RLS znajdują się w `schema.sql`. Dane logowania Supabase (URL, anon key) są już wpisane w `index.html`.

Konto logowania trzeba założyć ręcznie: Supabase Dashboard → Authentication → Users → Add user (e-mail + hasło, "Auto Confirm User" zaznaczone).

## Hosting
Strona (`index.html`) jest hostowana na [GitHub Pages](https://matasiaja.github.io/Biblioteczka/).
Trzy małe funkcje serwerowe (`netlify/functions/*.mjs` — proxy do UPCitemdb, Biblioteki Narodowej
i OMDb, m.in. żeby ominąć CORS i trzymać klucz OMDb poza publicznym kodem) mieszkają na Netlify,
niezależnie od hostingu samej strony.

## Wyceny rynkowe
Każda pozycja może mieć ręcznie wpisaną cenę zakupu oraz automatycznie sprawdzaną wycenę
rynkową z dwóch źródeł (przycisk "Sprawdź cenę teraz" na karcie pozycji, plus cykliczne
odświeżanie w tle — patrz niżej):
- **CEX** (webuy.com) — po kodzie kreskowym, bez klucza. Ceny w GBP.
- **eBay** — po tytule, ceny AKTYWNYCH ofert (nie faktycznie sprzedanych — historia
  sprzedanych wymaga specjalnej zgody eBay Partner Network, niedostępnej dla zwykłego
  konta deweloperskiego), więc to przybliżenie "za ile inni teraz sprzedają".

Żeby włączyć eBay, trzeba:
1. Założyć darmowe konto na [developer.ebay.com](https://developer.ebay.com/) i w
   "Application Keys" wygenerować parę kluczy dla środowiska **Production**.
2. Ustawić sekrety w Workerze (`cd cf-worker && npx wrangler login`, potem):
   ```
   npx wrangler secret put EBAY_CLIENT_ID
   npx wrangler secret put EBAY_CLIENT_SECRET
   ```
3. Opcjonalnie `npx wrangler secret put EBAY_MARKETPLACE_ID` (domyślnie `EBAY_DE`; Polska
   nie ma własnego marketplace'u eBay, więc `EBAY_DE` jest najbliższym sensownym wyborem —
   inne opcje np. `EBAY_GB`).

Cykliczne odświeżanie (co jakiś czas, w tle, bez klikania) wymaga dodatkowo klucza
service_role z Supabase (Project Settings → API), bo Worker działa bez sesji
zalogowanego użytkownika i musi ominąć RLS:
```
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```
(`SUPABASE_URL` jest już ustawiony jako zwykła zmienna w `wrangler.toml` — to ten sam,
jawny adres co w `index.html`, nie trzeba go dodawać jako sekret.)

Po ustawieniu sekretów: `npx wrangler deploy` w `cf-worker/`. Harmonogram (`[triggers]`
w `wrangler.toml`) uruchamia się sam po wdrożeniu — domyślnie codziennie o 3:00 UTC,
paczkami po 30 pozycji (patrz `PRICE_REFRESH_BATCH_SIZE` w `worker.js`), więc pełne
odświeżenie całej kolekcji zajmuje z grubsza tydzień.

Migracja bazy (nowe kolumny `purchase_price`/`market_prices`/tabela `price_history`)
jest w `schema.sql` — trzeba ją uruchomić ręcznie w Supabase SQL Editorze, jeśli baza
już istnieje.

**Łączna wartość kolekcji** (Ustawienia → Statystyki) sumuje ceny zakupu przeliczone na
GBP przez [Frankfurter](https://frankfurter.dev) (darmowe, bez klucza, kursy referencyjne
EBC aktualizowane w dni robocze) — proxy `/fx-rates` w `worker.js`, bez dodatkowej
konfiguracji. Pozycje z ceną w walucie, dla której Frankfurter nie ma kursu, są pomijane
w sumie (i policzone osobno jako "pominięte" w opisie statystyki).

## Rozwój
To wersja startowa (MVP) — kolejne funkcje (np. lepsze wyszukiwanie filmów/muzyki po kodzie kreskowym, zdjęcia okładek, eksport, przypomnienia o zwrotach) dojdą w miarę rozwoju projektu.
