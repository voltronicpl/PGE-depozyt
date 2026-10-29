# PGE Net-Billing v1.3.0

Nieoficjalna integracja Home Assistant dla prognoz net-billingu PGE, G12 i RCE.

## Automatyczna rejestracja zasobu Lovelace
Po uruchomieniu integracja automatycznie rejestruje `/pge_net_billing_static/pge-net-billing.js?v=1.3.0` jako zasób **JavaScript module** w Home Assistant (tryb zasobów storage). Istniejący wpis jest aktualizowany bez duplikowania, a pozostałe zasoby są zachowane. Przy zasobach zarządzanych przez YAML wpis należy dodać ręcznie. Po aktualizacji uruchom ponownie Home Assistant i odśwież aplikację mobilną.

## Instalacja
Skopiuj `custom_components/pge_net_billing` do `/config/custom_components/`, uruchom ponownie HA i skonfiguruj integrację przez Ustawienia → Urządzenia i usługi.

## Nowe w v1.0.0
- Panel boczny **PGE Net-Billing** pod `/pge-net-billing`, automatycznie rejestrowany po załadowaniu integracji.
- Karta Lovelace **PGE Net-Billing – kafelek**: rachunek, depozyt i bilans kWh w trzech kolumnach.
- Wspólny ciemny wygląd, gradienty, wykresy historii z HA Recorder i pasek bilansu.
- Dane z encji integracji; bez wymyślonych kwot.

### Dodanie małego kafelka
Po restarcie HA wybierz **Edytuj dashboard → Dodaj kartę → PGE Net-Billing – kafelek**.
Integracja automatycznie ładuje frontend. Nie trzeba rejestrować zasobu ani wpisywać YAML.

Jeżeli automatyczne rozpoznanie encji nie działa, w `entities:` można podać ich identyfikatory, np. `invoice_forecast`, `deposit_estimate`, `import_s1`, `import_s2`, `export_kwh`.

## Nowe w v1.3.0 – depozyt jak w PGE
Eksport z miesiąca M PGE księguje w M+1; depozyt pokrywa tylko energię (nie dystrybucję i opłaty stałe), ważny 12 miesięcy od zaksięgowania, FIFO.

- **Dostępne dziś** = depozyt zaksięgowany w poprzednich miesiącach (niewygasły) − zużyty na energię w tym miesiącu
- **Naliczane w tym miesiącu** = wartość eksportu z bieżącego miesiąca (wejdzie od 1-szego)
- **Od przyszłego miesiąca** = dostępne dziś + naliczane − wygasające z początkiem następnego miesiąca
- **Poprzedni miesiąc** = dostępne na koniec poprzedniego miesiąca

Nowe sensory: `Depozyt dostępny teraz`, `Depozyt naliczany w tym miesiącu`, `Depozyt dostępny od przyszłego miesiąca`, `Depozyt na koniec poprzedniego miesiąca`. `Saldo depozytu (prognoza)` = dostępne dziś (wcześniej zawierało też eksport z bieżącego miesiąca).
Poprawka: pula żyła 11 zamiast 12 miesięcy. W panelu nowa sekcja „Depozyt prosumencki – rozliczenia miesięczne” (poprzedni / obecny / następny miesiąc).
Nie liczymy zwrotu do 20% po 12 miesiącach – wygasłe środki są w `Depozyt wygasły łącznie`.

## Nowe w v1.2.2
- Panel dopasowany do makiety (układ 941 + 280 px, ikony obrysowe, grupowanie „1 135,15 zł”, niższy wykres, kafle szczegółów).

## Nowe w v1.2.1 – „widzę stary panel”
- Plik JS ładowany z `?v=<wersja>` – przeglądarka nie trzyma już starej wersji z cache.
- Panel używa elementu `pge-net-billing-dashboard`, więc stara kopia skryptu nie przejmie panelu.
- Jeśli kafelek nadal wygląda staro: Ustawienia → Pulpity → ⋮ → Zasoby – usuń stare wpisy z `pge-net-billing` (z czasów v1.0.0 nie są potrzebne). W konsoli przeglądarki ma być `PGE-NET-BILLING v1.2.1`.

## Nowe w v1.2.0
- Kafelek `custom:pge-net-billing-card` dopasowany do makiety w pikselach (396×161 px): rozmiary, odstępy, kolory, obrysowe ikony.
- Wygładzone wykresy (uśrednianie do 12 punktów + krzywe Béziera) – także w panelu.
- Czcionka: domyślnie Roboto z HA (makieta jest węższa niż Inter). `font: inter` w konfiguracji karty dociąga Inter z Google Fonts.
- Logo: `logo: /local/pge.png` (najlepiej ok. 66×36 px).

## Nowe w v1.1.0
- Panel odtworzony 1:1 z makiety: 3 kafle główne, wykres przepływu 14 dni, 4 kafle szczegółów, tabele Dziś / tydzień / miesiąc / rok, nawigacja po miesiącach.
- Okresy liczone ze statystyk długoterminowych Recordera (`recorder/statistics_during_period`), rachunek i depozyt per miesiąc z atrybutu `months` encji prognozy rachunku.
- Karty Lovelace (Dodaj kartę → szukaj „PGE Net-Billing”):
  - `custom:pge-net-billing-card` – kafelek 3-kolumnowy: Rachunek / Saldo / Bilans z wykresami,
  - `custom:pge-net-billing-feature-card`, `-invoice-card`, `-balance-card`, `-deposit-card`, `-summary-card`.
- Opcja `logo: /local/twoje-logo.png` (karta i panel) – domyślnie neutralna ikona.
- Encje wyszukiwane po `translation_key` (bez zgadywania po nazwach), ręczne `entities:` dalej działa.
- Backend: `state_class` dla kwot (statystyki), atrybuty `months`, `tariff` (strefa G12 i cena brutto) i `today` (RCE z dziś).

## Ograniczenia
To nadal **prognozy, nie oficjalna faktura**. Stawki są historyczne i niezweryfikowane dla listopada 2026. Bilans kWh to różnica eksportu i importu z okresu działania integracji, nie stan magazynu energii. Saldo depozytu nie jest saldem rachunku bankowego. Wykresy korzystają z Recorder i mogą być puste. Karta i panel nie były jeszcze testowane end-to-end na rzeczywistej instalacji HA. Rozliczenia i ograniczenia beta pozostają bez zmian.
