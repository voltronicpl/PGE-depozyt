DOMAIN = "pge_net_billing"
VERSION = "1.8.1"
# v1.6.0: optional live power sensors for the "Moc i bateria" chart (W or kW, SOC in %)
POWER_ENTITIES = ["pv_power_entity", "battery_power_entity", "battery_soc_entity", "load_power_entity", "grid_power_entity",
                  # v1.7.0: inverter lifetime counters (kWh) = physical buy / sell
                  "grid_import_total_entity", "grid_export_total_entity",
                  # v1.7.2: inverter energy counters (kWh; lifetime or daily-reset) instead of power x time
                  "pv_total_entity", "battery_charge_total_entity", "battery_discharge_total_entity", "load_total_entity"]
# v1.7.3: inverter counters used automatically when they exist and the option is empty (exact ids, no guessing)
AUTO_ENTITIES = {
    "grid_import_total_entity": "sensor.modbus_falownik_energia_siec_import_lacznie",
    "grid_export_total_entity": "sensor.modbus_falownik_energia_siec_export_lacznie",
    "pv_total_entity": "sensor.modbus_falownik_energia_pv_produkcja_lacznie",
    "battery_charge_total_entity": "sensor.modbus_falownik_energia_bateria_ladowanie_lacznie",
    "battery_discharge_total_entity": "sensor.modbus_falownik_energia_bateria_rozladowanie_lacznie",
    "load_total_entity": "sensor.modbus_falownik_energia_zuzycie_dom_lacznie",
}


def auto_entity(hass, key, current=None):
    """Configured entity, else the known inverter counter if it exists in HA."""
    if current:
        return current
    eid = AUTO_ENTITIES.get(key)
    return eid if eid and hass is not None and hass.states.get(eid) is not None else None


# sign flags: chart convention is + = charging / import from grid
POWER_FLAGS = ["battery_invert", "grid_invert"]
DEFAULTS = {
    "start_date": "2026-11-01", "initial_deposit": 0.0,
    "buy_s1": 0.56489, "buy_s2": 0.37303,
    "distribution_s1": 0.40140, "distribution_s2": 0.07650,
    "quality": 0.03320, "cogen": 0.00300, "oze": 0.00730,
    "fixed_trade": 10.48, "fixed_power": 24.05,
    "fixed_network": 14.40, "fixed_subscription": 2.25,
    "vat": 0.23, "rce_price": 0.0, "rce_multiplier": 1.23,
}
