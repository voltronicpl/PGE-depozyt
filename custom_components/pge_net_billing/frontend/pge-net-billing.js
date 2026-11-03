/* PGE Net-Billing v1.5.1 – Home Assistant panel + Lovelace cards (layout matched to reference dashboard) */
(() => { // own scope: never clashes with another copy of this script loaded as a classic <script>
const DOMAIN = "pge_net_billing";
const VERSION = "1.5.1";
const PANEL_PATH = "/pge-net-billing";
const KEYS = ["invoice_forecast", "deposit_estimate", "import_s1", "import_s2", "export_kwh", "energy_cost", "export_value", "rce_current"];
// Fallback for installs without translation_key (older backend): friendly-name suffixes
const NAMES = {
  invoice_forecast: "Prognoza rachunku za bieżący miesiąc", deposit_estimate: "Saldo depozytu (prognoza)",
  import_s1: "Pobór S1", import_s2: "Pobór S2", export_kwh: "Eksport", energy_cost: "Koszt energii netto",
  export_value: "Wartość eksportu (szacunek)", rce_current: "Aktualna RCE",
};
const STAT_KEYS = ["import_s1", "import_s2", "export_kwh", "energy_cost", "export_value", "invoice_forecast", "deposit_estimate"];

/* ---------- formatting ---------- */
const NF = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF4 = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const isNum = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const group = n => { const [i, f] = NF.format(Math.abs(n)).replace(/\s/g, "").split(","); return (n < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + (f !== undefined ? "," + f : ""); };
const fmt = (v, unit, signed = false) => !isNum(v) ? "—" : (signed && v > 0 ? "+" : "") + group(Number(v)) + (unit ? " " + unit : "");
const zl = (v, s) => fmt(v, "zł", s);
const kwh = (v, s) => fmt(v, "kWh", s);
const pad = n => String(n).padStart(2, "0");
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStart = (d, add = 0) => new Date(d.getFullYear(), d.getMonth() + add, 1);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = d => cap(new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(d));
const monthOnly = d => new Intl.DateTimeFormat("pl-PL", { month: "long" }).format(d);
// "za marzec" needs accusative – nominative month names in Polish are fine for the short label
const MONTH_ACC = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const MONTH_INSTR = ["styczniem", "lutym", "marcem", "kwietniem", "majem", "czerwcem", "lipcem", "sierpniem", "wrześniem", "październikiem", "listopadem", "grudniem"];
const MONTH_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const dayShort = d => `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
const stamp = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ---------- data ---------- */
function resolveEntities(hass, config) {
  const out = {};
  const reg = Object.values(hass?.entities || {});
  const states = Object.values(hass?.states || {});
  for (const k of KEYS) {
    let id = config?.entities?.[k];
    if (!id) id = reg.find(e => e.platform === DOMAIN && e.translation_key === k)?.entity_id;
    if (!id) id = states.find(s => s.entity_id.startsWith("sensor.") && String(s.attributes?.friendly_name || "").endsWith(NAMES[k]))?.entity_id;
    out[k] = id;
  }
  return out;
}

const statCache = new Map();
async function loadStats(hass, ids, start, end, period = "day") {
  const list = STAT_KEYS.map(k => ids[k]).filter(Boolean);
  if (!list.length || !hass?.callWS) return null;
  const key = period + "|" + list.join(",") + "|" + start.toISOString() + "|" + end.toISOString();
  const hit = statCache.get(key);
  if (hit && Date.now() - hit.t < 300000) return hit.p;
  const p = hass.callWS({
    type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
    statistic_ids: list, period, types: ["change", "max", "mean", "state"],
  }).catch(e => { console.warn("PGE Net-Billing: statistics unavailable", e); return null; });
  statCache.set(key, { t: Date.now(), p });
  return p;
}

function statWindow(offset) {
  const now = new Date();
  const sel = monthStart(now, offset);
  const selEnd = offset === 0 ? now : monthStart(now, offset + 1);
  const start = new Date(Math.min(new Date(sel.getFullYear(), 0, 1), monthStart(sel, -1), new Date(selEnd - 32 * 864e5)));
  start.setHours(0, 0, 0, 0);
  return { now, sel, selEnd, start, end: offset === 0 ? new Date(now.getTime() + 36e5) : selEnd };
}

function buildModel(hass, ids, raw, offset) {
  const { now, sel, selEnd } = statWindow(offset);
  const st = k => hass?.states?.[ids[k]];
  const val = k => { const s = st(k); const n = Number(s?.state); return s && isNum(s.state) ? n : null; };
  const inv = st("invoice_forecast")?.attributes || {};
  const months = inv.months || {};
  const tariff = inv.tariff || null;
  const vat = isNum(tariff?.vat) ? Number(tariff.vat) : 0.23;
  const selK = monthKey(sel), prevD = monthStart(sel, -1), prevK = monthKey(prevD);
  const isCurrent = offset === 0;

  // daily rows keyed by local date
  const days = {};
  const pick = (k, field) => {
    for (const r of raw?.[ids[k]] || []) {
      const d = new Date(typeof r.start === "number" ? r.start : Date.parse(r.start));
      const dk = dayKey(d);
      (days[dk] ||= { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()) })[k] = r[field];
    }
  };
  const CUM = ["import_s1", "import_s2", "export_kwh", "energy_cost", "export_value"];
  for (const k of CUM) pick(k, "change");
  // today "up to now": live sensor state minus yesterday's closing state (daily stats only cover full hours)
  if (isCurrent && raw) {
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), y0 = new Date(t0.getTime() - 864e5);
    for (const k of CUM) {
      const prevRow = (raw[ids[k]] || []).find(r => dayKey(new Date(typeof r.start === "number" ? r.start : Date.parse(r.start))) === dayKey(y0));
      const cur = val(k);
      if (prevRow && isNum(prevRow.state) && isNum(cur) && cur - prevRow.state >= 0) (days[dayKey(t0)] ||= { date: t0 })[k] = cur - prevRow.state;
    }
  }
  pick("invoice_forecast", "max");
  pick("deposit_estimate", "mean");
  const hasStats = Object.keys(days).length > 0;
  const rows = Object.values(days).sort((a, b) => a.date - b.date);
  const imp = r => (isNum(r.import_s1) || isNum(r.import_s2)) ? (Number(r.import_s1) || 0) + (Number(r.import_s2) || 0) : null;
  const sum = (from, to, f) => {
    if (!hasStats) return null;
    let s = 0, any = false;
    for (const r of rows) if (r.date >= from && r.date < to) { const v = f(r); if (isNum(v)) { s += Number(v); any = true; } }
    return any ? s : 0;
  };
  const range = (from, to) => {
    const i = sum(from, to, imp), e = sum(from, to, r => r.export_kwh);
    const c = sum(from, to, r => r.energy_cost), x = sum(from, to, r => r.export_value);
    return { imp: i, exp: e, bal: isNum(i) && isNum(e) ? e - i : null, cost: isNum(c) ? c * (1 + vat) : null, sell: x, saldo: isNum(c) && isNum(x) ? x - c * (1 + vat) : null };
  };
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week0 = new Date(today0); week0.setDate(week0.getDate() - ((week0.getDay() + 6) % 7));
  const tomorrow = new Date(today0.getTime() + 864e5);
  const selTo = isCurrent ? tomorrow : selEnd;
  const month = range(sel, selTo), prev = range(prevD, sel);
  const year = range(new Date(sel.getFullYear(), 0, 1), selTo);
  const periods = isCurrent
    ? [["Dziś", range(today0, tomorrow)], ["Bieżący tydzień", range(week0, tomorrow)], ["Bieżący miesiąc", month], [`Rok ${sel.getFullYear()}`, year]]
    : [[monthName(sel), month], [monthName(prevD), prev], [`Rok ${sel.getFullYear()} (do ${MONTH_SHORT[sel.getMonth()]})`, year]];

  // series for charts (last 14 / 30 days of the window)
  const lastDay = isCurrent ? today0 : new Date(selEnd.getTime() - 864e5);
  const series = (n, f) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(lastDay); d.setDate(d.getDate() - i); const r = days[dayKey(d)]; out.push({ d, v: r ? f(r) : null }); }
    return out;
  };
  const flow = series(14, r => ({ imp: imp(r), exp: r.export_kwh, cost: isNum(r.energy_cost) ? r.energy_cost * (1 + vat) : null, sell: r.export_value }));
  const s30 = f => series(30, f).map(x => x.v).filter(isNum).map(Number);

  const invoice = isNum(months[selK]?.invoice) ? months[selK].invoice : (isCurrent ? val("invoice_forecast") : null);
  const invoicePrev = months[prevK]?.invoice;
  // Deposit (see settlement.py): available now / accrued this month / from next month / end of previous month
  const ms = months[selK] || {}, mp = months[prevK] || {};
  const pick2 = (o, a, b) => isNum(o[a]) ? Number(o[a]) : isNum(o[b]) ? Number(o[b]) : null;
  const deposit = pick2(ms, "deposit_available", "deposit_balance") ?? (isCurrent ? val("deposit_estimate") : null);
  const dep = {
    prev: pick2(mp, "deposit_available", "deposit_balance"), prevUsed: pick2(mp, "deposit_used"), prevAdded: pick2(mp, "deposit_added"),
    now: deposit, used: pick2(ms, "deposit_used"), pending: pick2(ms, "deposit_pending", "deposit_added"),
    next: pick2(ms, "deposit_next"), expiring: pick2(ms, "deposit_expiring_next"),
  };

  const rce = st("rce_current");
  const rceToday = (rce?.attributes?.today || []).map(x => Number(x[1])).filter(isNum);
  const rceTomorrow = (rce?.attributes?.tomorrow || []).map(x => Number(x[1])).filter(isNum);
  const rceSlot = rce?.attributes?.slot ? new Date(rce.attributes.slot) : null;
  const updated = KEYS.map(k => st(k)?.last_updated).filter(Boolean).map(Date.parse).filter(isNum);

  return {
    sel, prevD, isCurrent, hasStats, months, tariff, vat,
    invoice, invoicePrev, deposit, dep, month, prev, periods, flow,
    spark: {
      invoice: series(30, r => r.invoice_forecast).filter(x => x.d >= sel).map(x => x.v).filter(isNum).map(Number), deposit: s30(r => r.deposit_estimate),
      imp: s30(imp), exp: s30(r => r.export_kwh), sell: s30(r => r.export_value), cost: s30(r => r.energy_cost),
      bal: s30(r => isNum(r.export_kwh) && isNum(imp(r)) ? r.export_kwh - imp(r) : null),
    },
    rce: val("rce_current"), rceToday, rceTomorrow, rceSlot,
    updated: updated.length ? new Date(Math.max(...updated)) : null,
    todayV: (() => { const r = days[dayKey(today0)]; return isCurrent && r ? { imp: imp(r), exp: isNum(r.export_kwh) ? Number(r.export_kwh) : null, cost: isNum(r.energy_cost) ? r.energy_cost * (1 + vat) : null, sell: isNum(r.export_value) ? Number(r.export_value) : null } : null; })(),
    found: Object.values(ids).some(Boolean),
  };
}

/* ---------- drawing primitives ---------- */
const TONE = { orange: "#ffad2e", green: "#18e08e", blue: "#3b8cff", red: "#ff4757", grey: "#8fa8ba" };
let gid = 0;
function spark(values, color, w = 120, h = 44) {
  const v = values.filter(isNum);
  if (v.length < 2) return `<div class="nohist" style="height:${h}px">brak historii</div>`;
  // bucket-average to <=12 points, then Catmull-Rom -> cubic Bézier (smooth like the mockup)
  const n = Math.min(12, v.length), b = [];
  for (let i = 0; i < n; i++) { const a = Math.floor(i * v.length / n), z = Math.max(a + 1, Math.floor((i + 1) * v.length / n)); const part = v.slice(a, z); b.push(part.reduce((s, x) => s + x, 0) / part.length); }
  const lo = Math.min(...b), hi = Math.max(...b), d = hi - lo || 1;
  const pts = b.map((y, i) => [i / (b.length - 1) * w, h - 4 - (y - lo) / d * (h * .72)]);
  let line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    line += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const id = "pg" + (++gid);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".5"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
const icon = (name, tone, cls = "") => `<span class="ic ic-${tone} ${cls}"><ha-icon icon="mdi:${name}"></ha-icon></span>`;
const bar = (pct, kind = "money") => `<div class="bar bar-${kind}"><i style="left:${Math.max(2, Math.min(98, pct)).toFixed(1)}%"></i></div>`;
function depositScale(v) { return Math.max(500, Math.ceil(Math.abs(Number(v) || 0) / 500) * 500); }
function depositPct(v) { const s = depositScale(v); return 50 + (Number(v) || 0) / s * 50; }
function energyPct(imp, exp) { const t = (Number(imp) || 0) + (Number(exp) || 0); return t > 0 ? exp / t * 100 : 50; }
function delta(cur, prev, upIsBad, plus = true) {
  if (!isNum(cur) || !isNum(prev) || Number(prev) === 0) return "";
  const p = (cur - prev) / Math.abs(prev) * 100, up = p >= 0;
  const bad = upIsBad ? up : !up;
  return `<span class="delta ${bad ? "t-red" : "t-green"}"><ha-icon icon="mdi:arrow-${up ? "up" : "down"}"></ha-icon>${plus ? (up ? "+" : "−") : ""}${Math.abs(p).toFixed(0)}%</span>`;
}
function logo(config, size = "lg") {
  if (config?.logo) return `<img class="logo logo-${size}" src="${esc(config.logo)}" alt="">`;
  return `<img class="logo logo-${size}" src="/pge_net_billing_static/pge-logo.svg" alt="PGE">`;
}
function flowChart(flow) {
  const W = 680, H = 160, L = 34, R = 8, T = 18, B = 22;
  const vals = flow.flatMap(x => [x.v?.imp, x.v?.exp]).filter(isNum).map(Number);
  if (!vals.length) return `<div class="nohist big">Brak historii dziennej z Recordera – wykres pojawi się po pierwszych pełnych dobach.</div>`;
  const raw = Math.max(1, ...vals);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(s => s * 3 >= raw) || Math.ceil(raw / 3);
  const top = step * 3, bottom = step * 2;
  const y = v => T + (top - v) / (top + bottom) * (H - T - B);
  const n = flow.length, slot = (W - L - R) / n, bw = Math.min(18, slot * .5);
  let g = "";
  for (let v = -bottom; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "zero" : "grid"}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const bars = flow.map((f, i) => {
    const cx = L + slot * i + slot / 2, a = Number(f.v?.imp) || 0, e = Number(f.v?.exp) || 0;
    return `<g class="day" data-i="${i}"><rect class="hit" x="${cx - slot / 2}" y="${T - 6}" width="${slot}" height="${H - T}" fill="transparent"/><rect x="${cx - bw / 2}" y="${y(a)}" width="${bw}" height="${Math.max(0, y(0) - y(a))}" rx="2" fill="url(#gImp)"/><rect x="${cx - bw / 2}" y="${y(0) + 1}" width="${bw}" height="${Math.max(0, y(-e) - y(0))}" rx="2" fill="url(#gExp)"/><text x="${cx}" y="${H - 6}" text-anchor="middle">${dayShort(f.d)}</text></g>`;
  }).join("");
  return `<svg class="flow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb52e"/><stop offset="1" stop-color="#f08a14"/></linearGradient><linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16c97f"/><stop offset="1" stop-color="#2af0a0"/></linearGradient></defs><text x="${L - 30}" y="10" class="unit">kWh</text>${g}${bars}</svg>`;
}

/* ---------- shared tiles (panel aside + Lovelace) ---------- */
const CICON = {
  bill: `<svg viewBox="0 0 24 24"><path d="M15.5 13.2V4.8A1.8 1.8 0 0 0 13.7 3H6.3a1.8 1.8 0 0 0-1.8 1.8v14.4A1.8 1.8 0 0 0 6.3 21h6"/><path d="M8 7.5h4.5M8 10.8h4.5M8 14.1h3"/><circle cx="17.3" cy="18.2" r="2.8"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24"><path d="M5.5 7.2 15.6 4.1a1.4 1.4 0 0 1 1.8 1.3v1.8"/><rect x="3.2" y="7.2" width="17.6" height="12.8" rx="2.6"/><path d="M20.8 11.2h-4.2a2.4 2.4 0 0 0 0 4.8h4.2"/><circle cx="16.8" cy="13.6" r=".6" fill="currentColor"/></svg>`,
  leaf: `<svg viewBox="0 0 24 24"><path d="M19.6 4.2C11.3 3.6 5.3 7.4 5.3 13.6c0 3.4 2.5 6 5.9 6 6.1 0 9.4-6.6 8.4-15.4z"/><path d="M4 20.6 15.6 9M10.2 14.6h4.2M10.2 14.6v-3.7"/></svg>`,
};
const TILES = {
  compact(m, c) {
    const cell = (ic, tone, label, value, cls, extra, vals, col) => `<div class="c-cell"><div class="c-row"><span class="c-ic c-${tone}">${CICON[ic]}</span><div class="c-txt"><div class="c-label">${label}</div><div class="c-val ${cls}">${value}</div>${extra ? `<div class="c-extra">${extra}</div>` : ""}</div></div><div class="c-spark">${spark(vals, col, 100, 34)}</div></div>`;
    const unit = (txt, u) => txt === "—" ? txt : txt.replace(" " + u, `<small> ${u}</small>`);
    return `<div class="tile t-compact link"><div class="c-head">${logo(c, "md")}<div><div class="c-title">Net-Billing</div><div class="c-month">${esc(monthName(m.sel))}</div></div></div>
      <div class="c-grid">
        ${cell("bill", "orange", "Rachunek", zl(m.invoice), "", delta(m.invoice, m.invoicePrev, true, false), m.spark.invoice, TONE.red)}
        ${cell("wallet", "blue", "Saldo", zl(m.deposit, true), "t-green", "", m.spark.deposit, TONE.blue)}
        ${cell("leaf", "green", "Bilans", unit(kwh(m.month.bal, true), "kWh"), isNum(m.month.bal) && m.month.bal < 0 ? "t-red" : "t-green", "", m.spark.bal.length ? m.spark.bal : m.spark.exp, TONE.green)}
      </div></div>`;
  },
  deposit(m, c) {
    const s = depositScale(m.deposit);
    return `<div class="tile t-feature link"><div class="t-head">${logo(c, "sm")}<span class="t-title">PGE Net-Billing</span><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></div>
      <div class="t-center"><div class="v-xl t-green">${zl(m.deposit, true)}</div><div class="muted">Saldo depozytu</div></div>
      ${bar(depositPct(m.deposit))}<span class="sr">Skala ±${s} zł</span>
      <div class="split"><div><div class="v-md t-orange">${zl(m.invoice)}</div><div class="muted">Rachunek (${MONTH_SHORT[m.sel.getMonth()]})</div></div><div class="r"><div class="v-md t-green">${kwh(m.month.bal, true)}</div><div class="muted">Bilans energii</div></div></div></div>`;
  },
  invoice(m) {
    return `<div class="tile t-mini link">${`<span class="ic ic-orange ic-lg">${CICON.bill}</span>`}<div class="t-body"><div class="v-lg t-orange">${zl(m.invoice)}</div><div class="muted">Rachunek ${monthOnly(m.sel)}</div>${delta(m.invoice, m.invoicePrev, true)}</div><div class="t-spark">${spark(m.spark.invoice, TONE.red, 90, 56)}</div></div>`;
  },
  balance(m) {
    return `<div class="tile t-mini link">${`<span class="ic ic-green ic-lg">${CICON.leaf}</span>`}<div class="t-body"><div class="v-lg ${isNum(m.month.bal) && m.month.bal < 0 ? "t-red" : "t-green"}">${kwh(m.month.bal, true)}</div><div class="muted">Bilans energii</div></div><div class="t-spark">${spark(m.spark.bal.length ? m.spark.bal : m.spark.exp, TONE.green, 90, 56)}</div></div>`;
  },
  wallet(m) {
    return `<div class="tile t-mini link">${`<span class="ic ic-blue ic-lg">${CICON.wallet}</span>`}<div class="t-body"><div class="v-lg t-green">${zl(m.deposit, true)}</div><div class="muted">Saldo depozytu</div></div><div class="t-spark">${spark(m.spark.deposit, TONE.green, 90, 56)}</div></div>`;
  },
  summary(m, c) {
    return `<div class="tile t-summary link"><div class="t-head">${logo(c, "sm")}<span class="t-title">PGE Net-Billing</span></div>
      <div class="split"><div><div class="muted2">Pobrano</div><div class="v-md t-orange">${kwh(m.month.imp)}</div></div><div class="r"><div class="muted2">Oddano</div><div class="v-md t-green">${kwh(m.month.exp)}</div></div></div>
      ${bar(energyPct(m.month.imp, m.month.exp), "energy")}
      <div class="split"><div><div class="v-md t-green">${kwh(m.month.bal, true)}</div><div class="muted">Bilans</div></div><div class="r"><div class="v-md t-blue2">${zl(m.deposit, true)}</div><div class="muted">Saldo</div></div></div>
      <div class="t-foot">${icon("file-document-outline", "orange")}<div class="t-body"><div class="v-md">${zl(m.invoice)}</div><div class="muted">Rachunek ${monthOnly(m.sel)}</div></div><div class="t-spark">${spark(m.spark.invoice, TONE.red, 80, 40)}</div></div></div>`;
  },
};

function depCard(tone, kicker, title, value, rows, cls, tip) {
  return `<div class="dep-card hist ${cls}" data-hist="deposit" tabindex="0" role="button" title="${esc(tip + " · Kliknij: historia depozytu")}"><div class="dep-top"><span class="ic ic-${tone}"><ha-icon icon="mdi:calendar-month"></ha-icon></span><div><div class="dep-kicker">${esc(kicker)}</div><div class="dep-title">${esc(title)}</div><div class="dep-val ${isNum(value) && value < 0 ? "t-red" : "t-green"}">${zl(value, true)}</div></div></div>
    ${rows.map(([l, v, c]) => `<div class="dep-line"><span>${esc(l)}</span><b class="${c}">${esc(v)}</b></div>`).join("")}</div>`;
}

/* ---------- styles ---------- */
const CSS = `
:host{display:block;container-type:inline-size;--pge-font:var(--paper-font-body1_-_font-family,Roboto),Roboto,"Segoe UI",Arial,sans-serif;--bg:#06111b;--card1:#0c1f2e;--card2:#081826;--line:#14293a;--txt:#eaf2f9;--mut:#9db2c3;--mut2:#c9d7e2;--o:#ffad2e;--g:#18e08e;--b:#3b8cff;--r:#ff4757;color:var(--txt);font-family:var(--pge-font)}
*{box-sizing:border-box}ha-icon{--mdc-icon-size:100%;display:inline-flex;width:100%;height:100%}
.t-orange{color:var(--o)}.t-green{color:var(--g)}.t-blue{color:var(--b)}.t-blue2{color:#7fb3ff}.t-red{color:var(--r)}
.muted{color:var(--mut);font-size:13px}.muted2{color:var(--mut2);font-size:13px}.r{text-align:right}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.box,.tile{background:linear-gradient(150deg,var(--card1),var(--card2));border:1px solid var(--line);border-radius:16px;min-width:0;position:relative}
.ic{flex:0 0 auto;display:grid;place-items:center;width:42px;height:42px;border-radius:12px;padding:9px}
.ic.ic-lg{width:54px;height:54px;padding:12px;border-radius:14px}.ic svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ic-orange{color:#ffaa22;background:linear-gradient(145deg,#3a2c12,#271f12)}.ic-green{color:#1fe090;background:linear-gradient(145deg,#0c3a2c,#0a2a22)}
.ic-blue{color:#3d8dff;background:linear-gradient(145deg,#0e2f63,#0b2246)}.ic-red{color:#ff4757;background:linear-gradient(145deg,#3c1820,#2a141a)}
.ic-plain{background:none;padding:2px}
.logo{display:inline-grid;place-items:center;flex:0 0 auto}.logo-badge{border-radius:14px;color:#fff;background:linear-gradient(135deg,#ff3045,#ff8a1f);box-shadow:0 4px 14px #ff3a4a33}
.logo-lg{width:58px;height:58px;padding:11px}.logo-sm{width:40px;height:40px;padding:8px;border-radius:11px}img.logo{object-fit:contain;background:none;padding:0;box-shadow:none}img.logo-lg{width:112px;height:60px}img.logo-sm{width:64px;height:38px}
.bar{height:14px;border-radius:10px;position:relative;margin:18px 0 12px}.bar-money{background:linear-gradient(90deg,#f5304a,#c7686a 30%,#7aa79a 62%,#17e08b)}.bar-energy{background:linear-gradient(90deg,#ffb02a,#d7c64b 45%,#5bd77d 70%,#17e08b)}
.bar i{position:absolute;top:-6px;width:5px;height:26px;border-radius:4px;background:#f4fbff;transform:translateX(-50%);box-shadow:0 0 8px #fff8}
.delta{display:inline-flex;align-items:center;gap:2px;font-weight:700;font-size:17px;margin-top:6px}.delta ha-icon{width:18px;height:18px}
.spark{display:block;width:100%}.nohist{display:flex;align-items:flex-end;justify-content:flex-end;color:#58778c;font-size:10px}.nohist.big{align-items:center;justify-content:center;height:180px;font-size:13px;text-align:center}
.link{cursor:pointer;transition:border-color .15s}.link:hover{border-color:#2f6fa3}
/* Lovelace / aside tiles */
.tile{padding:16px 18px;overflow:hidden}
.t-head{display:flex;align-items:center;gap:12px}.t-title{font-size:15px;font-weight:600;flex:1}.chev{width:22px;height:22px;color:var(--mut)}
.t-feature .t-center{text-align:center;margin-top:4px}.v-xl{font-size:28px;font-weight:800;letter-spacing:-.4px}.v-lg{font-size:25px;font-weight:800;letter-spacing:-.3px}.v-md{font-size:19px;font-weight:800;letter-spacing:-.2px}
.split{display:flex;justify-content:space-between;gap:10px;align-items:flex-end}.split>div{min-width:0}
.t-mini{display:flex;align-items:flex-start;gap:16px;min-height:126px}.t-mini .t-body{flex:1;min-width:0;padding-top:4px;position:relative;z-index:1}.t-mini .muted{margin-top:6px;font-size:14px}.t-mini .t-spark{position:absolute;right:14px;bottom:12px;width:36%}.t-foot .t-spark{flex:0 0 30%;align-self:flex-end}.v-lg,.v-md,.v-xl{white-space:nowrap}
.t-summary .split{margin-top:12px}.t-summary .bar{margin:14px 0 6px}.t-foot{display:flex;align-items:center;gap:12px;margin-top:16px}.t-foot .t-body{flex:1;min-width:0;white-space:nowrap}
/* Compact 3-column card – sizes measured from the 396x161 px mockup (Roboto, as in HA) */
.t-compact{padding:14px 13px 0 17px;height:161px;border-radius:14px;border:1px solid #1b2e3c;background:linear-gradient(160deg,#0c1d2a 0%,#0a1824 55%,#081520 100%);font-family:var(--pge-font)}
.c-head{display:flex;align-items:center;gap:13px;height:40px;margin-bottom:13px}
.logo-md{width:36px;height:36px;padding:7px;border-radius:10px}img.logo-md{width:66px;height:36px;object-fit:contain;object-position:left center}
.c-title{font-size:16px;font-weight:700;line-height:20px;letter-spacing:-.1px;color:#f3f7fa}.c-month{color:#8fadc4;font-size:11.5px;line-height:15px;margin-top:3px}
.c-grid{display:grid;grid-template-columns:.95fr 1fr 1fr;height:84px;margin-left:-4px}
.c-cell{min-width:0;position:relative;padding:0 0 0 5px;border-left:1px solid #1a2c3a}.c-cell:first-child{border-left:0;padding-left:0}
.c-row{display:flex;align-items:flex-start;gap:5px}
.c-ic{flex:0 0 40px;width:40px;height:40px;border-radius:50%;padding:8px;display:grid;place-items:center}
.c-ic svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.c-orange{color:#f5a41d;background:#2c2820}.c-blue{color:#2386ff;background:#0a2240}.c-green{color:#14d982;background:#0b2a26}
.c-txt{min-width:0;padding-top:4px}.c-label{font-size:11.5px;line-height:15px;color:#d9e3ea}
.c-val{font-size:16px;line-height:20px;font-weight:700;letter-spacing:-.6px;white-space:nowrap;margin-top:2px;color:#f6f9fb}.c-val.t-green{color:#21e08a}.c-val.t-red{color:#ff4757}.c-val small{font-size:12px;font-weight:500;letter-spacing:0}
.c-extra .delta{font-size:12.5px;font-weight:700;margin-top:4px;gap:3px;color:#ff3b45}.c-extra .delta ha-icon{width:13px;height:13px}
.c-spark{position:absolute;bottom:1px;left:15px;right:10px}.c-cell:first-child .c-spark{left:45px;right:8px;height:26px}
.c-spark .spark{height:34px!important}.c-cell:last-child .c-spark{right:0}.c-cell:first-child .c-spark .spark{height:26px!important}.c-spark .nohist{height:26px!important}
@container (max-width:380px){.t-compact{height:auto;padding-bottom:8px}.c-grid{grid-template-columns:repeat(3,minmax(0,1fr));height:auto}.c-cell{padding-bottom:36px}.c-row{flex-direction:column;gap:6px}.c-ic{flex-basis:32px;width:32px;height:32px;padding:7px}.c-ic svg{width:18px;height:18px}.c-val{font-size:14px}.c-spark,.c-cell:first-child .c-spark{left:4px;right:6px}}
/* Flow chart card */
.fc{margin-top:13px;padding:16px 16px 14px}.fc-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fc-ctrl{display:flex;align-items:center;gap:8px;margin:14px 0 6px;flex-wrap:wrap}
.fc-btn{all:unset;box-sizing:border-box;cursor:pointer;height:38px;padding:0 12px;border-radius:9px;border:1px solid #1d3a54;background:#0c1f30;color:var(--txt);font-size:13px;display:inline-grid;place-items:center;white-space:nowrap}
.fc-btn:hover{border-color:#3a77b8}.fc-btn.on{background:#2a8cff;border-color:#2a8cff;color:#fff;font-weight:600;box-shadow:0 0 14px #2a8cff55}.fc-btn[disabled]{opacity:.35;cursor:default}
.fc-arrow{width:44px;padding:0;border-color:#2f6cb3;background:#0f2a49}.fc-arrow ha-icon{width:22px;height:22px}
.fc-modes{display:flex;gap:8px}.fc-mode{min-width:64px}
.fc-sep{width:1px;height:30px;background:#244056;margin:0 2px}
.fc-date{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px 0 6px;border:1px solid #2a4f70;border-radius:9px;background:#0c1f30;min-width:150px;flex:1 1 160px;max-width:185px}
.fc-date .ic{width:28px;height:28px;padding:4px;border-radius:7px}.fc-date>span:not(.ic){display:flex;flex-direction:column;flex:1;min-width:0}.fc-date small{font-size:10.5px;color:var(--mut2);line-height:1}
.fc-date{position:relative;cursor:pointer}.fc-dv{font:600 13.5px var(--pge-font);color:var(--txt)}.fc-date input{position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;color-scheme:dark}.fc-date input::-webkit-calendar-picker-indicator{display:none}
.fc-x{all:unset;cursor:pointer;color:var(--mut2);font-size:18px;padding:0 4px}.fc-x:hover{color:#fff}
.fc-plot{position:relative;margin-top:6px}.fc-svg{display:block;width:100%;height:auto}
.fc-svg text{fill:#c3d1dc;font-size:14px}.fc-svg .unit{font-size:15px}.fc-svg .grid{stroke:#173044}.fc-svg .vgrid{stroke:#11273a;stroke-dasharray:3 4}.fc-svg .zero{stroke:#2b5470;stroke-width:1.2}
.fc-svg .day{cursor:pointer}.fc-svg .day.fut{cursor:default}.fc-svg .day rect:not(.hit){transition:opacity .12s,filter .12s}.fc-svg.focus .day:not(.sel) rect:not(.hit){opacity:.45}.fc-svg .day.sel rect:not(.hit){filter:brightness(1.25)}
.fc-svg .cursor{display:none;pointer-events:none}.fc-svg .cl{stroke:#e8f1f8;stroke-dasharray:4 4;stroke-width:1.2}.fc-svg .ci,.fc-svg .ce{fill:#0b1a27;stroke:#fff;stroke-width:2}
.fc-tip{position:absolute;top:-6px;transform:translateX(-50%);background:#0d1c2a;border:1px solid #2b4459;border-radius:9px;padding:9px 12px;font-size:12.5px;pointer-events:none;box-shadow:0 8px 20px #0007;min-width:200px;z-index:2}
.fc-tip .tt{font-weight:700;margin-bottom:5px}.fc-tip div{display:flex;align-items:center;gap:7px;margin-top:3px;white-space:nowrap}.fc-tip b{width:10px;height:10px;border-radius:50%;display:inline-block}.fc-tip span{margin-left:auto;padding-left:14px;font-weight:700}.fc-tip .hint{color:var(--mut);font-size:10.5px;margin-top:6px}
.fc-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:10px}
.fc-tile{border:1px solid #17304a;border-radius:12px;background:linear-gradient(150deg,#0d2131,#0a1a27);padding:12px 14px 10px;min-width:0}
.fc-tile{display:grid;grid-template-columns:auto minmax(0,1fr) 42%;column-gap:10px}.fc-tile-top{display:contents}.fc-ic{width:38px;height:38px;padding:2px;grid-row:1}.fc-tile-txt{min-width:0;grid-row:1;grid-column:2/4}.fc-tile-txt .muted2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fc-val{font-size:clamp(17px,1.6vw,22px);font-weight:800;margin-top:3px;white-space:nowrap}.fc-spark{grid-column:3;grid-row:2;align-self:end}.fc-spark .spark{height:40px!important}
.fc-avg{display:flex;flex-direction:column;margin-top:6px;grid-column:1/3;grid-row:2}.fc-avg b{font-size:14px;margin-top:2px}
@media(max-width:1250px){.fc-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:1000px){.fc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.fc-sep{display:none}}
@media(max-width:600px){.fc-tiles{grid-template-columns:1fr}.fc-ctrl{display:grid;grid-template-columns:40px minmax(0,1fr) minmax(0,1fr) 40px;gap:6px}.fc-date{max-width:none;min-width:0;padding-right:4px}.fc-date .ic{display:none}.fc-arrow{width:40px}.fc-modes{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.fc-mode{min-width:0}.fc-today{grid-column:1/4}.fc-plot{overflow-x:auto}.fc-svg{min-width:680px}.fc-tip{position:fixed;top:auto;bottom:16px;left:50%!important}}
/* Panel */
.pf{min-height:100vh;background:radial-gradient(ellipse at 40% -10%,#0b2233 0%,var(--bg) 60%);padding:16px 17px 24px}
.pf-grid>*{min-width:0}.pf-grid{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:27px;max-width:1700px;margin:0 auto}
.pf-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px;min-height:74px}.pf-brand{display:flex;align-items:center;gap:16px}
.pf-brand h1{font-size:27px;margin:0;font-weight:700;letter-spacing:-.4px}.pf-sub{color:var(--mut);font-size:13px;margin-top:4px}
.pf-date{background:#0c1f2e;border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:270px}
.pf-date-row{display:flex;align-items:center;gap:10px;font-size:15px}.pf-date-row .ic{width:26px;height:26px;padding:3px;border-radius:7px}.pf-date-row .lbl{flex:1}
.nav{all:unset;cursor:pointer;width:26px;height:26px;color:var(--mut2);border-radius:6px}.nav:hover{background:#163246}.nav[disabled]{opacity:.25;cursor:default;background:none}
.pf-upd{font-size:13px;color:var(--mut2);margin-top:8px;display:flex;align-items:center;gap:8px}.pf-upd i{width:9px;height:9px;border-radius:50%;background:var(--g);box-shadow:0 0 6px var(--g)}.pf-upd i.stale{background:#e2a12c;box-shadow:none}
.top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.top .box{padding:14px 16px 12px;min-height:188px;display:flex;flex-direction:column}
.k-head{display:flex;align-items:flex-start;gap:16px}.k-head .ic{width:54px;height:54px;padding:11px;border-radius:14px}.k-head .ic svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.k-label{font-size:13px;white-space:nowrap;color:var(--mut2);display:flex;align-items:center;gap:6px;padding-top:6px}.info{width:17px;height:17px;color:var(--mut);cursor:help}
.k-val{font-size:clamp(26px,2.6vw,36px);font-weight:800;letter-spacing:-.6px;margin-top:6px;white-space:nowrap}.k-sub{color:var(--mut2);font-size:14px;margin-top:4px}
.k-bottom{display:flex;align-items:flex-end;gap:8px;margin-top:auto}.k-bottom>div:first-child{flex:1;min-width:0;white-space:nowrap}.k-bottom .spark-wrap{flex:0 0 40%}
.k-ends{display:flex;justify-content:space-between;font-size:14px;font-weight:600}.k-ends small{display:block;font-weight:400;color:var(--mut);font-size:12px}
.dep{margin-top:13px;padding:14px 14px 12px}.dep h3{margin-bottom:12px}
.dep-row{display:grid;grid-template-columns:1fr 26px 1fr 26px 1fr;align-items:stretch;gap:6px}
.dep-arrow{display:grid;place-items:center;color:var(--mut2)}.dep-arrow ha-icon{width:20px;height:20px}
.dep-card{border:1px solid #17304a;border-radius:12px;padding:12px 16px 10px;background:linear-gradient(150deg,#0d2131,#0a1a27);min-width:0}
.dep-card.dep-cur{border:1.5px solid #3d7fd6;background:linear-gradient(150deg,#10284a,#0b1c33);box-shadow:0 0 18px #2f6fd033}
.dep-top{display:flex;gap:14px;align-items:flex-start;margin-bottom:6px}.dep-top .ic{width:46px;height:46px;padding:10px;border-radius:12px}
.ic-indigo{color:#7f8cff;background:linear-gradient(145deg,#26286b,#1a1c4d)}
.dep-kicker{font-size:12px;color:var(--mut2)}.dep-title{font-size:14.5px;font-weight:700;margin-top:3px}.dep-val{font-size:22px;font-weight:800;margin-top:6px;letter-spacing:-.3px;white-space:nowrap}
.dep-line{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--mut2);margin-top:6px;white-space:nowrap}.dep-line b{color:var(--txt);font-weight:600}
@media(max-width:820px){.dep-row{grid-template-columns:1fr}.dep-arrow{transform:rotate(90deg);height:20px}}
.mid{display:grid;grid-template-columns:minmax(0,1fr) 258px;gap:13px;margin-top:13px}
.chart{padding:16px 16px 8px}.chart-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
h3{margin:0;font-size:16px;font-weight:700}h3 span{font-weight:400;color:var(--mut2)}.legend{font-size:13px;color:var(--mut2);display:flex;gap:16px}.legend b{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.flow{width:100%;height:auto;display:block;margin-top:8px}.flow .day{cursor:pointer}.flow .day rect:not(.hit){transition:opacity .12s}.flow.focus .day:not(.sel) rect:not(.hit){opacity:.3}.flow .day.sel text{fill:#fff;font-weight:700}.scope{color:var(--b);font-weight:500}.flow text{fill:#c3d1dc;font-size:11px}.flow .unit{fill:#c3d1dc}.flow .grid{stroke:#173044;stroke-width:1}.flow .zero{stroke:#2b5470;stroke-width:1.2}
.stack{display:grid;gap:12px;grid-auto-rows:1fr}.stack .box{display:flex;align-items:center;gap:14px;padding:12px 14px}.stack .s-body{flex:1;min-width:0;white-space:nowrap}.stack .s-body .muted2{font-size:12.5px}.stack .s-val{font-size:16px;font-weight:700;margin-top:3px;white-space:nowrap}.stack .spark-wrap{flex:0 0 64px}.stack .box{gap:10px;padding:10px 12px}
.bot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-top:13px}.bot .box{padding:12px 14px 8px;min-height:110px;display:flex;gap:14px}.bot .ic{width:36px;height:36px;padding:5px}.bot .b-body{flex:1;min-width:0;display:flex;flex-direction:column}
.b-val{font-size:clamp(19px,1.7vw,25px);font-weight:700;margin-top:6px;white-space:nowrap}.b-note{font-size:13px;color:var(--mut2)}.bot .delta{font-size:15px}.b-foot{display:flex;align-items:flex-end;gap:6px;margin-top:8px;flex:1;position:relative;min-height:48px}.b-foot>div:first-child{align-self:flex-start}.b-foot>div:first-child{flex:1;position:relative;z-index:1}.b-foot .b-note{white-space:nowrap;font-size:12px}.b-foot .spark-wrap{position:absolute;right:0;bottom:0;width:42%}
.zone{display:flex;align-items:center;gap:10px;margin-top:auto}.zone .ic{width:34px;height:34px;padding:4px}
.hist{cursor:pointer;transition:border-color .15s,background .15s}.hist:hover,.hist:focus-visible{border-color:#3b8cff;outline:none}tr.hist:hover td,tr.hist:focus-visible td{background:rgba(59,140,255,.08)}
.tables{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:13px}.tables .box{padding:16px 16px 6px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}th{font-weight:400;color:var(--mut2);text-align:right;padding:6px 6px;background:#0f2536}td{text-align:right;padding:6px 6px;border-bottom:1px solid #132b3c;white-space:nowrap}tr:last-child td{border-bottom:0}th:first-child,td:first-child{text-align:left}
.aside h2{font-size:19px;font-weight:500;margin:6px 0 16px}.aside .tile{margin-bottom:14px}
.foot{color:#6f8ca0;font-size:11px;margin-top:14px;max-width:1700px;margin-left:auto;margin-right:auto}
.warn{background:#2a1d0c;border:1px solid #5a3d12;color:#ffcf80;border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:13px}
@media(max-width:1100px){.pf-grid{grid-template-columns:minmax(0,1fr)}.aside{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}.aside h2{grid-column:1/-1;margin:0}.aside .tile{margin:0}}
@media(max-width:1000px){.bot{grid-template-columns:repeat(2,minmax(0,1fr))}.mid{grid-template-columns:1fr}.stack{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:820px){.pf{padding:12px}.top,.tables,.stack{grid-template-columns:1fr}.pf-head{flex-wrap:wrap}.pf-date{min-width:0;width:100%}.top .box{min-height:0}}
@media(max-width:480px){.bot{grid-template-columns:1fr}.k-val{font-size:28px}.tables .box{overflow-x:auto}table{font-size:11.5px}td,th{padding:8px 3px}.flow{min-height:170px}.flow text{font-size:15px}}
`;

/* ---------- optional Inter font: `font: inter` in card config (default = HA's Roboto) ---------- */
function ensureFont(config) {
  if (config?.font !== "inter" || document.getElementById("pge-inter-font")) return;
  const l = document.createElement("link");
  l.id = "pge-inter-font"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(l);
}

/* ---------- base element ---------- */
class PGEBase extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._offset = 0; this._raw = null; this._sig = ""; }
  setConfig(config) { this._config = config || {}; ensureFont(this._config); this._sig = ""; this._refresh(); }
  set hass(h) {
    if (!this._font) { this._font = true; ensureFont(this._config); }
    this._hass = h;
    this._ids = resolveEntities(h, this._config);
    const sig = KEYS.map(k => { const s = h?.states?.[this._ids[k]]; return s ? s.state + s.last_updated : "-"; }).join("|") + this._offset;
    if (sig !== this._sig) { this._sig = sig; this._refresh(); }
  }
  get hass() { return this._hass; }
  async _refresh() {
    if (!this._hass) return;
    const w = statWindow(this._offset);
    const p = loadStats(this._hass, this._ids, w.start, w.end);
    this._draw();
    const raw = await p;
    if (raw && raw !== this._raw) { this._raw = raw; this._draw(); }
  }
  _model() { return buildModel(this._hass, this._ids || {}, this._raw, this._offset); }
  _go() { if (location.pathname === PANEL_PATH) return; history.pushState(null, "", PANEL_PATH); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
  _bindLinks() { this.shadowRoot.querySelectorAll(".link").forEach(el => { el.tabIndex = 0; el.setAttribute("role", "link"); el.onclick = () => this._go(); el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._go(); } }; }); }
}

/* ---------- Lovelace cards ---------- */
const CARDS = [
  ["pge-net-billing-card", "compact", "PGE Net-Billing – kafelek", "Rachunek, saldo i bilans w trzech kolumnach z wykresami"],
  ["pge-net-billing-feature-card", "deposit", "PGE Net-Billing – saldo depozytu", "Duży kafelek: saldo depozytu, rachunek, bilans"],
  ["pge-net-billing-invoice-card", "invoice", "PGE Net-Billing – rachunek", "Rachunek miesiąca z trendem"],
  ["pge-net-billing-balance-card", "balance", "PGE Net-Billing – bilans energii", "Bilans kWh z wykresem"],
  ["pge-net-billing-deposit-card", "wallet", "PGE Net-Billing – depozyt (mały)", "Saldo depozytu z wykresem"],
  ["pge-net-billing-summary-card", "summary", "PGE Net-Billing – podsumowanie", "Pobrano / oddano / bilans / saldo / rachunek"],
];
for (const [tag, variant, name, description] of CARDS) {
  const cls = class extends PGEBase {
    static getStubConfig() { return { type: "custom:" + tag }; }
    getCardSize() { return variant === "deposit" || variant === "summary" ? 4 : variant === "compact" ? 3 : 2; }
    _draw() {
      const m = this._model();
      const v = this._config.variant || variant;
      const body = m.found ? (TILES[v] || TILES.deposit)(m, this._config) : `<div class="tile">Nie znaleziono encji integracji PGE Net-Billing.</div>`;
      this.shadowRoot.innerHTML = `<style>${CSS}</style>${body}`;
      this._bindLinks();
    }
  };
  if (!customElements.get(tag)) customElements.define(tag, cls);
  else console.warn(`PGE Net-Billing v${VERSION}: <${tag}> was already defined by an OLDER copy of this script (leftover Lovelace resource?) – the card will show the old look until it is removed.`);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: true });
}

/* ---------- full panel ---------- */
/* ---------- flow chart card: period picker, hover tooltip, click = drill down ---------- */
const CUM_KEYS = ["import_s1", "import_s2", "export_kwh", "energy_cost", "export_value"];
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plDate = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const fromIso = s => { const [y, m, d] = String(s).split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const MODES = [["day", "Dzień"], ["week", "Tydzień"], ["month", "Miesiąc"], ["year", "Rok"]];
function periodFor(start, end) {
  const days = Math.round((end - start) / 864e5);
  return days <= 2 ? "hour" : days <= 92 ? "day" : "month";
}
function makeRange(mode, anchor, start, end) {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (mode === "day") { start = a; end = addDays(a, 1); }
  else if (mode === "week") { start = addDays(a, -((a.getDay() + 6) % 7)); end = addDays(start, 7); }
  else if (mode === "month") { start = new Date(a.getFullYear(), a.getMonth(), 1); end = new Date(a.getFullYear(), a.getMonth() + 1, 1); }
  else if (mode === "year") { start = new Date(a.getFullYear(), 0, 1); end = new Date(a.getFullYear() + 1, 0, 1); }
  return { mode, start, end, period: periodFor(start, end) };
}
function shiftRange(r, dir) {
  if (r.mode === "day") return makeRange("day", addDays(r.start, dir));
  if (r.mode === "week") return makeRange("week", addDays(r.start, 7 * dir));
  if (r.mode === "month") return makeRange("month", new Date(r.start.getFullYear(), r.start.getMonth() + dir, 1));
  if (r.mode === "year") return makeRange("year", new Date(r.start.getFullYear() + dir, 0, 1));
  const span = Math.round((r.end - r.start) / 864e5);
  return makeRange("custom", r.start, addDays(r.start, span * dir), addDays(r.end, span * dir));
}
function buildChart(hass, ids, raw, r, m) {
  const now = new Date(), vat = m.vat, per = r.period;
  const keyOf = d => per === "hour" ? dayKey(d) + "T" + pad(d.getHours()) : per === "day" ? dayKey(d) : monthKey(d);
  const val = k => { const s = hass?.states?.[ids[k]]; return s && isNum(s.state) ? Number(s.state) : null; };
  const rows = {};
  for (const k of CUM_KEYS) for (const x of raw?.[ids[k]] || []) {
    const d = new Date(typeof x.start === "number" ? x.start : Date.parse(x.start));
    const row = rows[keyOf(d)] ||= { st: {} };
    row[k] = x.change; row.st[k] = x.state;
  }
  const pack = o => {
    const i = (isNum(o.import_s1) || isNum(o.import_s2)) ? (Number(o.import_s1) || 0) + (Number(o.import_s2) || 0) : null;
    return { imp: i, exp: isNum(o.export_kwh) ? Number(o.export_kwh) : null, cost: isNum(o.energy_cost) ? o.energy_cost * (1 + vat) : null, sell: isNum(o.export_value) ? Number(o.export_value) : null };
  };
  const out = [];
  for (let d = new Date(r.start); d < r.end;) {
    const nx = per === "hour" ? new Date(d.getTime() + 36e5) : per === "day" ? addDays(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const row = rows[keyOf(d)];
    let v = row ? pack(row) : null;
    const live = d <= now && nx > now;
    if (live && per === "day" && m.todayV) v = m.todayV;                      // today up to now
    if (live && per === "month" && m.isCurrent) v = { imp: m.month.imp, exp: m.month.exp, cost: m.month.cost, sell: m.month.sell };
    if (live && per === "hour" && !row) {                                       // current hour up to now
      const p = rows[keyOf(new Date(d.getTime() - 36e5))];
      if (p) { const o = {}; for (const k of CUM_KEYS) { const c = val(k); if (isNum(c) && isNum(p.st[k]) && c >= p.st[k]) o[k] = c - p.st[k]; } v = pack(o); }
    }
    const tip = per === "hour" ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:00–${pad(nx.getHours() || 24)}:00`
      : per === "day" ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}${live ? " (do teraz)" : ""}` : monthName(d);
    const l1 = per === "hour" ? pad(d.getHours()) : per === "day" ? pad(d.getDate()) : MONTH_SHORT[d.getMonth()];
    const l2 = per === "hour" ? "" : per === "day" ? MONTH_SHORT[d.getMonth()] : String(d.getFullYear()).slice(2);
    if (v && (isNum(v.sell) || isNum(v.cost))) v = { ...v, profit: (Number(v.sell) || 0) - (Number(v.cost) || 0) };
    out.push({ d, nx, v: d > now ? null : v, future: d > now, live, tip, l1, l2 });
    d = nx;
  }
  const tot = { imp: 0, exp: 0, cost: 0, sell: 0, profit: 0 }, any = { imp: 0, exp: 0, cost: 0, sell: 0, profit: 0 };
  for (const b of out) for (const k in tot) if (isNum(b.v?.[k])) { tot[k] += b.v[k]; any[k]++; }
  for (const k in tot) if (!any[k]) tot[k] = null;
  const elapsedEnd = new Date(Math.min(r.end, now));
  const units = per === "hour" ? Math.max(1, (elapsedEnd - r.start) / 36e5) : Math.max(1, Math.ceil((elapsedEnd - r.start) / 864e5));
  const avg = {}; for (const k in tot) avg[k] = isNum(tot[k]) ? tot[k] / units : null;
  return { r, per, buckets: out, tot, avg, avgLabel: per === "hour" ? "Średnio na godzinę" : "Średnio dziennie", loading: !raw };
}
function barSpark(values, color, w = 90, h = 50, signed = false, neg = TONE.red) {
  if (signed) {
    const v = values.map(x => isNum(x) ? Number(x) : 0);
    if (!v.some(Boolean)) return `<div class="nohist" style="height:${h}px">brak danych</div>`;
    const hi = Math.max(0, ...v), lo = Math.min(0, ...v), span = hi - lo || 1, bw = w / v.length, y0 = hi / span * h;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px"><line x1="0" x2="${w}" y1="${y0}" y2="${y0}" stroke="#2b5470" stroke-width=".6"/>${v.map((x, i) => { const hh = Math.abs(x) / span * h; return `<rect x="${(i * bw + bw * .2).toFixed(2)}" y="${(x >= 0 ? y0 - hh : y0).toFixed(2)}" width="${(bw * .6).toFixed(2)}" height="${hh.toFixed(2)}" fill="${x >= 0 ? color : neg}" opacity=".85"/>`; }).join("")}</svg>`;
  }
  const v = values.map(x => isNum(x) ? Math.abs(Number(x)) : 0);
  if (!v.some(Boolean)) return `<div class="nohist" style="height:${h}px">brak danych</div>`;
  const max = Math.max(...v), bw = w / v.length;
  const id = "bs" + (++gid);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".15"/></linearGradient></defs>${v.map((x, i) => `<rect x="${(i * bw + bw * .2).toFixed(2)}" y="${(h - x / max * h).toFixed(2)}" width="${(bw * .6).toFixed(2)}" height="${(x / max * h).toFixed(2)}" fill="url(#${id})"/>`).join("")}</svg>`;
}
function flowSvg(ch) {
  const W = 1000, H = 300, L = 46, R = 8, T = 30, B = 52;
  const b = ch.buckets, n = b.length;
  const maxI = Math.max(0, ...b.map(x => Number(x.v?.imp) || 0)), maxE = Math.max(0, ...b.map(x => Number(x.v?.exp) || 0));
  const span = Math.max(1, maxI + maxE);
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => (Math.ceil(maxI / s) + Math.ceil(maxE / s)) <= 6 && s * 4 >= span / 2) || 10000;
  const top = Math.max(step, Math.ceil(maxI / step) * step), bot = Math.max(step, Math.ceil(maxE / step) * step);
  const y = v => T + (top - v) / (top + bot) * (H - T - B);
  const slot = (W - L - R) / n, bw = Math.min(34, slot * .64);
  const every = n > 40 ? Math.ceil(n / 24) : 1;
  let g = "";
  for (let v = -bot; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${Math.abs(v) < 1e-9 ? "zero" : "grid"}"/><text x="${L - 8}" y="${y(v) + 5}" text-anchor="end" class="ax">${+v.toFixed(2)}</text>`;
  for (let i = 0; i <= n; i++) g += `<line x1="${L + slot * i}" x2="${L + slot * i}" y1="${T}" y2="${H - B}" class="vgrid"/>`;
  const days = b.map((x, i) => {
    const cx = L + slot * i + slot / 2, a = Number(x.v?.imp) || 0, e = Number(x.v?.exp) || 0;
    const lab = i % every ? "" : `<text x="${cx}" y="${H - B + 22}" text-anchor="middle" class="xl">${x.l1}</text>${x.l2 ? `<text x="${cx}" y="${H - B + 40}" text-anchor="middle" class="xl">${x.l2}</text>` : ""}`;
    return `<g class="day${x.future ? " fut" : ""}" data-i="${i}" data-x="${cx}" data-yi="${y(a)}" data-ye="${y(-e)}"><rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B + 44}" fill="transparent"/><rect class="bi" x="${cx - bw / 2}" y="${y(a)}" width="${bw}" height="${Math.max(0, y(0) - y(a))}" rx="3" fill="url(#gImp)"/><rect class="be" x="${cx - bw / 2}" y="${y(0) + 1}" width="${bw}" height="${Math.max(0, y(-e) - y(0) - 1)}" rx="3" fill="url(#gExp)"/>${lab}</g>`;
  }).join("");
  return `<svg class="fc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb935"/><stop offset="1" stop-color="#f08b12"/></linearGradient><linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13c983"/><stop offset="1" stop-color="#2cf2a6"/></linearGradient></defs><text x="4" y="16" class="unit">kWh</text>${g}${days}<g class="cursor"><line class="cl" y1="${T}" y2="${H - B}"/><circle class="ci" r="6"/><circle class="ce" r="6"/></g></svg>`;
}
function rangeLabel(r) {
  const e = addDays(r.end, -1);
  if (r.mode === "day") return plDate(r.start);
  if (r.mode === "month") return monthName(r.start).toLowerCase();
  if (r.mode === "year") return `rok ${r.start.getFullYear()}`;
  return `${pad(r.start.getDate())}.${pad(r.start.getMonth() + 1)}–${plDate(e)}`;
}
function balView(v) {
  const i = v?.imp, e = v?.exp, b = isNum(i) && isNum(e) ? e - i : null;
  return { i, e, b, cls: isNum(b) && b < 0 ? "t-red" : "t-green", sub: !isNum(b) ? "Brak danych" : b >= 0 ? "Więcej oddano niż pobrano" : "Więcej pobrano niż oddano", pct: energyPct(i, e) };
}
function chartCard(ch) {
  const r = ch.r, endIncl = addDays(r.end, -1), now = new Date();
  const tile = (k, ic, tone, label, value, cls, color, tip = "") => `<div class="fc-tile hist" data-hist="${k}" tabindex="0" role="button" title="${esc((tip ? tip + " " : "") + "Kliknij: historia")}"><div class="fc-tile-top">${icon(ic, tone, "ic-plain fc-ic")}<div class="fc-tile-txt"><div class="muted2">${label}</div><div class="fc-val ${typeof cls === "function" ? cls(ch.tot[k]) : cls}" data-c="${k}">${value(ch.tot[k])}</div></div><div class="fc-spark">${barSpark(ch.buckets.map(b => b.v?.[k]), color, 90, 50, k === "profit")}</div></div><div class="fc-avg"><span class="muted2">${ch.avgLabel}</span><b data-a="${k}">${value(ch.avg[k])}</b></div></div>`;
  return `<section class="box fc">
  <div class="fc-head"><h3>Przepływ energii <span>(wybrany okres)</span></h3><div class="legend"><span><b style="background:var(--o)"></b>Pobór z sieci</span><span><b style="background:var(--g)"></b>Oddanie do sieci</span></div></div>
  <div class="fc-ctrl">
    <button class="fc-btn fc-arrow" data-shift="-1" aria-label="Wcześniej"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
    <label class="fc-date">${icon("calendar-month", "blue")}<span><small>Od</small><b class="fc-dv">${plDate(r.start)}</b><input type="date" data-f="from" value="${isoDate(r.start)}" tabindex="-1"></span><button class="fc-x" data-x="from" aria-label="Wyczyść">×</button></label>
    <label class="fc-date">${icon("calendar-month", "blue")}<span><small>Do</small><b class="fc-dv">${plDate(endIncl)}</b><input type="date" data-f="to" value="${isoDate(endIncl)}" tabindex="-1"></span><button class="fc-x" data-x="to" aria-label="Wyczyść">×</button></label>
    <button class="fc-btn fc-arrow" data-shift="1" ${r.end > now ? "disabled" : ""} aria-label="Później"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
    <span class="fc-sep"></span>
    <div class="fc-modes">${MODES.map(([k, l]) => `<button class="fc-btn fc-mode${r.mode === k ? " on" : ""}" data-mode="${k}">${l}</button>`).join("")}</div>
    <span class="fc-sep"></span>
    <button class="fc-btn fc-today" data-today="1">Dzisiaj</button>
    <button class="fc-btn fc-arrow fc-cal" data-cal="1" aria-label="Wybierz zakres"><ha-icon icon="mdi:calendar-month"></ha-icon></button>
  </div>
  <div class="fc-plot">${ch.loading ? `<div class="nohist big">Ładowanie…</div>` : ch.buckets.some(b => b.v) ? flowSvg(ch) : `<div class="nohist big">Brak danych w tym okresie</div>`}<div class="fc-tip" hidden></div></div>
  <div class="fc-tiles">
    ${tile("imp", "lightning-bolt", "orange", "Pobór z sieci", v => kwh(v), "t-orange", TONE.orange)}
    ${tile("exp", "arrow-up", "green", "Oddanie do sieci", v => isNum(v) ? kwh(-v) : "—", "t-green", TONE.green)}
    ${tile("sell", "database-outline", "blue", "Wartość sprzedaży (RCE)", v => zl(v), "", TONE.blue)}
    ${tile("cost", "cart", "red", "Koszt zakupu energii", v => zl(v), "t-red", TONE.red)}
    ${tile("profit", "scale-balance", "green", "Zysk / strata", v => zl(v, true), v => isNum(v) && v < 0 ? "t-red" : "t-green", TONE.green, "Wartość sprzedaży (RCE, trafia do depozytu) − koszt zakupu energii brutto w wybranym okresie. Bez dystrybucji i opłat stałych, bez oszczędności z autokonsumpcji.")}
  </div>
</section>`;
}

/* ---------- history modal: click a tile -> history + already published future (v1.5.0) ---------- */
const g12Zone = d => { const mo = d.getMonth() + 1, h = d.getHours(), summer = mo >= 4 && mo <= 9; return h >= 22 || h < 6 || (summer ? h >= 15 && h < 17 : h >= 13 && h < 15) ? "s2" : "s1"; };
const pricePL = v => isNum(v) ? NF4.format(v) + " zł/kWh" : "—";
const HIST = {
  imp: { title: "Pobór z sieci", tone: TONE.orange, kind: "energy", fmt: v => kwh(v), note: "Pomiary z licznika (Recorder HA). Przyszłości nie ma – to tylko to, co już przepłynęło." },
  exp: { title: "Oddanie do sieci", tone: TONE.green, kind: "energy", fmt: v => kwh(v), note: "Pomiary z licznika (Recorder HA). Przyszłości nie ma – to tylko to, co już przepłynęło." },
  sell: { title: "Wartość sprzedaży (RCE)", tone: TONE.blue, kind: "energy", fmt: v => zl(v), note: "Oddana energia × RCE × współczynnik. Liczone dla minionych okresów." },
  cost: { title: "Koszt zakupu energii (brutto)", tone: TONE.red, kind: "energy", fmt: v => zl(v), note: "Energia czynna brutto, bez dystrybucji i opłat stałych. Liczone dla minionych okresów." },
  profit: { title: "Zysk / strata", tone: TONE.green, kind: "energy", fmt: v => zl(v, true), signed: true, note: "Wartość sprzedaży (RCE) − koszt zakupu energii brutto." },
  bal: { title: "Bilans energii (oddano − pobrano)", tone: TONE.green, kind: "energy", fmt: v => kwh(v, true), signed: true, note: "Pomiary z licznika (Recorder HA): oddano minus pobrano. Przyszłości nie ma – to tylko to, co już przepłynęło." },
  invoice: { title: "Szacowana kwota rachunku – miesiące", tone: TONE.orange, kind: "months", fmt: v => zl(v), note: "Wyliczenie integracji ze zmierzonej energii: energia brutto − depozyt + dystrybucja + opłaty stałe. Bieżący miesiąc = stan na teraz (miesiąc niezakończony, bez dopowiadania reszty). To nie jest faktura PGE." },
  deposit: { title: "Depozyt prosumencki – miesiące", tone: TONE.green, kind: "months", fmt: v => zl(v), note: "Słupki = saldo dostępne w miesiącu (FIFO z policzonego eksportu). Jaśniejsze słupki w przyszłości = to, co już jest na koncie i dopiero wygaśnie – zakładając, że nic z tego nie zostanie zużyte. Nic nie jest dopowiadane." },
  rce: { title: "Cena RCE", tone: TONE.blue, kind: "rce", fmt: pricePL, note: "Ceny z PSE (RCE-PLN). Linia ciągła = historia, przerywana = ceny już opublikowane na przyszłość (D+1 ok. 14:30)." },
  tariff: { title: "Taryfa G12 – cena za kWh brutto", tone: TONE.orange, kind: "tariff", fmt: pricePL, note: "Harmonogram stref G12 jest znany z góry. Cena = energia + dystrybucja zmienna, brutto, wg obecnych stawek z konfiguracji (wstecz pokazuje dzisiejsze stawki)." },
};
const H_MODES = { energy: MODES, rce: MODES, tariff: MODES.slice(0, 3), months: [] };

function niceStep(span, n = 5) {
  const raw = Math.max(span, 1e-9) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
// items: [{t0, t1, v, fut, lab, lab2}] – x is TIME, so gaps (unpublished prices) stay visible
function histSvg(items, r, o) {
  const W = 1000, H = 320, L = 62, R = 10, T = 18, B = 50, t0 = +r.start, t1 = +r.end, now = Date.now();
  const X = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const vals = items.filter(i => isNum(i.v)).map(i => Number(i.v));
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (o.type === "step" && vals.length) { lo = Math.min(lo, ...vals); hi = Math.max(...vals); if (lo > 0) lo = 0; }
  const step = niceStep(hi - lo || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + step / 1e6; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${Math.abs(v) < step / 1e6 ? "zero" : "grid"}"/><text x="${L - 8}" y="${Y(v) + 5}" text-anchor="end" class="ax">${o.axis(v)}</text>`;
  if (o.until && +o.until < t1) g += `<rect x="${X(Math.max(t0, +o.until))}" y="${T}" width="${X(t1) - X(Math.max(t0, +o.until))}" height="${H - T - B}" class="unpub"/><text x="${(X(Math.max(t0, +o.until)) + X(t1)) / 2}" y="${T + 18}" text-anchor="middle" class="ax">jeszcze nieopublikowane</text>`;
  let marks = "";
  if (o.type === "bar") {
    marks = items.map((it, i) => {
      if (!isNum(it.v)) return "";
      const x0 = X(it.t0), w = Math.max(1, (X(it.t1) - x0) * .64), y = Y(Math.max(0, it.v)), h = Math.abs(Y(it.v) - Y(0));
      return `<rect class="mk" data-i="${i}" x="${x0 + (X(it.t1) - x0 - w) / 2}" y="${y}" width="${w}" height="${Math.max(h, .5)}" rx="${Math.min(3, w / 3)}" fill="${o.signed && it.v < 0 ? TONE.red : o.color}"${it.fut ? ' opacity=".4" stroke-dasharray="4 3" stroke="' + o.color + '"' : ""}/>`;
    }).join("");
  } else {
    const seg = fut => { let d = "", open = false;
      items.forEach(it => {
        if (!isNum(it.v) || it.fut !== fut) { open = false; return; }
        const y = Y(it.v); d += open ? `L${X(it.t0)} ${y}H${X(it.t1)}` : `M${X(it.t0)} ${y}H${X(it.t1)}`; open = true;
      }); return d; };
    const past = seg(false), fut = seg(true);
    marks = `${past ? `<path d="${past}" fill="none" stroke="${o.color}" stroke-width="2.2"/>` : ""}${fut ? `<path d="${fut}" fill="none" stroke="${o.color}" stroke-width="2.2" stroke-dasharray="7 5" opacity=".9"/>` : ""}`;
  }
  const labs = items.map(it => it.lab ? `<text x="${X(it.t0)}" y="${H - B + 20}" text-anchor="middle" class="xl">${it.lab}</text>${it.lab2 ? `<text x="${X(it.t0)}" y="${H - B + 38}" text-anchor="middle" class="xl">${it.lab2}</text>` : ""}` : "").join("");
  const nowL = now > t0 && now < t1 ? `<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}" class="nowl"/><text x="${X(now) + 5}" y="${T + 12}" class="nowt">teraz</text>` : "";
  const hits = items.map((it, i) => `<rect class="hit" data-i="${i}" x="${X(it.t0)}" y="${T}" width="${Math.max(1, X(it.t1) - X(it.t0))}" height="${H - T - B}" fill="transparent"/>`).join("");
  return `<svg class="hs" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><text x="4" y="12" class="unit">${o.unit}</text>${g}${marks}${labs}${nowL}<line class="hl" y1="${T}" y2="${H - B}" style="display:none"/>${hits}</svg>`;
}

class PGEHistory extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._key = e => { if (e.key === "Escape") this.close(); }; }
  open(panel, key, range) {
    this._p = panel; this._k = key; const h = HIST[key], now = new Date();
    const pr = range || panel._range;
    this._r = h.kind === "energy" && pr ? pr : makeRange(h.kind === "rce" && now.getHours() >= 15 ? "week" : "day", now);
    if (h.kind === "tariff" && !H_MODES.tariff.some(x => x[0] === this._r.mode)) this._r = makeRange("day", now);
    document.addEventListener("keydown", this._key);
    this._load();
  }
  close() { document.removeEventListener("keydown", this._key); this.remove(); }
  _set(r) { if (r && r.start < r.end) { this._r = r; this._load(); } }
  _limit() { // last day a range may start on
    const h = HIST[this._k], t = new Date(), d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return h.kind === "energy" ? t : h.kind === "rce" ? addDays(d0, 1) : addDays(d0, 400);
  }
  async _load() {
    const r = this._r, h = HIST[this._k], p = this._p, hass = p._hass, tok = this._tok = (this._tok || 0) + 1;
    this._d = null; this._draw();
    let d;
    try {
      if (h.kind === "energy") {
        const raw = r.start < new Date() ? await loadStats(hass, p._ids, r.start, new Date(Math.min(r.end, Date.now() + 36e5)), r.period) : {};
        const ch = buildChart(hass, p._ids, raw || {}, r, p._model());
        const k = this._k, pick = v => !v ? null : k === "bal" ? (isNum(v.imp) && isNum(v.exp) ? v.exp - v.imp : null) : v[k];
        const extra = v => !v ? "" : k === "bal" ? `Pobrano ${kwh(v.imp)} · oddano ${kwh(v.exp)}` : k === "profit" ? `Sprzedaż ${zl(v.sell)} · zakup ${zl(v.cost)}` : "";
        const tot = pick(ch.tot), items = ch.buckets.map(b => ({ t0: +b.d, t1: +b.nx, v: pick(b.v), x: extra(b.v), fut: b.future, d: b.d, lab: b.l1, lab2: b.l2, tip: b.tip }));
        d = { items, per: ch.per, tot, totX: extra(ch.tot), avg: k === "bal" ? (isNum(ch.avg.exp) && isNum(ch.avg.imp) ? ch.avg.exp - ch.avg.imp : null) : ch.avg[k], avgLabel: ch.avgLabel, err: !raw };
        if (ch.buckets.length > 40) { const ev = Math.ceil(ch.buckets.length / 24); d.items.forEach((it, i) => { if (i % ev) it.lab = it.lab2 = ""; }); }
      } else if (h.kind === "rce") {
        const days = (r.end - r.start) / 864e5, agg = days > 62 ? "day" : days > 8 ? "hour" : "raw";
        const res = await hass.callApi("GET", `pge_net_billing/rce?start=${isoDate(r.start)}&end=${isoDate(addDays(r.end, -1))}&agg=${agg}`);
        const len = agg === "raw" ? 9e5 : agg === "hour" ? 36e5 : 864e5, now = Date.now();
        const items = (res?.rows || []).map(x => { const t = new Date(x[0]); const t1 = agg === "day" ? +addDays(t, 1) : +t + len;
          return { t0: +t, t1, v: x[1], lo: x[2], hi: x[3], fut: +t > now, tip: agg === "raw" ? `${dayShort(t)}, ${pad(t.getHours())}:${pad(t.getMinutes())}–${pad(new Date(t1).getHours())}:${pad(new Date(t1).getMinutes())}` : agg === "hour" ? `${dayShort(t)}, ${pad(t.getHours())}:00–${pad((t.getHours() + 1) % 24)}:00` : `${dayShort(t)} ${t.getFullYear()}` }; });
        items.forEach(it => { const t = new Date(it.t0);
          if (agg === "raw") { if (days <= 1.1 ? t.getMinutes() === 0 && t.getHours() % 3 === 0 : t.getMinutes() === 0 && t.getHours() === 0) it.lab = days <= 1.1 ? pad(t.getHours()) + ":00" : dayShort(t); }
          else if (agg === "hour") { if (t.getHours() === 0 && t.getDate() % 2 === 1) it.lab = pad(t.getDate()); }
          else if (t.getDate() === 1) it.lab = MONTH_SHORT[t.getMonth()]; });
        d = { items, agg, until: res?.published_until ? new Date(+new Date(res.published_until) + 9e5) : null };
      } else if (h.kind === "months") {
        const m = p._model(), ms = m.months || {}, keys = Object.keys(ms).filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
        const st = p._hass?.states?.[p._ids?.invoice_forecast], credits = st?.attributes?.deposit_credits || [];
        const cur = monthKey(new Date()), M = key => { const [y, mo] = key.split("-").map(Number); return new Date(y, mo - 1, 1); };
        const items = keys.map(key => { const o = ms[key], a = M(key), live = key === cur;
          const v = this._k === "invoice" ? o.invoice : isNum(o.deposit_available) ? o.deposit_available : o.deposit_balance;
          const x = this._k === "invoice"
            ? `Energia ${zl(o.energy_gross)} · depozyt −${zl(o.deposit_used)} · dystrybucja ${zl(o.distribution_gross)} · stałe ${zl(o.fixed_gross)}`
            : `Naliczono ${zl(o.deposit_added)} · zużyto ${zl(o.deposit_used)} · wygasło ${zl(o.deposit_expired)} · od 1-szego nast. ${zl(o.deposit_next)}`;
          return { t0: +a, t1: +monthStart(a, 1), v, x, o, key, fut: false, lab: MONTH_SHORT[a.getMonth()], lab2: String(a.getFullYear()).slice(2), tip: monthName(a) + (live ? " (stan na teraz)" : "") }; });
        if (this._k === "deposit" && keys.length && credits.length) { // future: only tranches already on the account
          let a = monthStart(M(keys.at(-1)), 1);
          for (let i = 0; i < 14; i++, a = monthStart(a, 1)) {
            const iso = isoDate(a), v = credits.filter(c => (!c.booked || c.booked <= iso) && (!c.expires || c.expires > iso)).reduce((s, c) => s + Number(c.amount || 0), 0);
            if (v <= 0.004) break;
            items.push({ t0: +a, t1: +monthStart(a, 1), v: Math.round(v * 100) / 100, fut: true, lab: MONTH_SHORT[a.getMonth()], lab2: String(a.getFullYear()).slice(2), tip: monthName(a) + " – już na koncie, jeśli nie zużyte", x: "" });
          }
        }
        if (items.length) this._r = { mode: "custom", start: new Date(items[0].t0), end: new Date(items.at(-1).t1), period: "month" };
        d = { items, credits, months: ms, cur };
      } else {
        const tr = p._model().tariff, pg = tr?.price_gross || {}, items = [], now = Date.now();
        for (let t = new Date(r.start); t < r.end; t = new Date(+t + 36e5)) {
          const z = g12Zone(t);
          items.push({ t0: +t, t1: +t + 36e5, v: isNum(pg[z]) ? Number(pg[z]) : null, z, fut: +t + 36e5 > now, tip: `${dayShort(t)}, ${pad(t.getHours())}:00–${pad((t.getHours() + 1) % 24)}:00 · ${z === "s1" ? "strefa dzienna" : "strefa nocna"}` });
        }
        const days = (r.end - r.start) / 864e5;
        items.forEach(it => { const t = new Date(it.t0); if (days <= 1.1 ? t.getHours() % 3 === 0 : t.getHours() === 0 && (days <= 8 || t.getDate() % 2 === 1)) it.lab = days <= 1.1 ? pad(t.getHours()) + ":00" : days <= 8 ? dayShort(t) : pad(t.getDate()); });
        d = { items, pg, name: tr?.name || "G12" };
      }
    } catch (e) { console.warn("PGE Net-Billing: history", e); d = { error: e?.body?.message || e?.message || String(e) }; }
    if (tok !== this._tok) return;
    this._d = d; this._draw();
  }
  _summary(d, h) {
    const box = (l, v, s = "") => `<div class="sm"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
    const nums = d.items.filter(i => isNum(i.v));
    const ext = f => nums.length ? nums.reduce((a, b) => f(b.v, a.v) ? b : a) : null;
    const mx = ext((a, b) => a > b), mn = ext((a, b) => a < b);
    if (h.kind === "energy") return box("Suma w okresie", h.fmt(d.tot), d.totX || "") + box(d.avgLabel, h.fmt(d.avg)) + box("Najwięcej", mx ? h.fmt(mx.v) : "—", mx?.tip || "") + box("Najmniej", mn ? h.fmt(mn.v) : "—", mn?.tip || "");
    if (h.kind === "months") {
      const past = d.items.filter(i => !i.fut && i.key !== d.cur), now = d.items.find(i => i.key === d.cur);
      const sumK = f => d.items.filter(i => i.o).reduce((s, i) => s + (Number(i.o[f]) || 0), 0);
      if (this._k === "invoice") {
        const avg = past.length ? past.reduce((s, i) => s + Number(i.v || 0), 0) / past.length : null;
        return box("Bieżący miesiąc", now ? zl(now.v) : "—", "stan na teraz") + box("Poprzedni", past.length ? zl(past.at(-1).v) : "—", past.length ? past.at(-1).tip : "") + box("Średnio (zamknięte)", zl(avg), `${past.length} mies.`) + box("Pokryte depozytem", zl(sumK("deposit_used")), "łącznie");
      }
      const exp = d.credits.filter(c => c.expires).sort((a, b) => a.expires < b.expires ? -1 : 1)[0];
      return box("Dostępne teraz", now ? zl(now.v, true) : "—") + box("Naliczono łącznie", zl(sumK("deposit_added"))) + box("Wygasło łącznie", zl(sumK("deposit_expired"))) + box("Najbliższe wygaśnięcie", exp ? zl(exp.amount) : "—", exp ? "z dniem " + plDate(fromIso(exp.expires)) : "");
    }
    if (h.kind === "rce") {
      const avg = nums.length ? nums.reduce((s, i) => s + Number(i.v), 0) / nums.length : null;
      const nowI = nums.find(i => i.t0 <= Date.now() && i.t1 > Date.now());
      return box("Średnia w okresie", pricePL(avg)) + box("Najdrożej", mx ? pricePL(mx.v) : "—", mx?.tip || "") + box("Najtaniej", mn ? pricePL(mn.v) : "—", mn?.tip || "") + box(nowI ? "Teraz" : "Opublikowane do", nowI ? pricePL(nowI.v) : d.until ? stamp(d.until) : "—", nowI && d.until ? `opublikowane do ${stamp(d.until)}` : "");
    }
    const z = g12Zone(new Date());
    return box("Strefa dzienna (S1)", pricePL(d.pg.s1)) + box("Strefa nocna (S2)", pricePL(d.pg.s2)) + box("Teraz", z === "s1" ? "dzienna" : "nocna", pricePL(d.pg[z])) + box("Strefa nocna", "22–6 + 13–15", "lato (IV–IX): 15–17");
  }
  _draw() {
    const h = HIST[this._k], r = this._r, d = this._d, lim = this._limit(), nx = shiftRange(r, 1);
    const unit = h.kind === "energy" ? (["imp", "exp", "bal"].includes(this._k) ? "kWh" : "zł") : h.kind === "months" ? "zł" : "zł/kWh";
    const axis = v => h.kind === "energy" || h.kind === "months" ? String(+v.toFixed(2)).replace(".", ",") : v.toFixed(2).replace(".", ",");
    let body;
    if (!d) body = `<div class="nohist">Ładowanie…</div>`;
    else if (d.error) body = `<div class="nohist">Nie udało się pobrać danych: ${esc(d.error)}</div>`;
    else if (!d.items.some(i => isNum(i.v))) body = `<div class="nohist">Brak danych w tym okresie${h.kind === "rce" && r.start > new Date() ? " – PSE jeszcze nie opublikowało cen" : ""}</div>`;
    else body = histSvg(d.items, r, { type: h.kind === "energy" || h.kind === "months" ? "bar" : "step", color: h.tone, signed: h.signed, unit, axis, until: h.kind === "rce" ? d.until : null });
    this.shadowRoot.innerHTML = `<style>${HCSS}</style><div class="bd" part="backdrop"><div class="mo" role="dialog" aria-modal="true" aria-label="${esc(h.title)}">
  <div class="mh"><h3>${esc(h.title)}</h3><span class="rl">${esc(rangeLabel(r))}</span><button class="x" aria-label="Zamknij"><ha-icon icon="mdi:close"></ha-icon></button></div>
  <div class="ctl"${h.kind === "months" ? " hidden" : ""}><button class="b ar" data-s="-1" aria-label="Wcześniej"><ha-icon icon="mdi:chevron-left"></ha-icon></button><button class="b ar" data-s="1" ${nx.start > lim ? "disabled" : ""} aria-label="Później"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
    ${H_MODES[h.kind].map(([k, l]) => `<button class="b${r.mode === k ? " on" : ""}" data-m="${k}">${l}</button>`).join("")}<button class="b" data-t="1">Dzisiaj</button>${h.kind === "rce" ? `<button class="b" data-tm="1">Jutro</button>` : ""}</div>
  <div class="pl">${body}<div class="tip" hidden></div></div>
  ${d && !d.error && d.items ? `<div class="sms">${this._summary(d, h)}</div>` : ""}
  ${d && this._k === "deposit" && d.credits?.length ? `<table class="tr"><thead><tr><th>Z eksportu za</th><th>Na koncie od</th><th>Ważne do</th><th>Pozostało</th></tr></thead><tbody>${d.credits.map(c => `<tr><td>${c.origin === "opening" ? "saldo początkowe" : esc(monthName(fromIso(c.origin + "-01")))}</td><td>${c.booked ? plDate(fromIso(c.booked)) : "—"}</td><td>${c.expires ? plDate(addDays(fromIso(c.expires), -1)) : "bez terminu"}</td><td>${zl(c.amount)}</td></tr>`).join("")}</tbody></table>` : ""}
  <div class="nt">${esc(h.note)}${h.kind === "energy" && d?.per && d.per !== "hour" ? " Kliknij słupek, aby wejść w szczegóły." : ""}</div>
</div></div>`;
    const S = this.shadowRoot, q = s => S.querySelector(s);
    q(".bd").onclick = e => { if (e.target === q(".bd")) this.close(); };
    q(".x").onclick = () => this.close();
    S.querySelectorAll("[data-s]").forEach(b => b.onclick = () => this._set(shiftRange(r, Number(b.dataset.s))));
    S.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { const n = new Date(); this._set(makeRange(b.dataset.m, n >= r.start && n < r.end ? n : r.start)); });
    q("[data-t]").onclick = () => this._set(makeRange(r.mode === "custom" ? "day" : r.mode, new Date()));
    if (h.kind === "months") { /* fixed range: all months */ }
    if (q("[data-tm]")) q("[data-tm]").onclick = () => this._set(makeRange("day", addDays(new Date(), 1)));
    const svg = q(".hs"), tip = q(".tip");
    if (!svg) return;
    const hl = svg.querySelector(".hl");
    svg.querySelectorAll(".hit").forEach(el => {
      const it = d.items[Number(el.dataset.i)];
      el.onmouseenter = () => {
        const x = Number(el.getAttribute("x")) + Number(el.getAttribute("width")) / 2;
        hl.style.display = ""; hl.setAttribute("x1", x); hl.setAttribute("x2", x);
        const range = isNum(it.lo) && it.hi !== it.lo ? `<div class="mut">min ${pricePL(it.lo)} · maks ${pricePL(it.hi)}</div>` : "";
        tip.innerHTML = `<div class="tt">${esc(it.tip)}${it.fut ? " · przyszłość" : ""}</div><b>${isNum(it.v) ? h.fmt(it.v) : "brak danych"}</b>${range}${it.x ? `<div class="mut">${esc(it.x)}</div>` : ""}`;
        tip.hidden = false; tip.style.left = `clamp(100px, ${x / 10}%, calc(100% - 100px))`;
      };
      if (h.kind === "energy" && !it.fut && (d.per === "day" || d.per === "month")) el.onclick = () => this._set(makeRange(d.per === "day" ? "day" : "month", it.d));
    });
    svg.onmouseleave = () => { tip.hidden = true; hl.style.display = "none"; };
  }
}
if (!customElements.get("pge-net-billing-history")) customElements.define("pge-net-billing-history", PGEHistory);
function openHistory(panel, key, range) {
  if (!HIST[key]) return;
  document.querySelectorAll("pge-net-billing-history").forEach(e => e.close());
  const el = document.createElement("pge-net-billing-history");
  document.body.appendChild(el);
  el.open(panel, key, range);
}
const HCSS = `
:host{position:fixed;inset:0;z-index:9999;font-family:var(--paper-font-body1_-_font-family,Roboto),Roboto,"Segoe UI",Arial,sans-serif;color:#eaf2f9}
*{box-sizing:border-box}ha-icon{--mdc-icon-size:100%;display:inline-flex;width:100%;height:100%}
.bd{position:absolute;inset:0;background:rgba(2,8,14,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.mo{width:min(1100px,100%);max-height:100%;overflow:auto;background:linear-gradient(150deg,#0c1f2e,#081826);border:1px solid #1d3a55;border-radius:16px;padding:16px 18px 14px}
.mh{display:flex;align-items:center;gap:12px}.mh h3{margin:0;font-size:18px;font-weight:700}.rl{color:#9db2c3;font-size:14px;flex:1}
.x{width:34px;height:34px;padding:6px;border-radius:10px;border:1px solid #1d3a55;background:#0d2131;color:#c9d7e2;cursor:pointer}
.ctl{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 6px}.b{height:34px;padding:0 13px;border-radius:9px;border:1px solid #1d3a55;background:#0d2131;color:#c9d7e2;font:inherit;font-size:14px;cursor:pointer}
.b.ar{width:34px;padding:7px}.b.on{background:#2d7cf6;border-color:#2d7cf6;color:#fff;font-weight:700}.b:disabled{opacity:.35;cursor:default}.b:not(:disabled):hover{border-color:#3b8cff}
.pl{position:relative;min-height:220px}.hs{width:100%;height:auto;display:block}
.grid{stroke:#1a3246;stroke-width:1}.zero{stroke:#3b5a73;stroke-width:1.2}.ax,.xl,.unit{fill:#9db2c3;font-size:13px}.unit{font-size:14px}
.unpub{fill:#3b8cff;opacity:.06}.nowl{stroke:#ffad2e;stroke-width:1.2;stroke-dasharray:3 3}.nowt{fill:#ffad2e;font-size:12px}.hl{stroke:#c9d7e2;stroke-width:1;opacity:.5}.hit{cursor:crosshair}
.tip{position:absolute;top:6px;transform:translateX(-50%);background:#06111b;border:1px solid #2a4a66;border-radius:10px;padding:8px 11px;font-size:13px;pointer-events:none;white-space:nowrap}
.tip .tt{color:#9db2c3;margin-bottom:3px}.tip b{font-size:16px}.tip .mut{color:#9db2c3;font-size:12px;margin-top:2px}
.nohist{display:grid;place-items:center;min-height:220px;color:#9db2c3}
.sms{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:8px}
.sm{border:1px solid #17304a;border-radius:12px;background:#0a1a27;padding:10px 12px;min-width:0}.sm span{display:block;color:#c9d7e2;font-size:13px}.sm b{display:block;font-size:19px;margin-top:3px;white-space:nowrap}.sm small{display:block;color:#9db2c3;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nt{color:#9db2c3;font-size:12.5px;margin-top:10px}[hidden]{display:none!important}
.tr{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}.tr th{text-align:left;color:#9db2c3;font-weight:500;padding:6px 8px;background:#0a1a27}.tr td{padding:6px 8px;border-top:1px solid #17304a}.tr th:last-child,.tr td:last-child{text-align:right}
@media(max-width:700px){.sms{grid-template-columns:1fr 1fr}.mo{padding:12px}}
`;

// table row -> range: current month view = today / week / month / year, older = month / previous month / year
function periodRange(m, i) {
  const now = new Date();
  if (m.isCurrent) return makeRange(["day", "week", "month", "year"][i] || "month", now);
  return [makeRange("month", m.sel), makeRange("month", m.prevD), makeRange("year", m.sel)][i] || makeRange("month", m.sel);
}
class PGEPanel extends PGEBase {
  set panel(p) { this._panelConfig = p?.config || {}; }
  set narrow(n) { this._narrow = n; }
  _chart(m) {
    this._range ||= makeRange("month", new Date());
    return buildChart(this._hass, this._ids || {}, this._chartRaw, this._range, m);
  }
  async _refresh() {
    if (!this._hass) return;
    this._range ||= makeRange("month", new Date());
    const w = statWindow(this._offset), rg = this._range;
    const p = loadStats(this._hass, this._ids, w.start, w.end);
    const q = rg.start < new Date() ? loadStats(this._hass, this._ids, rg.start, new Date(Math.min(rg.end, Date.now() + 36e5)), rg.period) : Promise.resolve({});
    this._draw();
    const [raw, craw] = await Promise.all([p, q]);
    let ch = false;
    if (raw && raw !== this._raw) { this._raw = raw; ch = true; }
    if (rg === this._range && craw && craw !== this._chartRaw) { this._chartRaw = craw; ch = true; }
    if (ch) this._draw();
  }
  _setRange(r) {
    if (!r || !(r.start < r.end)) return;
    this._range = r; this._chartRaw = null; this._refresh();
  }
  _bindChart(m) {
    const root = this.shadowRoot, card = root.querySelector(".fc");
    if (!card) return;
    const ch = this._chart(m), r = ch.r;
    card.querySelectorAll("[data-shift]").forEach(b => b.onclick = () => this._setRange(shiftRange(r, Number(b.dataset.shift))));
    card.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
      const now = new Date(), anchor = now >= r.start && now < r.end ? now : r.start;
      this._setRange(makeRange(b.dataset.mode, anchor));
    });
    card.querySelector("[data-today]").onclick = () => this._setRange(makeRange(MODES.some(x => x[0] === r.mode) ? r.mode : "month", new Date()));
    card.querySelector("[data-cal]").onclick = () => { const i = card.querySelector('[data-f="from"]'); try { i.showPicker(); } catch (e) { i.focus(); } };
    const custom = () => {
      const f = fromIso(card.querySelector('[data-f="from"]').value), t = fromIso(card.querySelector('[data-f="to"]').value);
      if (f && t && f <= t) this._setRange(makeRange("custom", f, f, addDays(t, 1)));
    };
    card.querySelectorAll("input[type=date]").forEach(i => i.onchange = custom);
    card.querySelectorAll(".fc-date").forEach(l => l.onclick = e => { if (e.target.closest(".fc-x")) return; e.preventDefault(); const i = l.querySelector("input"); try { i.showPicker(); } catch (_) { i.focus(); } });
    card.querySelectorAll("[data-x]").forEach(b => b.onclick = e => { e.preventDefault(); this._setRange(makeRange("month", new Date())); });
    // hover: tooltip + tiles show the bucket; leave: whole period; click: drill down
    const svg = card.querySelector(".fc-svg"), tip = card.querySelector(".fc-tip");
    if (!svg) return;
    const cur = svg.querySelector(".cursor");
    const setTiles = (v, a) => {
      card.querySelectorAll("[data-c]").forEach(el => { const k = el.dataset.c, x = v[k]; el.textContent = k === "exp" ? (isNum(x) ? kwh(-x) : "—") : k === "imp" ? kwh(x) : k === "profit" ? zl(x, true) : zl(x); if (k === "profit") el.className = "fc-val " + (isNum(x) && x < 0 ? "t-red" : "t-green"); });
    };
    const setBal = (v, label) => {
      const x = balView(v), q = k => root.querySelector(`[data-bb="${k}"]`);
      if (!q("val")) return;
      q("val").textContent = kwh(x.b, true); q("val").className = "k-val " + x.cls;
      q("sub").textContent = x.sub; q("per").textContent = label;
      q("imp").textContent = kwh(x.i); q("exp").textContent = kwh(x.e); q("bar").style.left = Math.max(2, Math.min(98, x.pct)).toFixed(1) + "%";
    };
    const show = i => {
      const b = i === null ? null : ch.buckets[i];
      setBal(b ? (b.v || {}) : ch.tot, b ? b.tip : rangeLabel(r));
      svg.classList.toggle("focus", !!b);
      svg.querySelectorAll(".day").forEach(g => g.classList.toggle("sel", b && Number(g.dataset.i) === i));
      if (!b) { tip.hidden = true; cur.style.display = "none"; setTiles(ch.tot, ch.avg); return; }
      const g = svg.querySelector(`.day[data-i="${i}"]`), x = Number(g.dataset.x);
      cur.style.display = ""; cur.querySelector(".cl").setAttribute("x1", x); cur.querySelector(".cl").setAttribute("x2", x);
      cur.querySelector(".ci").setAttribute("cx", x); cur.querySelector(".ci").setAttribute("cy", g.dataset.yi);
      cur.querySelector(".ce").setAttribute("cx", x); cur.querySelector(".ce").setAttribute("cy", g.dataset.ye);
      tip.innerHTML = `<div class="tt">${esc(b.tip)}</div><div><b style="background:var(--o)"></b>Pobór z sieci<span>${kwh(b.v?.imp)}</span></div><div><b style="background:var(--g)"></b>Oddanie do sieci<span>${kwh(b.v?.exp)}</span></div>${ch.per !== "hour" ? `<div class="hint">kliknij, aby przejść do ${ch.per === "day" ? "godzin tego dnia" : "dni tego miesiąca"}</div>` : ""}`;
      tip.hidden = false;
      const pct = x / 1000 * 100; tip.style.left = `clamp(110px, ${pct}%, calc(100% - 110px))`;
      setTiles(b.v || {}, null);
    };
    svg.querySelectorAll(".day:not(.fut)").forEach(g => {
      const i = Number(g.dataset.i), b = ch.buckets[i];
      g.addEventListener("mouseenter", () => show(i));
      g.addEventListener("click", () => {
        if (ch.per === "day") this._setRange(makeRange("day", b.d));
        else if (ch.per === "month") this._setRange(makeRange("month", b.d));
      });
    });
    svg.addEventListener("mouseleave", () => show(null));
    show(null);
  }
  _draw() {
    const m = this._model(), c = { ...(this._panelConfig || {}), ...this._config };
    const ch = this._chart(m), bv = balView(ch.loading ? { imp: m.month.imp, exp: m.month.exp } : ch.tot);
    const info = t => `<ha-icon class="info" icon="mdi:information-outline" title="${esc(t)}"></ha-icon>`;
    const mAcc = MONTH_ACC[m.sel.getMonth()], prevI = MONTH_INSTR[m.prevD.getMonth()];
    const invDiff = isNum(m.invoice) && isNum(m.invoicePrev) ? m.invoice - m.invoicePrev : null;
    const sc = depositScale(m.deposit);
    const stale = m.updated && Date.now() - m.updated > 2 * 36e5;
    const tariff = m.tariff, zoneKey = tariff?.zone, zPrice = tariff?.price_gross?.[zoneKey];
    const rceSlot = m.rceSlot ? `${m.rceSlot.getDate()} ${MONTH_SHORT[m.rceSlot.getMonth()]} ${m.rceSlot.getFullYear()}, godz. ${pad(m.rceSlot.getHours())}:${pad(m.rceSlot.getMinutes())}` : "";
    const sw = (vals, col, w, h) => `<div class="spark-wrap">${spark(vals, col, w, h)}</div>`;
    const row = (label, r, i) => `<tr class="hist" data-hist="bal" data-pi="${i}" tabindex="0"><td>${esc(label)}</td><td>${kwh(r.imp)}</td><td>${kwh(r.exp)}</td><td class="${isNum(r.bal) && r.bal < 0 ? "t-red" : "t-green"}">${kwh(r.bal, true)}</td></tr>`;
    const frow = (label, r, i) => `<tr class="hist" data-hist="profit" data-pi="${i}" tabindex="0"><td>${esc(label)}</td><td>${zl(r.cost)}</td><td>${zl(r.sell)}</td><td class="${isNum(r.saldo) && r.saldo < 0 ? "t-red" : "t-green"}">${zl(r.saldo, true)}</td></tr>`;

    this.shadowRoot.innerHTML = `<style>${CSS}</style><main class="pf">
<div class="pf-grid"><div class="main">
  <header class="pf-head"><div class="pf-brand">${logo(c, "lg")}<div><h1>PGE Net-Billing</h1><div class="pf-sub">PGE Obrót · Dystrybucja · RCE · ${esc(tariff?.name || "G12")}</div></div></div>
    <div class="pf-date"><div class="pf-date-row">${icon("calendar-month", "blue")}<span class="lbl">${esc(monthName(m.sel))}</span><button class="nav" data-d="-1" ${this._offset <= -24 ? "disabled" : ""} aria-label="Poprzedni miesiąc"><ha-icon icon="mdi:chevron-left"></ha-icon></button><button class="nav" data-d="1" ${this._offset >= 0 ? "disabled" : ""} aria-label="Następny miesiąc"><ha-icon icon="mdi:chevron-right"></ha-icon></button></div>
    <div class="pf-upd"><i class="${stale ? "stale" : ""}"></i>Ostatnia aktualizacja: ${m.updated ? stamp(m.updated) : "—"}</div></div></header>
  ${m.found ? "" : `<div class="warn">Nie znaleziono encji integracji PGE Net-Billing. Sprawdź, czy integracja jest skonfigurowana.</div>`}
  ${m.hasStats ? "" : `<div class="warn">Brak statystyk długoterminowych z Recordera – tabele, wykresy i porównania pojawią się po pierwszych godzinach/dobach zbierania danych.</div>`}

  <section class="top">
    <div class="box hist" data-hist="invoice" tabindex="0" role="button"><div class="k-head"><span class="ic ic-orange">${CICON.bill}</span><div><div class="k-label">Szacowana kwota rachunku ${info("Prognoza lokalna (energia po depozycie + dystrybucja + opłaty stałe, brutto). To nie jest faktura PGE.")}</div>
      <div class="k-val t-orange">${zl(m.invoice)}</div><div class="k-sub">za ${mAcc} ${m.sel.getFullYear()}</div></div></div>
      <div class="k-bottom"><div>${delta(m.invoice, m.invoicePrev, true)}${invDiff !== null ? `<div class="muted">w porównaniu z ${prevI}<br>(${zl(invDiff, true)})</div>` : ""}</div>${sw(m.spark.invoice, TONE.red, 120, 60)}</div></div>

    <div class="box hist" data-hist="deposit" tabindex="0" role="button"><div class="k-head"><span class="ic ic-blue">${CICON.wallet}</span><div><div class="k-label">Saldo depozytu prosumenckiego ${info("Prognoza FIFO: wartość eksportu wg RCE × współczynnik, ważna 12 mies. To nie jest saldo bankowe.")}</div>
      <div class="k-val t-green">${zl(m.deposit, true)}</div><div class="k-sub">Dostępne środki do rozliczenia</div></div></div>
      <div style="margin-top:auto">${bar(depositPct(m.deposit))}<div class="k-ends"><span>−${sc} zł<small>(do dopłaty)</small></span><span class="r">+${sc} zł<small>(nadwyżka)</small></span></div></div></div>

    <div class="box hist" data-hist="bal" tabindex="0" role="button"><div class="k-head"><span class="ic ic-green">${CICON.leaf}</span><div><div class="k-label">Bilans energii ${info("Oddano minus pobrano w okresie wybranym na wykresie „Przepływ energii” (najechanie na słupek pokazuje ten słupek).")}</div>
      <div class="k-val ${bv.cls}" data-bb="val">${kwh(bv.b, true)}</div><div class="k-sub"><span data-bb="sub">${bv.sub}</span> · <span class="t-blue2" data-bb="per">${esc(rangeLabel(ch.r))}</span></div></div></div>
      <div style="margin-top:auto"><div class="bar bar-energy"><i data-bb="bar" style="left:${Math.max(2, Math.min(98, bv.pct)).toFixed(1)}%"></i></div><div class="k-ends"><span>Pobrano<small style="font-size:15px;font-weight:700;color:var(--o)" data-bb="imp">${kwh(bv.i)}</small></span><span class="r">Oddano<small style="font-size:15px;font-weight:700;color:var(--g)" data-bb="exp">${kwh(bv.e)}</small></span></div></div></div>
  </section>

  <section class="box dep">
    <h3>Depozyt prosumencki – rozliczenia miesięczne</h3>
    <div class="dep-row">
      ${depCard("blue", "Poprzedni miesiąc", monthName(m.prevD), m.dep.prev, [["Oddano do depozytu", kwh(m.prev.exp), ""], ["Wykorzystano z depozytu", zl(m.dep.prevUsed), ""]], "", "Saldo dostępne na koniec poprzedniego miesiąca")}
      <span class="dep-arrow"><ha-icon icon="mdi:arrow-right"></ha-icon></span>
      ${depCard("indigo", m.isCurrent ? "Obecny miesiąc" : "Wybrany miesiąc", monthName(m.sel), m.dep.now, [["Oddano do depozytu", kwh(m.month.exp), "t-blue2"], ["Wykorzystano z depozytu", zl(m.dep.used), ""]], "dep-cur", "Saldo dostępne dziś: zaksięgowane w poprzednich miesiącach minus zużyte na energię w tym miesiącu. Eksport z tego miesiąca wchodzi dopiero od 1-szego następnego.")}
      <span class="dep-arrow"><ha-icon icon="mdi:arrow-right"></ha-icon></span>
      ${depCard("green", "Następny miesiąc", monthName(monthStart(m.sel, 1)) + (m.isCurrent ? " (prognoza)" : ""), m.dep.next, [["Wpłynie z tego miesiąca", zl(m.dep.pending, true), ""], ["Wygasa z początkiem miesiąca", zl(m.dep.expiring), ""]], "", "Saldo na 1. dzień następnego miesiąca: dostępne dziś + depozyt naliczany w tym miesiącu − środki starsze niż 12 miesięcy")}
    </div>
  </section>

  ${chartCard(ch)}

  <section class="bot">
    <div class="box hist" data-hist="cost" tabindex="0" role="button" title="Kliknij: historia">${icon("cart", "red", "ic-plain")}<div class="b-body"><div class="muted2">Koszt zakupu energii</div><div class="b-val">${zl(m.month.cost)}</div>
      <div class="b-foot"><div>${delta(m.month.cost, m.prev.cost, true)}${isNum(m.prev.cost) && m.prev.cost ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.cost, TONE.red, 90, 44)}</div></div></div>
    <div class="box hist" data-hist="sell" tabindex="0" role="button" title="Kliknij: historia">${icon("trending-up", "green", "ic-plain")}<div class="b-body"><div class="muted2">Wartość oddanej energii</div><div class="b-val">${zl(m.month.sell)}</div>
      <div class="b-foot"><div>${delta(m.month.sell, m.prev.sell, false)}${isNum(m.prev.sell) && m.prev.sell ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.sell, TONE.green, 90, 44)}</div></div></div>
    <div class="box hist" data-hist="rce" tabindex="0" role="button" title="Kliknij: historia i ceny na jutro">${icon("chart-bar", "blue", "ic-plain")}<div class="b-body"><div class="muted2">Aktualna cena RCE</div><div class="b-val">${isNum(m.rce) ? NF4.format(m.rce) + " zł/kWh" : "—"}</div><div class="b-note">${esc(rceSlot)}</div>
      <div class="b-foot" style="margin-top:auto">${spark(m.rceToday.concat(m.rceTomorrow), TONE.blue, 200, 40)}</div></div></div>
    <div class="box hist" data-hist="tariff" tabindex="0" role="button" title="Kliknij: strefy i ceny – historia i przyszłość">${icon("clock-outline", "blue", "ic-plain")}<div class="b-body"><div class="muted2">Taryfa dystrybucji</div><div class="b-val">${esc(tariff?.name || "G12")}</div>
      <div class="b-note">Obecnie: ${zoneKey === "s1" ? "strefa dzienna" : zoneKey === "s2" ? "strefa nocna" : "—"}</div>
      <div class="zone" title="energia + dystrybucja zmienna, brutto">${icon(zoneKey === "s2" ? "weather-night" : "white-balance-sunny", zoneKey === "s2" ? "blue" : "orange", "ic-plain")}<div><div class="b-val" style="margin:0;font-size:18px">${isNum(zPrice) ? NF4.format(zPrice) + " zł/kWh" : "—"}</div></div></div></div></div>
  </section>

  <section class="tables">
    <div class="box"><h3>Bilans energii</h3><table><thead><tr><th>Okres</th><th>Pobrano</th><th>Oddano</th><th>Bilans</th></tr></thead><tbody>${m.periods.map(([l, r], i) => row(l, r, i)).join("")}</tbody></table></div>
    <div class="box"><h3>Rozliczenia finansowe</h3><table><thead><tr><th>Okres</th><th>Zakup energii</th><th>Sprzedaż (RCE)</th><th>Saldo</th></tr></thead><tbody>${m.periods.map(([l, r], i) => frow(l, r, i)).join("")}</tbody></table></div>
  </section>
</div>
<aside class="aside"><h2>Mały kafelek do Twoich kart</h2>${TILES.deposit(m, c)}${TILES.invoice(m, c)}${TILES.balance(m, c)}${TILES.wallet(m, c)}${TILES.summary(m, c)}</aside>
</div>
<div class="foot">Kwoty są prognozą lokalną integracji (stawki z konfiguracji, RCE z PSE), nie fakturą PGE. Zakup energii w tabeli i kafelku – brutto (bez dystrybucji). v${VERSION}</div>
</main>`;
    this._bindChart(m);
    this.shadowRoot.querySelectorAll("[data-hist]").forEach(el => {
      const go = () => openHistory(this, el.dataset.hist, el.dataset.pi !== undefined ? periodRange(m, Number(el.dataset.pi)) : undefined);
      el.onclick = e => { if (e.target.closest(".info")) return; go(); };
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
    this.shadowRoot.querySelectorAll(".nav").forEach(b => b.onclick = () => { this._offset = Math.min(0, this._offset + Number(b.dataset.d)); this._range = makeRange("month", monthStart(new Date(), this._offset)); this._chartRaw = null; this._sig = ""; this._refresh(); });
    // aside tiles are previews only – no navigation inside the panel
    this.shadowRoot.querySelectorAll(".aside .link").forEach(el => el.classList.remove("link"));
  }
}
for (const tag of ["pge-net-billing-dashboard", "pge-net-billing-panel"]) {
  if (!customElements.get(tag)) customElements.define(tag, tag === "pge-net-billing-panel" ? class extends PGEPanel {} : PGEPanel);
  else if (tag === "pge-net-billing-dashboard") console.warn("PGE Net-Billing: element already defined by another copy of the script – check Settings → Dashboards → Resources");
}
console.info(`%c PGE-NET-BILLING %c v${VERSION} `, "background:#ff3045;color:#fff;font-weight:700", "background:#0c1f2e;color:#fff");
})();
