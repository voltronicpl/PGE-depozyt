from __future__ import annotations
from pathlib import Path
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from .const import DOMAIN, VERSION
from .coordinator import PGELedger

PLATFORMS = ["sensor"]
# ?v= busts the browser cache on every release (static path is served without cache headers,
# so browsers kept the old v1.0.x file and showed the old panel)
PANEL_URL = f"/pge_net_billing_static/pge-net-billing.js?v={VERSION}"
# New element name: an old copy of the script (cache / leftover Lovelace resource) that already
# defined "pge-net-billing-panel" can no longer hijack the panel.
PANEL_ELEMENT = "pge-net-billing-dashboard"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve the custom Lovelace card; add resource in dashboard resources if needed."""
    await hass.http.async_register_static_paths([StaticPathConfig("/pge_net_billing_static", str(Path(__file__).parent / "frontend"), False)])
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
            webcomponent_name=PANEL_ELEMENT,
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
