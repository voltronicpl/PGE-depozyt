from __future__ import annotations
from pathlib import Path
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components import frontend, panel_custom
from .const import DOMAIN
from .coordinator import PGELedger

PLATFORMS = ["sensor"]
PANEL_URL = "/pge_net_billing_static/pge-net-billing.js"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve the custom Lovelace card; add resource in dashboard resources if needed."""
    hass.http.register_static_path("/pge_net_billing_static", str(Path(__file__).parent / "frontend"), cache_headers=False)
    frontend.add_extra_js_url(hass, PANEL_URL)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ledger = PGELedger(hass, entry)
    await ledger.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = ledger
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    if not hass.data[DOMAIN].get("_panel_registered"):
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="pge-net-billing-panel",
            frontend_url_path="pge-net-billing",
            module_url=PANEL_URL,
            sidebar_title="PGE Net-Billing",
            sidebar_icon="mdi:transmission-tower",
            require_admin=False,
            config={},
        )
        hass.data[DOMAIN]["_panel_registered"] = True
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    return True

async def async_update_options(hass, entry):
    await hass.config_entries.async_reload(entry.entry_id)

async def async_unload_entry(hass, entry):
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        ledger = hass.data[DOMAIN].pop(entry.entry_id)
        await ledger.async_shutdown()
        if not any(k != "_panel_registered" for k in hass.data[DOMAIN]):
            frontend.async_remove_panel(hass, "pge-net-billing")
            hass.data[DOMAIN].pop("_panel_registered", None)
    return ok
