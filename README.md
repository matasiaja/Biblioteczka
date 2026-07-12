# Biblioteczka

Katalog domowej kolekcji książek (papierowych), filmów (Blu-ray/DVD) i muzyki (CD/winyl) ze śledzeniem wypożyczeń — komu i kiedy pożyczono daną pozycję.

## Funkcje
- Skanowanie kodu kreskowego kamerą telefonu przy dodawaniu pozycji
- Automatyczne uzupełnianie tytułu/autora dla książek (Open Library API po ISBN)
- Ręczne dodawanie pozycji bez kodu kreskowego
- Śledzenie wypożyczeń: komu, od kiedy, oznaczenie zwrotu
- Logowanie przez Supabase Auth — dostęp tylko dla właściciela

## Stack
- Czysty HTML/JS (jeden plik `index.html`), bez buildu
- [Supabase](https://supabase.com) — baza danych, autoryzacja
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) — skanowanie kodów kreskowych
- [Open Library API](https://openlibrary.org/dev/docs/api/books) — dane książek po ISBN

## Konfiguracja
Baza danych i RLS znajdują się w `schema.sql`. Dane logowania Supabase (URL, anon key) są już wpisane w `index.html`.

Konto logowania trzeba założyć ręcznie: Supabase Dashboard → Authentication → Users → Add user (e-mail + hasło, "Auto Confirm User" zaznaczone).

## Hosting
Plik `index.html` jest w pełni statyczny — hostowany na Netlify (repo prywatne).

## Rozwój
To wersja startowa (MVP) — kolejne funkcje (np. lepsze wyszukiwanie filmów/muzyki po kodzie kreskowym, zdjęcia okładek, eksport, przypomnienia o zwrotach) dojdą w miarę rozwoju projektu.
