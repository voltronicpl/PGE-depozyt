"""Pure calculation helpers; all money represented as PLN decimal values."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Europe/Warsaw')

def money(value):
    return float(Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

def zone(local):
    summer = 4 <= local.month <= 9
    h = local.hour
    return 's2' if h >= 22 or h < 6 or ((15 <= h < 17) if summer else (13 <= h < 15)) else 's1'

def month_key(local):
    return local.strftime('%Y-%m')

def next_month(day):
    return date(day.year + (day.month == 12), 1 if day.month == 12 else day.month + 1, 1)

def add_months(day, count):
    n = day.year * 12 + day.month - 1 + count
    return date(n // 12, n % 12 + 1, 1)

def settle_months(months, initial_deposit=0, opening_month=None):
    """Forecast FIFO monthly credits. No invented refund; expired funds recorded separately.

    Monthly credit is applied only from the next month after export. Credits
    expire 12 months after their credit month. The statutory refund cap and
    actual supplier booking may differ; report as forecast only.
    """
    credits = []
    if initial_deposit > 0:
        credits.append({'amount': float(initial_deposit), 'origin': opening_month or 'opening', 'expires': None})
    output = {}
    for month in sorted(months):
        record = months[month]
        current = date.fromisoformat(month + '-01')
        expired = 0.0
        active = []
        for c in credits:
            if c['expires'] is not None and current >= date.fromisoformat(c['expires']):
                expired += c['amount']
            else:
                active.append(c)
        credits = active
        energy_gross = money(record.get('energy', 0) * (1 + record.get('vat', .23)))
        remaining = energy_gross
        used = 0.0
        for c in credits:
            if c['origin'] == month:
                continue
            part = min(remaining, c['amount'])
            c['amount'] = money(c['amount'] - part)
            remaining = money(remaining - part)
            used = money(used + part)
        credits = [c for c in credits if c['amount'] > 0.001]
        export_credit = money(record.get('export_credit', 0))
        if export_credit > 0:
            credits.append({'amount': export_credit, 'origin': month,
                            'expires': add_months(current, 12).isoformat()})
        distribution = money(record.get('distribution', 0) * (1 + record.get('vat', .23)))
        fixed = money(record.get('fixed', 0) * (1 + record.get('vat', .23)))
        output[month] = {
            'energy_gross': energy_gross, 'deposit_used': used,
            'deposit_added': export_credit, 'deposit_expired': money(expired),
            'deposit_balance': money(sum(c['amount'] for c in credits)),
            'distribution_gross': distribution, 'fixed_gross': fixed,
            'invoice': money(remaining + distribution + fixed),
        }
    return output
