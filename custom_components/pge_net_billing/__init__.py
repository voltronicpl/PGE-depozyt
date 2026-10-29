from __future__ import annotations
import logging
from pathlib import Path
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from .const import DOMAIN, VERSION
from .coordinator import PGELedger

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor"]
# ?v= busts the browser cache on every release (static path is served without cache headers,
# so browsers kept the old v1.0.x file and showed the old panel)
PANEL_URL = f"/pge_net_billing_static/pge-net-billing.js?v={VERSION}"
# New element name: an old copy of the script (cache / leftover Lovelace resource) that already
# defined "pge-net-billing-panel" can no longer hijack the panel.
PANEL_ELEMENT = "pge-net-billing-dashboard"

async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Register the card as a Lovelace JS module without duplicate resources."""
    lovelace_data = hass.data.get("lovelace")
    if lovelace_data is None:
        _LOGGER.warning("Lovelace is not loaded; card resource was not registered")
        return

    resources = (
        lovelace_data.get("resources")
        if isinstance(lovelace_data, dict)
        else getattr(lovelace_data, "resources", None)
    )
    if resources is None or not hasattr(resources, "async_create_item"):
        _LOGGER.info("Lovelace resources are YAML-managed or unavailable; add %s manually", PANEL_URL)
        return

    # Critical: resources may not yet be loaded from .storage at startup.
    # Creating before loading can overwrite existing Lovelace resources.
    if not resources.loaded:
        await resources.async_load()

    base_url = PANEL_URL.split("?", 1)[0]
    matching = [
        item for item in resources.async_items()
        if item.get("url", "").split("?", 1)[0] == base_url
    ]
    if matching:
        existing = matching[0]
        if existing.get("url") != PANEL_URL or existing.get("res_type") != "module":
            await resources.async_update_item(
                existing["id"], {"url": PANEL_URL, "res_type": "module"}
            )
        return

    await resources.async_create_item({"url": PANEL_URL, "res_type": "module"})


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve the custom Lovelace card; add resource in dashboard resources if needed."""
    await hass.http.async_register_static_paths([StaticPathConfig("/pge_net_billing_static", str(Path(__file__).parent / "frontend"), False)])
    frontend.add_extra_js_url(hass, PANEL_URL)
    try:
        await _async_register_lovelace_resource(hass)
    except Exception:
        _LOGGER.exception("Failed to register PGE Net-Billing Lovelace resource")
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
