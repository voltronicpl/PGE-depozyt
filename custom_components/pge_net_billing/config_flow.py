from __future__ import annotations
from datetime import date
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector
from .const import DOMAIN, DEFAULTS

class PGEFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            try:
                date.fromisoformat(user_input["start_date"])
            except (ValueError, KeyError):
                return self.async_show_form(step_id="user", errors={"base":"invalid_date"})
            return self.async_create_entry(title="PGE Net-Billing", data=user_input)
        schema = {
            vol.Optional("import_entity"): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
            vol.Optional("export_entity"): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
        }
        for key, value in DEFAULTS.items():
            typ = str if isinstance(value, str) else vol.Coerce(float)
            schema[vol.Optional(key, default=value)] = typ
        return self.async_show_form(step_id="user", data_schema=vol.Schema(schema))

    @staticmethod
    def async_get_options_flow(config_entry):
        return PGEOptionsFlow()

class PGEOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            try:
                date.fromisoformat(user_input["start_date"])
            except (ValueError, KeyError):
                return self.async_show_form(step_id="init", errors={"base":"invalid_date"})
            return self.async_create_entry(title="", data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        schema = {
            vol.Optional("import_entity", default=current.get("import_entity")): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
            vol.Optional("export_entity", default=current.get("export_entity")): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
        }
        for key, default in DEFAULTS.items():
            val=current.get(key,default)
            schema[vol.Optional(key, default=val)] = str if isinstance(default,str) else vol.Coerce(float)
        return self.async_show_form(step_id="init", data_schema=vol.Schema(schema))
