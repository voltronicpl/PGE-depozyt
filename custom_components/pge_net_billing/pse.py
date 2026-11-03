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


# ---------- history / future for the dashboard modal (v1.5.0) ----------
# PSE publishes D+1 prices around 14:30. Past days never change, so they are cached
# for the HA run; today and tomorrow are re-fetched after a short TTL.
_DAY_CACHE = {}   # 'YYYY-MM-DD' (Warsaw business date) -> {utc_iso: PLN/kWh}
_DAY_FETCHED = {}  # 'YYYY-MM-DD' -> datetime (UTC) of last fetch
_FRESH = timedelta(minutes=20)
MAX_SPAN_DAYS = 400


async def fetch_range(hass, start, end):
    """Prices for business dates start..end (inclusive), following PSE paging links."""
    session = async_get_clientsession(hass)
    url = URL
    params = {'$filter': f"business_date ge '{start.isoformat()}' and business_date le '{end.isoformat()}'",
              '$first': '5000'}
    result = {}
    for _ in range(20):
        async with session.get(url, params=params, timeout=30) as resp:
            resp.raise_for_status()
            payload = await resp.json(content_type=None)
        result.update(parse_rows(payload))
        nxt = payload.get('nextLink') or payload.get('@odata.nextLink') if isinstance(payload, dict) else None
        if not nxt:
            break
        url, params = nxt, None
    return result


def remember(prices):
    """Feed prices the ledger already synced into the shared cache."""
    for slot, val in prices.items():
        day = datetime.fromisoformat(slot).astimezone(WARSAW).date().isoformat()
        _DAY_CACHE.setdefault(day, {})[slot] = val


async def prices_between(hass, start, end):
    """{utc_iso: price} for Warsaw dates start..end. Fetches only missing / stale days."""
    now = datetime.now(timezone.utc)
    today = now.astimezone(WARSAW).date()
    end = min(end, today + timedelta(days=1))
    if end < start:
        return {}
    if (end - start).days > MAX_SPAN_DAYS:
        start = end - timedelta(days=MAX_SPAN_DAYS)

    def stale(day):
        when = _DAY_FETCHED.get(day.isoformat())
        if when is None:
            return True
        return day >= today and now - when > _FRESH  # past days are final

    missing, day = [], start
    while day <= end:
        if stale(day):
            missing.append(day)
        day += timedelta(days=1)
    # contiguous chunks of max 31 days (≈3000 rows each)
    chunks = []
    for d in missing:
        if chunks and (d - chunks[-1][1]).days == 1 and (d - chunks[-1][0]).days < 31:
            chunks[-1][1] = d
        else:
            chunks.append([d, d])
    for a, b in chunks:
        try:
            got = await fetch_range(hass, a, b)
        except Exception as exc:  # network: show what we have
            _LOGGER.warning('PSE RCE history fetch %s..%s failed: %s', a, b, exc)
            continue
        remember(got)
        d = a
        while d <= b:
            _DAY_FETCHED[d.isoformat()] = now
            d += timedelta(days=1)

    out, day = {}, start
    while day <= end:
        out.update(_DAY_CACHE.get(day.isoformat(), {}))
        day += timedelta(days=1)
    return out


def aggregate(prices, agg):
    """rows [start_iso, mean, min, max]; agg = raw (15 min) | hour | day (Warsaw local)."""
    groups = {}
    for slot, val in prices.items():
        t = datetime.fromisoformat(slot)
        if agg == 'raw':
            key = t
        else:
            local = t.astimezone(WARSAW)
            key = local.replace(minute=0, second=0, microsecond=0) if agg == 'hour' else \
                datetime(local.year, local.month, local.day, tzinfo=WARSAW)
        groups.setdefault(key, []).append(val)
    rows = []
    for key in sorted(groups):
        v = groups[key]
        rows.append([key.isoformat(), round(sum(v) / len(v), 5), round(min(v), 5), round(max(v), 5)])
    return rows
