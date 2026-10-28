"""Persistent measurement and monthly estimate ledger."""
from __future__ import annotations
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from homeassistant.core import callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from .const import DEFAULTS
from .pse import fetch_day, WARSAW
from .settlement import zone, month_key, settle_months, money

_LOGGER = logging.getLogger(__name__)

class PGELedger:
    def __init__(self, hass, entry):
        self.hass, self.entry = hass, entry
        self.settings = {**DEFAULTS, **entry.data, **entry.options}
        self.store = Store(hass, 3, f'pge_net_billing_{entry.entry_id}')
        self.data = {'last_import': None, 'last_export': None, 'last_import_time': None,
                     'last_export_time': None, 'import_s1': 0., 'import_s2': 0.,
                     'export_kwh': 0., 'energy_cost': 0., 'distribution_cost': 0.,
                     'export_value': 0., 'unpriced_export_kwh': 0., 'intervals': [],
                     'prices': {}, 'price_last_sync': None, 'data_gaps': 0,
                     'months': {}, 'deposit_adjustment': 0.}
        self.unsubs, self.listeners = [], []
        self.lock = asyncio.Lock()

    async def async_load(self):
        stored = await self.store.async_load()
        if stored:
            self.data.update(stored)
        entities = [self.settings.get('import_entity'), self.settings.get('export_entity')]
        entities = [e for e in entities if e]
        if entities:
            self.unsubs.append(async_track_state_change_event(self.hass, entities, self._changed))
        self.unsubs.append(async_track_time_interval(self.hass, self._periodic, timedelta(minutes=5)))
        self.unsubs.append(async_track_time_interval(self.hass, self._sync_tick, timedelta(hours=1)))
        await self._sample()
        self.hass.async_create_task(self.sync_prices())

    def subscribe(self, fn):
        self.listeners.append(fn)
        return lambda: self.listeners.remove(fn) if fn in self.listeners else None

    def _notify(self):
        for fn in tuple(self.listeners):
            fn()

    @callback
    def _changed(self, event):
        self.hass.async_create_task(self._sample())

    @callback
    def _periodic(self, now):
        self.hass.async_create_task(self._sample())

    @callback
    def _sync_tick(self, now):
        self.hass.async_create_task(self.sync_prices())

    def _reading(self, direction):
        entity = self.settings.get(f'{direction}_entity')
        state = self.hass.states.get(entity) if entity else None
        if state is None or state.state in ('unknown', 'unavailable'):
            return None
        try:
            val = float(state.state)
            unit = state.attributes.get('unit_of_measurement', 'kWh')
            if unit == 'Wh': val /= 1000
            elif unit != 'kWh': return None
            return val if 0 <= val < 1e12 else None
        except (TypeError, ValueError):
            return None

    def _month(self, key):
        return self.data['months'].setdefault(key, {'energy': 0., 'distribution': 0.,
            'export_credit': 0., 'vat': float(self.settings['vat']), 'fixed': 0.})

    def _fixed_month(self, month):
        start = date.fromisoformat(self.settings['start_date'])
        if month < start.strftime('%Y-%m'):
            return 0.
        return sum(float(self.settings[k]) for k in ('fixed_trade', 'fixed_power', 'fixed_network', 'fixed_subscription'))

    async def _sample(self):
        async with self.lock:
            now = dt_util.utcnow().replace(microsecond=0)
            if now.astimezone(WARSAW).date() < date.fromisoformat(self.settings['start_date']):
                return
            changed = False
            for direction in ('import', 'export'):
                val = self._reading(direction)
                if val is None:
                    continue
                key, tkey = f'last_{direction}', f'last_{direction}_time'
                old, oldtime = self.data.get(key), self.data.get(tkey)
                previous = datetime.fromisoformat(oldtime) if oldtime else None
                self.data[key], self.data[tkey] = val, now.isoformat()
                changed = True
                if old is None or val < old or previous is None:
                    continue
                delta = val - old
                if delta <= 0:
                    continue
                if (now-previous).total_seconds() > 1200 or previous > now:
                    self.data['data_gaps'] += 1
                    if direction == 'export':
                        self.data['unpriced_export_kwh'] += delta
                    continue
                start_slot = previous.replace(minute=previous.minute//15*15, second=0, microsecond=0)
                end_slot = now.replace(minute=now.minute//15*15, second=0, microsecond=0)
                start_local, end_local = previous.astimezone(WARSAW), now.astimezone(WARSAW)
                if direction == 'import':
                    # Never guess the split at a tariff or month boundary.
                    if zone(start_local) != zone(end_local) or month_key(start_local) != month_key(end_local):
                        self.data['data_gaps'] += 1
                        continue
                    z, m = zone(end_local), self._month(month_key(end_local))
                    self.data[f'import_{z}'] += delta
                    cost = delta * float(self.settings[f'buy_{z}'])
                    distribution = delta * (float(self.settings[f'distribution_{z}']) + sum(float(self.settings[k]) for k in ('quality','cogen','oze')))
                    m['energy'] += cost
                    m['distribution'] += distribution
                    self.data['energy_cost'] += cost
                    self.data['distribution_cost'] += distribution
                else:
                    self.data['export_kwh'] += delta
                    if start_slot == end_slot:
                        self.data['intervals'].append({'slot': start_slot.isoformat(), 'kwh': delta})
                    else:
                        self.data['unpriced_export_kwh'] += delta
            if changed:
                self._reprice()
                await self.store.async_save(self.data)
                self._notify()

    def _reprice(self):
        for m in self.data['months'].values():
            m['export_credit'] = 0.
        total, pending = 0., 0.
        for item in self.data['intervals']:
            price = self.data['prices'].get(item['slot'])
            if price is None:
                pending += item['kwh']
                continue
            # Provisional zero floor; supplier's treatment must be reconciled.
            amount = item['kwh'] * max(0., price) * float(self.settings['rce_multiplier'])
            total += amount
            key = month_key(datetime.fromisoformat(item['slot']).astimezone(WARSAW))
            self._month(key)['export_credit'] += amount
        self.data['export_value'] = total
        self.data['pending_export_kwh'] = pending

    async def sync_prices(self):
        async with self.lock:
            today = dt_util.now().astimezone(WARSAW).date()
            for days_back in (2, 1, 0):
                try:
                    self.data['prices'].update(await fetch_day(self.hass, today - timedelta(days=days_back)))
                except Exception as exc:
                    _LOGGER.warning('PSE RCE sync failed for %s: %s', today-timedelta(days=days_back), exc)
            self.data['price_last_sync'] = dt_util.utcnow().isoformat()
            self._reprice()
            used = {x['slot'] for x in self.data['intervals']}
            cutoff = (dt_util.utcnow()-timedelta(days=4)).isoformat()
            self.data['prices'] = {k:v for k,v in self.data['prices'].items() if k >= cutoff or k in used}
            await self.store.async_save(self.data)
            self._notify()

    def _settlements(self):
        months = {k: dict(v) for k, v in self.data['months'].items()}
        start = date.fromisoformat(self.settings['start_date'])
        today = dt_util.now().astimezone(WARSAW).date()
        cursor = date(start.year, start.month, 1)
        while cursor <= today:
            key = cursor.strftime('%Y-%m')
            m = months.setdefault(key, {'energy': 0., 'distribution': 0., 'export_credit': 0., 'vat': float(self.settings['vat'])})
            m['fixed'] = self._fixed_month(key)
            if cursor.month == 12: cursor = date(cursor.year+1, 1, 1)
            else: cursor = date(cursor.year, cursor.month+1, 1)
        return settle_months(months, max(0., float(self.settings['initial_deposit']) + float(self.data.get('deposit_adjustment', 0))))

    def value(self, kind):
        d, s = self.data, self.settings
        if kind in d and isinstance(d[kind], (float, int)):
            return round(d[kind], 4)
        if kind == 'rce_current':
            now = dt_util.utcnow()
            slot = now.replace(minute=now.minute//15*15, second=0, microsecond=0).isoformat()
            return d['prices'].get(slot)
        if kind == 'fixed_monthly':
            return money(self._fixed_month(dt_util.now().strftime('%Y-%m')) * (1+float(s['vat'])))
        if kind == 'variable_cost_gross':
            return money((d['energy_cost'] + d['distribution_cost'])*(1+float(s['vat'])))
        settlements = self._settlements()
        if not settlements:
            return 0.
        current = settlements[max(settlements)]
        if kind == 'deposit_estimate': return current['deposit_balance']
        if kind == 'deposit_used': return money(sum(x['deposit_used'] for x in settlements.values()))
        if kind == 'deposit_expired': return money(sum(x['deposit_expired'] for x in settlements.values()))
        if kind == 'invoice_forecast': return current['invoice']
        if kind == 'net_energy_estimate': return money(current['energy_gross'] - current['deposit_used'])
        if kind == 'deposit_added': return money(sum(x['deposit_added'] for x in settlements.values()))
        return None

    def attributes(self, kind):
        """Extra data for the dashboard: per-month settlement, tariff, today's RCE."""
        s = self.settings
        if kind == 'invoice_forecast':
            vat = float(s['vat'])
            local = dt_util.now().astimezone(WARSAW)
            z = zone(local)
            variable = sum(float(s[k]) for k in ('quality', 'cogen', 'oze'))
            price = {k: money((float(s[f'buy_{k}']) + float(s[f'distribution_{k}']) + variable) * (1 + vat)) for k in ('s1', 's2')}
            return {
                'months': self._settlements(),
                'tariff': {'name': 'G12', 'zone': z, 'price_gross': price, 'vat': vat},
            }
        if kind == 'rce_current':
            local = dt_util.now().astimezone(WARSAW)
            start = local.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            rows = []
            for slot, price in sorted(self.data['prices'].items()):
                t = datetime.fromisoformat(slot).astimezone(WARSAW)
                if start <= t < end:
                    rows.append([slot, round(price, 5)])
            now = dt_util.utcnow()
            current = now.replace(minute=now.minute//15*15, second=0, microsecond=0).isoformat()
            return {'slot': current, 'today': rows}
        return {}

    async def async_shutdown(self):
        for fn in self.unsubs: fn()
        await self.store.async_save(self.data)