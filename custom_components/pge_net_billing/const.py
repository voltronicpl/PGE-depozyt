DOMAIN = "pge_net_billing"
VERSION = "1.7.1"
# v1.6.0: optional live power sensors for the "Moc i bateria" chart (W or kW, SOC in %)
POWER_ENTITIES = ["pv_power_entity", "battery_power_entity", "battery_soc_entity", "load_power_entity", "grid_power_entity",
                  # v1.7.0: inverter lifetime counters (kWh) = physical buy / sell
                  "grid_import_total_entity", "grid_export_total_entity"]
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
