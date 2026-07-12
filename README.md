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

## Rozwój
To wersja startowa (MVP) — kolejne funkcje (np. lepsze wyszukiwanie filmów/muzyki po kodzie kreskowym, zdjęcia okładek, eksport, przypomnienia o zwrotach) dojdą w miarę rozwoju projektu.
