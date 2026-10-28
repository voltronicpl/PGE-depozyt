# PGE Net-Billing v1.0.0

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

## Ograniczenia
To nadal **prognozy, nie oficjalna faktura**. Stawki są historyczne i niezweryfikowane dla listopada 2026. Bilans kWh to różnica eksportu i importu z okresu działania integracji, nie stan magazynu energii. Saldo depozytu nie jest saldem rachunku bankowego. Wykresy korzystają z Recorder i mogą być puste. Karta i panel nie były jeszcze testowane end-to-end na rzeczywistej instalacji HA. Rozliczenia i ograniczenia beta pozostają bez zmian.
