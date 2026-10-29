"""PSE RCE-PLN v2: prices PLN/MWh indexed by UTC interval start."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import logging
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)
WARSAW = ZoneInfo('Europe/Warsaw')
URL = 'https://api.raporty.pse.pl/api/rce-pln'


def parse_rows(payload):
    rows = payload.get('value', payload.get('data', [])) if isinstance(payload, dict) else payload
    result = {}
    for row in rows:
        try:
            stamp = row.get('dtime_utc') or row.get('period_utc')
            if not stamp:
                # Local dtime can be ambiguous at DST switch: reject rather than misprice.
                continue
            dt = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(timezone.utc).replace(second=0, microsecond=0)
            val = float(str(row['rce_pln']).replace(',', '.')) / 1000
            result[dt.isoformat()] = val
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return result


async def fetch_day(hass, day):
    session = async_get_clientsession(hass)
    params = {'$filter': f"business_date eq '{day.isoformat()}'", '$first': '200'}
    async with session.get(URL, params=params, timeout=20) as resp:
        resp.raise_for_status()
        payload = await resp.json(content_type=None)
    return parse_rows(payload)
