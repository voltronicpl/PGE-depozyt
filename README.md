# PGE Net-Billing — 1.0.0-beta.1

**Wersja eksperymentalna: nie jest oficjalnym rozliczeniem PGE.**

## Instalacja
Skopiuj `custom_components/pge_net_billing` do katalogu `/config/custom_components/`, zrestartuj Home Assistant, dodaj integrację przez Ustawienia → Urządzenia i usługi. Encje importu/eksportu można pozostawić puste i ustawić później w opcjach. Nie wymaga YAML.

## Co robi
- Odczytuje narastające liczniki energii importowanej i eksportowanej w kWh lub Wh.
- Rozlicza strefy G12 i opłaty netto według stawek wprowadzonych przez UI (domyślne pochodzą z faktury kwiecień/maj 2026; **niepotwierdzone dla listopada 2026**).
- Pobiera RCE z publicznego API PSE, jeśli dostępne są znaczniki UTC i ceny, i wycenia eksport w przedziałach 15-minutowych.
- Prowadzi miesięczne prognozy depozytu z FIFO, wykorzystaniem w kolejnych miesiącach i wygasaniem po 12 miesiącach.
- Wyświetla prognozę faktury bieżącego miesiąca, z pełną miesięczną opłatą stałą.
- Zapisuje lokalnie historię, odczyty i ceny w Home Assistant Store.

## WAŻNE ograniczenia
- **Nie jest to wersja produkcyjna ani zweryfikowana na żywym Home Assistant.** Nie przeprowadzono testu end-to-end z PSE ani fakturą prosumencką.
- Prognoza depozytu nie implementuje jeszcze ustawowego limitu zwrotu niewykorzystanych środków, szczegółowych korekt PGE ani rozliczenia z rzeczywistym kontem klienta.
- Wartości ujemne RCE są tymczasowo obcinane do zera; należy potwierdzić sposób ich rozliczenia u sprzedawcy.
- Dane pochodzące z falownika mogą się różnić od licznika OSD (bilansowanie międzyfazowe).
- Zmiana stawek nie przelicza poprawnie historycznych miesięcy. Opłaty stałe liczone są za pełny miesiąc (nie proporcjonalnie do dni). Nie ma kalendarza wersjonowania taryf.
- Zdarzenia licznika przecinające granicę 15 minut, strefy taryfowej lub miesiąca są oznaczane jako niekompletne; nie rozdzielamy energii na oko.
- Długie luki w pomiarach nie są wyceniane. Bez źródłowych danych 15-minutowych nie można zagwarantować rozliczenia z dokładnością do grosza.
- Przy zmianie źródła licznika należy zresetować punkt odniesienia; nie jest to jeszcze zautomatyzowane.
- Saldo 0 PLN oznacza przyjęty stan początkowy, nie stan potwierdzony w PGE.

## Plan następnej iteracji
Test integracyjny na Home Assistant, zweryfikowanie rzeczywistego formatu API PSE, obsługa kwartalnych/miesięcznych korekt, wersjonowane stawki i uzgodnienie salda z fakturą prosumencką.
