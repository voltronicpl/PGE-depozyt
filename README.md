# PGE Net-Billing v1.7.6

Nieoficjalna integracja Home Assistant dla prognoz net-billingu PGE, G12 i RCE.

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

## Nowe w v1.7.6
- Kafle „Kupno – tania taryfa nocna” / „Kupno – droga taryfa dzienna”: kWh w strefie + ile za nie wyszło (zł) i % importu. To samo w dymku Miesiąc / Rok.

## Nowe w v1.7.5
- Kafle „Kupno – tania / droga taryfa” przeniesione do sekcji Pieniądze, zaraz przy średniej cenie kupna.

## Nowe w v1.7.4
- Kafle „Kupno – tania taryfa (nocna)” i „Kupno – droga taryfa (dzienna)”: ile kWh kupiono w strefie S2 / S1 G12 w wybranym okresie, za ile i jaki to % importu (z liczników falownika, co kwadrans). Też w dymku widoku Miesiąc / Rok.

## Nowe w v1.7.3 – liczniki falownika podpinają się same
- Jeśli w HA istnieją encje `sensor.modbus_falownik_energia_{siec_import,siec_export,pv_produkcja,bateria_ladowanie,bateria_rozladowanie,zuzycie_dom}_lacznie`, a pole w opcjach jest puste, panel używa ich automatycznie, a w „Konfiguruj” są od razu wpisane (wystarczy Zatwierdź). Wybór w opcjach zawsze ma pierwszeństwo. Tylko dokładne nazwy – nic nie jest zgadywane.

## Nowe w v1.7.2 – energia prosto z liczników falownika
- Nowe opcje: „Falownik – produkcja PV łącznie”, „ładowanie baterii łącznie”, „rozładowanie baterii łącznie”, „zużycie domu” (kWh). Gdy są wskazane, kafle i punkty Miesiąc / Rok biorą energię z przyrostów tych liczników zamiast liczyć moc × czas. Działa z licznikami „łącznie” i dziennymi (zerowanymi o północy).
- Poprawka: odczyt licznika dokładnie na granicy kwadransu nie wypadał już z wyliczeń kupna / sprzedaży.
- Linie mocy (kW) na wykresie dalej z encji mocy.

## Nowe w v1.7.1
- Strzałki miesiąca w nagłówku przestawiają cały panel: kafle, tabele, „Przepływ energii” **i „Moc i bateria”** – oba wykresy przechodzą na widok Miesiąc z wybranego miesiąca.

## Nowe w v1.7.0 – „Moc i bateria”: okresy, neonowe ceny, faktyczne kupno i sprzedaż
- Przyciski ‹ › · Dzisiaj · Wczoraj · Tydzień · Miesiąc · Rok. Wszystkie widoki liniowe.
  - Dzień / Tydzień: surowe odczyty mocy (bez uśredniania; przy wielu odczytach na piksel rysowany jest najniższy i najwyższy).
  - Miesiąc / Rok: punkt = suma energii w dniu / miesiącu (z godzinowych statystyk HA: moc × 1 h), SOC = najniższy i najwyższy odczyt; klik = wejście w dzień / miesiąc.
- **SOC magazynu** – pogrubiona linia na wierzchu wykresu.
- **Ceny na wykresie (prawa oś, zł/kWh brutto)**: neonowy róż = cena kupna G12, neonowy turkus = cena sprzedaży RCE. Gruba świecąca linia = kwadranse, w których faktycznie kupowałeś / sprzedawałeś.
- **Faktyczne kupno i sprzedaż z liczników falownika** (nowe opcje: „Falownik – pobór z sieci łącznie” i „oddanie do sieci łącznie”, kWh od uruchomienia): przyrost licznika w kwadransie × cena z tego kwadransu. Dymek: „Kupiłeś X kWh po Y” / „Sprzedałeś X kWh po Y”.
- Kafle (klikalne → historia): Produkcja PV, Ładowanie baterii, Rozładowanie baterii, SOC magazynu min / maks, Import z sieci, Eksport do sieci, Pobór domu · Śr. cena kupna, Śr. cena sprzedaży, Najwyższa cena sprzedaży, Zapłacono za zakup, Wartość sprzedaży. Średnie = suma zł / suma kWh (ważone faktyczną energią).
- Depozyt, rachunek i „Przepływ energii” bez zmian (dalej z liczników skonfigurowanych w integracji).

## Nowe w v1.6.0 – wykres „Moc i bateria”
- Nowa karta nad „Przepływem energii”: SOC baterii (%, prawa oś) oraz moc produkcji PV, baterii, sieci i konsumpcji (kW) w ciągu dnia. Strefy nocne G12 podświetlone, linia „teraz”, ‹ › / Wczoraj / Dzisiaj.
- Dane = **surowe odczyty z historii Home Assistant** (bez uśredniania). Najechanie: wartości wszystkich linii w danej chwili + cena zakupu G12 i cena RCE brutto dla tego kwadransu. Klik w legendę włącza / wyłącza linię.
- Kafle pod wykresem (Produkcja PV, Ładowanie / rozładowanie baterii, Pobór / oddanie, Konsumpcja, SOC) – energia = moc × czas między kolejnymi odczytami. Klik w kafel = modal z historią tej encji (Dzień / Tydzień / Miesiąc).
- **Konfiguracja:** Ustawienia → Urządzenia i usługi → PGE Net-Billing → Konfiguruj → wskaż encje mocy PV, mocy baterii, SOC, mocy konsumpcji i mocy sieci (wszystkie opcjonalne; W lub kW, przeliczane automatycznie). Niewskazana encja = brak linii i kafla, nic nie jest dopowiadane. Jeśli Twoje urządzenie ma odwrotny znak (np. + = rozładowanie), zaznacz „Odwróć znak baterii / sieci”.

## Nowe w v1.5.6 – sensor RCE też brutto
- Sensor `Aktualna RCE brutto` (wcześniej „Aktualna RCE”) ma stan **brutto** = RCE z PSE × `rce_multiplier` (domyślnie 1,23). Atrybuty `today` / `tomorrow` też brutto; cena netto bieżącego kwadransu w atrybucie `net`.
- Uwaga: historia tego sensora w HA sprzed aktualizacji jest netto – od aktualizacji idą wartości ok. 23% wyższe. Automatyzacje z progami na tym sensorze trzeba przestawić. entity_id się nie zmienia.

## Nowe w v1.5.5 – RCE pokazywane brutto
- Kafel „Aktualna cena RCE brutto”, sparkline i modal RCE (wykres, dymki, średnia, najdrożej / najtaniej) pokazują cenę RCE × współczynnik prosumencki z konfiguracji (`rce_multiplier`, domyślnie 1,23) – tyle realnie trafia do depozytu za kWh. Netto nie jest już wyświetlane.
- Sensor `Aktualna RCE` nadal ma stan netto z PSE; nowy atrybut `multiplier`.

## Nowe w v1.5.4 – poprawka: ceny RCE przesunięte o 15 minut
- PSE w `dtime` / `dtime_utc` podaje **koniec** kwadransu (`dtime` 00:15 ↔ `period` 00:00 - 00:15). Integracja traktowała to jako początek, więc każda cena była przypisana do kwadransu o 15 min za późno – także przy wycenie eksportu (depozyt), a ostatni kwadrans doby trafiał do następnego dnia.
- Teraz początek kwadransu = `dtime_utc` − 15 min. Ceny już zapisane w integracji są jednorazowo przesuwane o −15 min przy starcie, a wycena eksportu przeliczana na nowo.
- Ceny RCE w integracji są **netto** (`rce_pln` / 1000). Strony i aplikacje pokazujące ok. 23% więcej podają je brutto.

## Nowe w v1.5.3 – RCE bez uśredniania
- Wykres RCE we wszystkich widokach (Dzień / Tydzień / Miesiąc / Rok) rysuje każdą prawdziwą cenę 15-minutową z PSE – nic nie jest uśredniane. Dymek pokazuje realną cenę kwadransu pod kursorem, „Najdrożej” / „Najtaniej” to prawdziwe ceny z dokładnym kwadransem.

## Nowe w v1.5.2 – poprawka RCE min / maks
- W widoku Miesiąc / Rok „Najdrożej” i „Najtaniej” brały maksimum ze średnich godzinowych / dziennych, więc szczyty były zaniżone. Teraz to prawdziwe ceny 15-minutowe z dokładnym kwadransem (API zwraca też czas min / maks w każdym przedziale).

## Nowe w v1.5.1 – więcej klikalnych elementów (tylko faktyczne dane)
- **Szacowana kwota rachunku** → rachunek miesiąc po miesiącu z rozbiciem (energia, depozyt, dystrybucja, opłaty stałe). Bieżący miesiąc = stan na teraz, bez dopowiadania reszty miesiąca.
- **Saldo depozytu** i **karty Poprzedni / Obecny / Następny miesiąc** → saldo depozytu w czasie + tabela transz: z którego miesiąca, od kiedy na koncie, do kiedy ważne, ile zostało. Przyszłe słupki = tylko środki już naliczone, które dopiero wygasną (zakładając brak zużycia).
- **Bilans energii** → oddano − pobrano w czasie (Dzień / Tydzień / Miesiąc / Rok).
- **Wiersze tabel** „Bilans energii” i „Rozliczenia finansowe” → modal od razu na tym okresie (dziś / tydzień / miesiąc / rok).
- Atrybut `deposit_credits` w sensorze prognozy rachunku (pozostałe transze FIFO).

## Nowe w v1.5.0 – kliknij kafel = historia (i przyszłość, jeśli jest)
- Kafle pod wykresem (Pobór, Oddanie, Wartość sprzedaży, Koszt zakupu, Zysk / strata) oraz dolne (Koszt zakupu, Wartość oddanej, Aktualna cena RCE, Taryfa dystrybucji) są klikalne – otwiera się okno (modal) z wykresem historii, przełącznikiem Dzień / Tydzień / Miesiąc / Rok, strzałkami ‹ › i „Dzisiaj”. Zamknięcie: ×, Esc lub klik obok.
- **Cena RCE**: pełna historia z PSE (RCE-PLN, 15 min; miesiąc = średnie godzinowe, rok = dzienne, w dymku min / maks) + **ceny na jutro**, gdy PSE je opublikuje (ok. 14:30). Przyszłość linią przerywaną, linia „teraz”, nieopublikowany okres zaszarzony, przycisk „Jutro”.
- **Taryfa G12**: strefy dzienna / nocna godzina po godzinie z ceną brutto – wstecz i do przodu (harmonogram jest znany z góry; ceny wg obecnych stawek z konfiguracji).
- **Energia i pieniądze**: słupki z Recordera HA, suma, średnia, najwięcej / najmniej; klik w słupek = wejście w dzień / miesiąc. Przyszłości tu nie ma – to pomiary.
- Integracja pobiera ceny RCE na jutro (od 14:00, co godzinę aż się pojawią); sensor `Aktualna RCE` ma nowy atrybut `tomorrow`, sparkline w kafelku RCE pokazuje dziś + jutro.
- Nowy endpoint `GET /api/pge_net_billing/rce?start=RRRR-MM-DD&end=RRRR-MM-DD&agg=raw|hour|day` (wymaga logowania HA; maks. 400 dni; minione dni cache'owane w pamięci).

## Nowe w v1.4.0 – wykres „Przepływ energii (wybrany okres)”
- Zakres: Dzień (słupki godzinowe) / Tydzień / Miesiąc / Rok (słupki miesięczne), własny zakres Od–Do, strzałki ‹ › przesuwają okres, „Dzisiaj” wraca do bieżącego.
- Najechanie na słupek: dymek z datą, poborem i oddaniem + kafelki pod wykresem pokazują ten słupek. Zjechanie: suma okresu i „Średnio dziennie”.
- Kliknięcie słupka: dzień → godziny tego dnia, miesiąc (w widoku Rok) → dni tego miesiąca.
- Bieżący dzień / godzina liczone do teraz (stan sensora − stan z końca poprzedniego okresu), nie tylko pełne godziny.
- v1.4.1: kafle „Koszt zakupu”, „Wartość oddanej”, „Aktualna cena RCE”, „Taryfa dystrybucji” przywrócone pod wykresem.
- v1.4.2: daty Od/Do zawsze w formacie DD.MM.RRRR (niezależnie od języka przeglądarki), klik w pole daty otwiera kalendarz.
- v1.4.3: kafel „Bilans energii” liczy okres wybrany na wykresie (dzień / tydzień / miesiąc / rok / własny) i zmienia się po najechaniu na słupek.
- v1.4.4: kafel „Zysk / strata” w karcie wykresu = wartość sprzedaży (RCE) − koszt zakupu energii brutto dla wybranego okresu lub słupka (bez dystrybucji, opłat stałych i autokonsumpcji).

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
