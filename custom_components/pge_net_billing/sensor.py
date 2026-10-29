from __future__ import annotations
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.helpers.entity import DeviceInfo
from .const import DOMAIN

SENSORS = [
 ('import_s1','Pobór S1','kWh'),('import_s2','Pobór S2','kWh'),
 ('export_kwh','Eksport','kWh'),('energy_cost','Koszt energii netto','PLN'),
 ('distribution_cost','Koszt dystrybucji zmiennej netto','PLN'),
 ('export_value','Wartość eksportu (szacunek)','PLN'),
 ('unpriced_export_kwh','Eksport bez ceny RCE','kWh'),
 ('deposit_estimate','Saldo depozytu (prognoza)','PLN'),
 ('deposit_available','Depozyt dostępny teraz','PLN'),
 ('deposit_pending','Depozyt naliczany w tym miesiącu','PLN'),
 ('deposit_next_month','Depozyt dostępny od przyszłego miesiąca','PLN'),
 ('deposit_previous_month','Depozyt na koniec poprzedniego miesiąca','PLN'),
 ('deposit_added','Depozyt naliczony łącznie','PLN'),
 ('deposit_used','Depozyt wykorzystany łącznie','PLN'),
 ('deposit_expired','Depozyt wygasły łącznie','PLN'),
 ('variable_cost_gross','Koszt zmienny brutto','PLN'),
 ('net_energy_estimate','Energia po depozycie (miesiąc)','PLN'),
 ('fixed_monthly','Opłaty stałe miesięcznie brutto','PLN'),
 ('rce_current','Aktualna RCE','PLN/kWh'),
 ('pending_export_kwh','Eksport oczekujący na RCE','kWh'),
 ('data_gaps','Niekompletne pomiary',''),
 ('invoice_forecast','Prognoza rachunku za bieżący miesiąc','PLN'),
]

# Running totals -> long-term statistics 'change' per day/week/month
CUMULATIVE_PLN={'energy_cost','distribution_cost','export_value'}
# Point-in-time values -> min/mean/max statistics for sparklines
SNAPSHOT_PLN={'invoice_forecast','deposit_estimate','rce_current','deposit_available','deposit_next_month','deposit_previous_month','deposit_pending'}

async def async_setup_entry(hass, entry, async_add_entities):
    ledger=hass.data[DOMAIN][entry.entry_id]
    async_add_entities([PGESensor(ledger, entry, *spec) for spec in SENSORS])

class PGESensor(SensorEntity):
    _attr_has_entity_name=True
    _attr_should_poll=False
    def __init__(self,ledger,entry,key,label,unit):
        self.ledger=ledger;self.key=key
        self._attr_name=label
        self._attr_unique_id=f'{entry.entry_id}_{key}'
        self._attr_native_unit_of_measurement=unit
        self._attr_device_info=DeviceInfo(identifiers={(DOMAIN,entry.entry_id)},name='PGE Net-Billing — szacunki',manufacturer='Custom')
        # translation_key lets the frontend find entities without guessing friendly names
        self._attr_translation_key=key
        if unit=='kWh':self._attr_state_class=SensorStateClass.TOTAL
        elif key in CUMULATIVE_PLN:
            self._attr_device_class=SensorDeviceClass.MONETARY
            self._attr_state_class=SensorStateClass.TOTAL
        elif key in SNAPSHOT_PLN:
            self._attr_state_class=SensorStateClass.MEASUREMENT

    @property
    def extra_state_attributes(self):
        return {'note':'Szacunek lokalny, nie oficjalne rozliczenie PGE', **self.ledger.attributes(self.key)}

    @property
    def native_value(self):return self.ledger.value(self.key)

    async def async_added_to_hass(self):
        self.async_on_remove(self.ledger.subscribe(self.async_write_ha_state))
