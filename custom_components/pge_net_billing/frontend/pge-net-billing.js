/* PGE Net-Billing v1.8.1 – Home Assistant panel + Lovelace cards (layout matched to reference dashboard) */
(() => { // own scope: never clashes with another copy of this script loaded as a classic <script>
const DOMAIN = "pge_net_billing";
const VERSION = "1.8.1";
const PANEL_PATH = "/pge-net-billing";
const KEYS = ["invoice_forecast", "deposit_estimate", "import_s1", "import_s2", "export_kwh", "energy_cost", "export_value", "rce_current"];
// Fallback for installs without translation_key (older backend): friendly-name suffixes
const NAMES = {
  invoice_forecast: "Prognoza rachunku za bieżący miesiąc", deposit_estimate: "Saldo depozytu (prognoza)",
  import_s1: "Pobór S1", import_s2: "Pobór S2", export_kwh: "Eksport", energy_cost: "Koszt energii netto",
  export_value: "Wartość eksportu (szacunek)", rce_current: "Aktualna RCE brutto",
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
    if (!id) id = states.find(s => s.entity_id.startsWith("sensor.") && [NAMES[k], k === "rce_current" ? "Aktualna RCE" : null].some(n => n && String(s.attributes?.friendly_name || "").endsWith(n)))?.entity_id;
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
  // RCE shown gross: PSE net price × prosumer multiplier from the integration config (default 1.23)
  const rceMul = isNum(rce?.attributes?.multiplier) ? Number(rce.attributes.multiplier) : 1.23;
  const stMul = rce?.attributes?.gross ? 1 : rceMul; // v1.5.5+ backend: sensor state and today/tomorrow are already gross
  const rceToday = (rce?.attributes?.today || []).map(x => Number(x[1]) * stMul).filter(isNum);
  const rceTomorrow = (rce?.attributes?.tomorrow || []).map(x => Number(x[1]) * stMul).filter(isNum);
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
    rce: isNum(val("rce_current")) ? val("rce_current") * stMul : null, rceMul, rceToday, rceTomorrow, rceSlot,
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

/* ---------- "Moc i bateria" (v1.7.0): power lines, neon buy / sell prices, inverter counters ---------- */
const PINK = "#ff2bd6", CYAN = "#00f5ff";
const PW = {
  soc: { label: "SOC magazynu", color: TONE.blue, attr: "battery_soc", kind: "pct" },
  pv: { label: "Produkcja", color: TONE.green, attr: "pv_power", kind: "power" },
  bat: { label: "Bateria", color: "#8b7cff", attr: "battery_power", inv: "battery_invert", kind: "power" },
  grid: { label: "Sieć", color: TONE.orange, attr: "grid_power", inv: "grid_invert", kind: "power" },
  load: { label: "Pobór domu", color: TONE.red, attr: "load_power", kind: "power" },
  imp: { label: "Import (licznik)", color: TONE.orange, attr: "grid_import_total", kind: "energy" },
  exp: { label: "Eksport (licznik)", color: TONE.orange, attr: "grid_export_total", kind: "energy" },
  // v1.7.2: inverter energy counters (lifetime or daily-reset) – preferred over power × time
  pvE: { label: "Produkcja PV (licznik)", color: TONE.green, attr: "pv_total", kind: "energy" },
  chE: { label: "Ładowanie (licznik)", color: "#8b7cff", attr: "battery_charge_total", kind: "energy" },
  disE: { label: "Rozładowanie (licznik)", color: "#8b7cff", attr: "battery_discharge_total", kind: "energy" },
  loadE: { label: "Zużycie domu (licznik)", color: TONE.red, attr: "load_total", kind: "energy" },
};
// energy from a counter: sum of increases; a drop = reset (daily counter) -> the new value is the energy since the reset
function pwDelta(s, a, b) {
  if (!s?.length) return null;
  const v0 = pwAt(s, a); let prev = isNum(v0) ? v0 : null, sum = 0, any = isNum(v0);
  for (const [t, v] of s) { if (t <= a) continue; if (t > b) break; if (prev !== null) sum += v >= prev ? v - prev : v; prev = v; any = true; }
  return any ? sum : null;
}
// long ranges: hourly statistics "change" of the counters (HA handles resets of total_increasing; for plain "total" a negative change = reset -> use the state)
async function pwChange(hass, cfg, start, end) {
  const keys = Object.keys(cfg);
  if (!keys.length || !hass?.callWS) return {};
  const ck = "chg|" + keys.map(k => cfg[k].id).join(",") + "|" + +start + "|" + +end, hit = pwCache.get(ck);
  if (hit && Date.now() - hit.t < 300000) return hit.p;
  const p = hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(), end_time: new Date(Math.min(+end, Date.now())).toISOString(), statistic_ids: keys.map(k => cfg[k].id), period: "hour", types: ["change", "state"] })
    .then(res => { const out = {}; for (const k of keys) { const f = pwFactor(k, hass, cfg[k].id); out[k] = (res?.[cfg[k].id] || []).map(x => { const c = Number(x.change), s = Number(x.state); return { t: typeof x.start === "number" ? x.start : Date.parse(x.start), e: (isNum(c) && c >= 0 ? c : isNum(s) && s >= 0 ? s : 0) * f }; }).filter(x => isNum(x.t)); } return out; })
    .catch(e => { console.warn("PGE Net-Billing: counter statistics unavailable", e); pwCache.delete(ck); return { error: e?.message || String(e) }; });
  pwCache.set(ck, { t: Date.now(), p });
  return p;
}
const PW_LINES = ["bat", "grid", "pv", "load"];
const PW_LEGEND = [["buy", "Cena kupna (G12)", PINK], ["sell", "Cena sprzedaży (RCE)", CYAN], ["soc", "SOC magazynu", TONE.blue], ["pv", "Produkcja", TONE.green], ["bat", "Bateria", "#8b7cff"], ["grid", "Sieć / import–eksport", TONE.orange], ["load", "Pobór domu", TONE.red]];
const PW_MODES = [["week", "Tydzień"], ["month", "Miesiąc"], ["year", "Rok"]];
const pwCache = new Map();
function pwConfig(hass, ids) {
  const p = hass?.states?.[ids?.invoice_forecast]?.attributes?.power || {};
  const out = {};
  for (const k in PW) { const id = p[PW[k].attr]; if (id && hass?.states?.[id]) out[k] = { id, sign: PW[k].inv && p[PW[k].inv] ? -1 : 1 }; }
  return out;
}
const pwFactor = (k, hass, id) => {
  const u = String(hass.states[id]?.attributes?.unit_of_measurement || "").trim();
  if (PW[k].kind === "pct") return 1;
  if (PW[k].kind === "energy") return u === "Wh" ? 0.001 : u === "MWh" ? 1000 : 1;
  return u === "W" ? 0.001 : u === "MW" ? 1000 : 1;
};
// raw recorded states, no averaging: [[ms, value], ...] in kW / kWh / %
async function pwLoad(hass, cfg, start, end) {
  const keys = Object.keys(cfg);
  if (!keys.length || !hass?.callWS) return {};
  const ck = "raw|" + keys.map(k => cfg[k].id + cfg[k].sign).join(",") + "|" + +start + "|" + +end;
  const hit = pwCache.get(ck);
  if (hit && (end <= Date.now() || Date.now() - hit.t < 60000)) return hit.p;
  const p = hass.callWS({
    type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(Math.min(+end, Date.now())).toISOString(),
    entity_ids: keys.map(k => cfg[k].id), minimal_response: true, no_attributes: true, significant_changes_only: false,
  }).then(res => {
    const out = {};
    for (const k of keys) {
      const { id, sign } = cfg[k], f = pwFactor(k, hass, id), sg = PW[k].kind === "power" ? sign : 1;
      out[k] = (res?.[id] || []).map(x => [isNum(x.lu) ? Math.round(Number(x.lu) * 1000) : Date.parse(x.lu ?? x.last_updated ?? x.last_changed), Number(x.s ?? x.state) * f * sg])
        .filter(x => isNum(x[0]) && isNum(x[1])).sort((a, b) => a[0] - b[0]);
    }
    return out;
  }).catch(e => { console.warn("PGE Net-Billing: power history unavailable", e); pwCache.delete(ck); return { error: e?.message || String(e) }; });
  pwCache.set(ck, { t: Date.now(), p });
  return p;
}
// long ranges: HA hourly statistics (energy = mean power × 1 h, extremes = real recorded min / max)
async function pwHourly(hass, cfg, start, end) {
  const keys = Object.keys(cfg);
  if (!keys.length || !hass?.callWS) return {};
  const ck = "hour|" + keys.map(k => cfg[k].id + cfg[k].sign).join(",") + "|" + +start + "|" + +end;
  const hit = pwCache.get(ck);
  if (hit && Date.now() - hit.t < 300000) return hit.p;
  const p = hass.callWS({
    type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(), end_time: new Date(Math.min(+end, Date.now())).toISOString(),
    statistic_ids: keys.map(k => cfg[k].id), period: "hour", types: ["mean", "min", "max"],
  }).then(res => {
    const out = {};
    for (const k of keys) {
      const { id, sign } = cfg[k], f = pwFactor(k, hass, id), sg = PW[k].kind === "power" ? sign : 1;
      out[k] = (res?.[id] || []).map(x => {
        const t = typeof x.start === "number" ? x.start : Date.parse(x.start), a = Number(x.min) * f * sg, b = Number(x.max) * f * sg;
        return { t, mean: Number(x.mean) * f * sg, min: Math.min(a, b), max: Math.max(a, b) };
      }).filter(x => isNum(x.t) && isNum(x.mean));
    }
    return out;
  }).catch(e => { console.warn("PGE Net-Billing: statistics unavailable", e); pwCache.delete(ck); return { error: e?.message || String(e) }; });
  pwCache.set(ck, { t: Date.now(), p });
  return p;
}
const pwAt = (s, t) => { if (!s?.length || t < s[0][0]) return null; let lo = 0, hi = s.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][0] <= t) lo = m; else hi = m - 1; } return s[lo][1]; };
function pwEnergy(s, a, b) {
  let pos = 0, neg = 0;
  if (!s?.length) return { pos: null, neg: null };
  for (let i = 0; i < s.length; i++) {
    const t0 = Math.max(a, s[i][0]), t1 = Math.min(b, i + 1 < s.length ? s[i + 1][0] : b);
    if (t1 <= t0) continue;
    const e = s[i][1] * (t1 - t0) / 36e5;
    if (e > 0) pos += e; else neg -= e;
  }
  return { pos, neg };
}
async function pwFetch(hass, cfg, r, mul) {
  const a = +r.start, b = +r.end, end = Math.min(b, Date.now()), long = b - a > 8 * 864e5;
  const pick = ks => Object.fromEntries(ks.filter(k => cfg[k]).map(k => [k, cfg[k]]));
  const pk = pick(["pv", "bat", "grid", "load", "soc"]), ck = pick(["imp", "exp"]), ek = pick(["pvE", "chE", "disE", "loadE"]);
  const q = `start=${isoDate(r.start)}&end=${isoDate(addDays(r.end, -1))}&agg=raw`;
  const [raw, cnt, st, rce, en] = await Promise.all([
    long ? {} : pwLoad(hass, pk, a, b),
    pwLoad(hass, ck, a, b),
    long ? pwHourly(hass, pk, a, b) : {},
    hass.callApi ? hass.callApi("GET", `pge_net_billing/rce?${q}`).catch(() => ({ rows: [] })) : { rows: [] },
    long ? pwChange(hass, ek, a, b) : pwLoad(hass, ek, a, b),
  ]);
  for (const x of [raw, cnt, st, en]) if (x?.error) return { error: x.error };
  const rmap = new Map((rce?.rows || []).map(x => [Date.parse(x[0]), Number(x[1]) * mul]));
  return { long, raw, cnt, st, rmap, a, b, end, en };
}
// 15-min slots from the inverter counters: what was really bought / sold and at which price
function pwSlots(D, tz) {
  const out = [], ci = D.cnt.imp, ce = D.cnt.exp;
  for (let t = D.a; t < D.b; t += 9e5) {
    const z = g12Zone(new Date(t)), t1 = Math.min(t + 9e5, D.end), past = t < D.end;
    const d = s => { if (!past || !s?.length) return null; const v = pwDelta(s, t, t1); return isNum(v) ? Math.max(0, v) : null; };
    out.push({ t, buy: isNum(tz[z]) ? Number(tz[z]) : null, sell: D.rmap.has(t) ? Math.max(0, D.rmap.get(t)) : null, rceRaw: D.rmap.get(t), z, di: d(ci), de: d(ce), past });
  }
  return out;
}
function pwAgg(D, slots, a, b, tz) {
  const end = Math.min(b, D.end), r = { pv: null, ch: null, dis: null, load: null, pvMax: null, chMax: null, disMax: null, ldMax: null, sMin: null, sMax: null, tMin: null, tMax: null, imp: null, exp: null, cost: null, val: null, best: null };
  const add = (k, v) => { if (isNum(v)) r[k] = (r[k] || 0) + v; };
  const mx = (k, v, t, tk) => { if (isNum(v) && (r[k] === null || v > r[k])) { r[k] = v; if (tk) r[tk] = t; } };
  const mn = (k, v, t, tk) => { if (isNum(v) && (r[k] === null || v < r[k])) { r[k] = v; if (tk) r[tk] = t; } };
  if (!D.long) {
    const R = D.raw;
    const e = k => R[k]?.length ? pwEnergy(R[k], a, end) : { pos: null, neg: null };
    r.pv = e("pv").pos; const eb = e("bat"); r.ch = eb.pos; r.dis = eb.neg; r.load = e("load").pos;
    const scan = (k, f) => { const s = R[k]; if (!s?.length) return; const v0 = pwAt(s, a); if (isNum(v0)) f(v0, a); for (const x of s) if (x[0] >= a && x[0] < end) f(x[1], x[0]); };
    scan("pv", v => mx("pvMax", v)); scan("bat", v => { mx("chMax", v); mx("disMax", -v); }); scan("load", v => mx("ldMax", v));
    scan("soc", (v, t) => { mn("sMin", v, t, "tMin"); mx("sMax", v, t, "tMax"); });
  } else {
    const S = D.st;
    for (const x of S.pv || []) if (x.t >= a && x.t < end) { add("pv", Math.max(0, x.mean)); mx("pvMax", x.max); }
    for (const x of S.bat || []) if (x.t >= a && x.t < end) { if (x.mean > 0) add("ch", x.mean); else add("dis", -x.mean); mx("chMax", x.max); mx("disMax", -x.min); }
    for (const x of S.load || []) if (x.t >= a && x.t < end) { add("load", Math.max(0, x.mean)); mx("ldMax", x.max); }
    for (const x of S.soc || []) if (x.t >= a && x.t < end) { mn("sMin", x.min, x.t, "tMin"); mx("sMax", x.max, x.t, "tMax"); }
    if (r.ch === null && S.bat?.length) r.ch = 0; if (r.dis === null && S.bat?.length) r.dis = 0;
  }
  // inverter energy counters win over power × time (exact values from the inverter)
  const E = D.en || {}, src = r.src = {};
  for (const [k, f] of [["pvE", "pv"], ["chE", "ch"], ["disE", "dis"], ["loadE", "load"]]) {
    if (!E[k]) continue;
    const v = D.long ? E[k].filter(x => x.t >= a && x.t < end).reduce((s, x) => s + x.e, 0) : pwDelta(E[k], a, end);
    if (isNum(v)) { r[f] = v; src[f] = 1; }
  }
  for (const s of slots) {
    if (s.t < a || s.t >= b || !s.past) continue;
    if (isNum(s.di)) { add("imp", s.di); if (isNum(s.buy)) add("cost", s.di * s.buy); add(s.z === "s2" ? "impS2" : "impS1", s.di); if (isNum(s.buy)) add(s.z === "s2" ? "costS2" : "costS1", s.di * s.buy); }
    if (isNum(s.de)) { add("exp", s.de); if (isNum(s.sell)) add("val", s.de * s.sell); if (s.de > 0.001 && isNum(s.sell) && (!r.best || s.sell > r.best.sell)) r.best = { sell: s.sell, t: s.t, kwh: s.de }; }
  }
  // v1.7.7: purchase split – what went straight to the house vs. into storage (same quarter / hour: house first)
  if (isNum(r.imp) && (E.loadE || D.raw?.load?.length || D.st?.load?.length)) {
    let hk = 0, hc = 0;
    const inR = s => s.t >= a && s.t < b && s.past && isNum(s.di);
    if (!D.long) {
      for (const s of slots) { if (!inR(s)) continue; const t1 = Math.min(s.t + 9e5, D.end);
        const dl = E.loadE ? pwDelta(E.loadE, s.t, t1) : pwEnergy(D.raw.load, s.t, t1).pos; if (!isNum(dl)) continue;
        const h = Math.min(s.di, Math.max(0, dl)); s.hb = s.di - h; hk += h; if (isNum(s.buy)) hc += h * s.buy; }
    } else {
      const lh = new Map(); for (const x of E.loadE || []) lh.set(x.t, x.e); if (!E.loadE) for (const x of D.st.load || []) lh.set(x.t, Math.max(0, x.mean));
      const byH = new Map(); for (const s of slots) { if (!inR(s)) continue; const hT = s.t - s.t % 36e5; (byH.get(hT) || byH.set(hT, []).get(hT)).push(s); }
      for (const [hT, ss] of byH) { const imp = ss.reduce((q, s) => q + s.di, 0), ld = lh.get(hT); if (!isNum(ld) || imp <= 0) continue;
        const k = Math.min(imp, ld) / imp; for (const s of ss) { s.hb = s.di * (1 - k); hk += s.di * k; if (isNum(s.buy)) hc += s.di * k * s.buy; } }
    }
    r.houseKwh = hk; r.houseCost = hc; r.batKwh = Math.max(0, r.imp - hk); r.batCost = Math.max(0, (r.cost || 0) - hc);
    if (isNum(r.val)) r.profit = r.val - (r.exp || 0) * (r.batKwh > 0 ? r.batCost / r.batKwh : 0);
  }
  r.buy = isNum(r.cost) && r.imp > 0 ? r.cost / r.imp : null;
  // automation profit – a sold kWh pays off only above: cost of the kWh in storage + distribution you pay anyway when buying it back (deposit covers energy only)
  const ap = D.ap;
  if (ap && isNum(r.exp)) {
    const sc = isNum(ap.fixedSc) ? ap.fixedSc : r.batKwh > 0 ? r.batCost / r.batKwh : isNum(ap.cost) ? ap.cost : isNum(r.buy) ? r.buy : ap.fallback;
    const thr = sc + ap.dist;
    const A = r.ap = { sc, thr, okK: 0, okV: 0, okG: 0, badK: 0, badV: 0, badG: 0, best: null, worst: null };
    for (const s of slots) {
      if (s.t < a || s.t >= b || !s.past || !(s.de > 0.001) || !isNum(s.sell)) continue;
      const g = s.de * (s.sell - thr), x = { t: s.t, sell: s.sell, kwh: s.de, g };
      if (s.sell >= thr) { A.okK += s.de; A.okV += s.de * s.sell; A.okG += g; } else { A.badK += s.de; A.badV += s.de * s.sell; A.badG += g; }
      if (!A.best || s.sell > A.best.sell) A.best = x; if (!A.worst || s.sell < A.worst.sell) A.worst = x;
    }
    A.gain = A.okG + A.badG;
    // battery losses measured by the counters: charged − discharged (part of it may still sit in the battery -> SOC change shown next to it)
    A.lossK = isNum(r.ch) && isNum(r.dis) ? r.ch - r.dis : null;
    A.loss = isNum(A.lossK) ? A.lossK * sc : null;
    const so = D.raw?.soc; A.socD = !D.long && so?.length && isNum(pwAt(so, a)) && isNum(pwAt(so, end)) ? pwAt(so, end) - pwAt(so, a) : null;
    A.toBat = slots.filter(s => s.t >= a && s.t < b && s.past).reduce((q, s) => q + (s.hb || 0), 0);
  }
  r.sell = isNum(r.val) && r.exp > 0 ? r.val / r.exp : null;
  return r;
}
function pwBuckets(r) {
  const out = [];
  if (r.mode === "year") for (let m = 0; m < 12; m++) { const a = new Date(r.start.getFullYear(), m, 1); out.push({ a: +a, b: +new Date(a.getFullYear(), m + 1, 1), lab: MONTH_SHORT[m], tip: monthName(a), d: a }); }
  else for (let d = new Date(r.start); d < r.end; d = addDays(d, 1)) out.push({ a: +d, b: +addDays(d, 1), lab: pad(d.getDate()), tip: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`, d });
  return out;
}
function pwModel(st, D, m) {
  const r = st.range, tz = m.tariff?.price_gross || {};
  if (!D || D.error) return { r, D };
  const tr = m.tariff || {}, pw = tr.dist_gross ? { dist: Number(tr.dist_gross.s1), fallback: Number(tr.price_gross?.s1) } : null;
  D.ap = pw && isNum(pw.dist) ? pw : null;
  const slots = pwSlots(D, tz); if (D.ap) D.ap.fixedSc = null;
  const tot = pwAgg(D, slots, D.a, D.b, tz); if (D.ap && tot.ap) D.ap.fixedSc = tot.ap.sc; // buckets use the period threshold
  const buckets = D.long ? pwBuckets(r).map(x => ({ ...x, live: x.a < D.end, v: x.a < D.end ? pwAgg(D, slots, x.a, x.b, tz) : null })) : null;
  return { r, D, slots, tot, buckets };
}
const pwSmooth = pts => { if (!pts.length) return ""; let s = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`; for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [c, e] = pts[i], mm = (a + c) / 2; s += `C${mm.toFixed(1)} ${b.toFixed(1)},${mm.toFixed(1)} ${e.toFixed(1)},${c.toFixed(1)} ${e.toFixed(1)}`; } return s; };
const pwPriceTop = vals => Math.max(3, Math.ceil(Math.max(0, ...vals.filter(isNum)) * 2) / 2);
// many raw points per pixel (week): keep first / min / max / last of each pixel – no averaging, peaks stay
function pwThin(s, X) {
  if (s.length < 2500) return s;
  const out = []; let px = null, g = [];
  const flush = () => { if (!g.length) return; let lo = g[0], hi = g[0]; for (const p of g) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; } const set = [g[0], lo, hi, g[g.length - 1]].sort((x, y) => x[0] - y[0]); for (const p of set) if (out[out.length - 1] !== p) out.push(p); };
  for (const p of s) { const q = Math.floor(X(p[0])); if (q !== px) { flush(); g = []; px = q; } g.push(p); }
  flush(); return out;
}
function pwSvg(M, off) {
  const W = 1000, H = 400, L = 50, R = 60, T = 16, B = 34, now = Date.now(), { D, r } = M, a = D.a, b = D.b, end = D.end;
  const X = t => L + (t - a) / (b - a) * (W - L - R);
  const defs = `<defs><filter id="pwgl" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  let g = "", kw = [], unit = "kW";
  const prices = M.slots.flatMap(s => [off.buy ? null : s.buy, off.sell ? null : s.sell]);
  if (D.long) { unit = "kWh"; for (const x of M.buckets) if (x.v) { const v = x.v; if (!off.pv) kw.push(v.pv); if (!off.load) kw.push(v.load); if (!off.bat) kw.push(v.ch, -(v.dis || 0)); if (!off.grid) kw.push(v.imp, -(v.exp || 0)); } }
  else for (const k of PW_LINES) if (!off[k]) for (const x of D.raw[k] || []) if (x[0] >= a && x[0] < b) kw.push(x[1]);
  kw = kw.filter(isNum);
  let lo = Math.min(0, ...kw), hi = Math.max(1, ...kw); const st = niceStep(hi - lo, 6); lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B), YS = p => T + (100 - p) / 100 * (H - T - B), pTop = pwPriceTop(D.long ? M.buckets.flatMap(x => [x.v?.buy, x.v?.sell]) : prices), YP = v => T + (pTop - v) / pTop * (H - T - B);
  if (!D.long) for (let t = a; t < b; t += 36e5) if (g12Zone(new Date(t)) === "s2") g += `<rect x="${X(t)}" y="${T}" width="${X(t + 36e5) - X(t)}" height="${H - T - B}" class="pw-night"/>`;
  for (let v = lo; v <= hi + st / 1e6; v += st) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${Math.abs(v) < st / 1e6 ? "zero" : "grid"}"/><text x="${L - 7}" y="${Y(v) + 4}" text-anchor="end" class="ax">${String(+v.toFixed(2)).replace(".", ",")}</text>`;
  const pst = pTop > 4 ? 1 : 0.5; for (let v = 0; v <= pTop + 1e-9; v += pst) g += `<text x="${W - R + 6}" y="${YP(v) + 4}" class="ax pw-pax">${NF.format(v)}</text>`;
  g += `<text x="4" y="12" class="unit">${unit}</text><text x="${W - R + 4}" y="12" class="unit pw-pax">zł/kWh</text>`;
  // x labels
  if (D.long) { const bk = M.buckets, ev = bk.length > 16 ? 2 : 1; bk.forEach((x, i) => { if (i % ev === 0) g += `<text x="${X((x.a + x.b) / 2)}" y="${H - 12}" text-anchor="middle" class="xl">${x.lab}</text>`; }); }
  else if (b - a > 1.5 * 864e5) for (let d = new Date(a); +d < b; d = addDays(d, 1)) g += `<line x1="${X(+d)}" x2="${X(+d)}" y1="${T}" y2="${H - B}" class="vgrid"/><text x="${X(+d + 432e5)}" y="${H - 12}" text-anchor="middle" class="xl">${["nd", "pon", "wt", "śr", "czw", "pt", "sob"][d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}</text>`;
  else for (let h = 0; h <= 24; h += 2) { const t = +new Date(new Date(a).setHours(h, 0, 0, 0)); if (t >= a && t <= b) g += `<text x="${X(t)}" y="${H - 12}" text-anchor="middle" class="xl">${pad(h % 24)}:00</text>`; }
  if (!D.long) {
    const path = (s, y) => { let d = "", prev = null; for (const [t, v] of s) { if (t >= end) break; const x = X(Math.max(a, t)); d += prev === null ? `M${x.toFixed(1)} ${y(v).toFixed(1)}` : `H${x.toFixed(1)}V${y(v).toFixed(1)}`; prev = v; } return d && prev !== null ? d + `H${X(end).toFixed(1)}` : ""; };
    const clip = s => { const v0 = pwAt(s, a); return pwThin((isNum(v0) ? [[a, v0]] : []).concat(s.filter(x => x[0] > a && x[0] < end)), X); };
    const wk = b - a > 1.5 * 864e5;
    for (const k of PW_LINES) {
      const s = D.raw[k]; if (!s?.length || off[k]) continue;
      const c = clip(s), d = path(c, Y); if (!d) continue;
      if (k === "bat" || k === "grid") g += `<path d="${d}V${Y(0)}H${X(Math.max(a, c[0][0]))}Z" fill="${PW[k].color}" opacity=".14"/>`;
      g += `<path d="${d}" fill="none" stroke="${PW[k].color}" stroke-width="${wk ? 1 : 1.5}" stroke-linejoin="round" opacity=".9"/>`;
    }
    // neon price steps: thin = price in force, thick glow = really bought / sold in that quarter
    const step = (k, act, c) => { let d = "", h = ""; for (const s of M.slots) { const v = s[k]; if (!isNum(v)) continue; const x0 = X(s.t), x1 = X(s.t + 9e5), y = YP(v).toFixed(1); d += `M${x0.toFixed(1)} ${y}H${x1.toFixed(1)}`; if (act(s)) h += `M${x0.toFixed(1)} ${y}H${x1.toFixed(1)}`; } return (d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" opacity=".55"/>` : "") + (h ? `<path d="${h}" fill="none" stroke="${c}" stroke-width="${wk ? 3 : 4}" stroke-linecap="round" filter="url(#pwgl)"/>` : ""); };
    if (!off.buy) g += step("buy", s => s.di > 0.001, PINK);
    if (!off.sell) g += step("sell", s => s.de > 0.001, CYAN);
    // SOC on top: light fill + thick line
    const so = D.raw.soc; if (so?.length && !off.soc) { const c = clip(so), d = path(c, YS); if (d) g += `<path d="${d}V${YS(0)}H${X(Math.max(a, c[0][0]))}Z" fill="${TONE.blue}" opacity=".08"/><path d="${d}" fill="none" stroke="${TONE.blue}" stroke-width="3" stroke-linejoin="round"/>`; }
    if (now > a && now < b) g += `<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}" class="nowl"/><text x="${X(now) + 5}" y="${T + 12}" class="nowt">teraz</text>`;
  } else {
    const live = M.buckets.filter(x => x.v), cx = x => X((x.a + x.b) / 2);
    const line = (f, c, w = 2) => { const p = live.filter(x => isNum(f(x.v))).map(x => [cx(x), f(x.v)]); return p.length ? `<path d="${pwSmooth(p.map(q => [q[0], Y(q[1])]))}" fill="none" stroke="${c}" stroke-width="${w}"/>` : ""; };
    const area = (f, c, op) => { const p = live.filter(x => isNum(f(x.v))).map(x => [cx(x), Y(f(x.v))]); if (!p.length) return ""; const d = pwSmooth(p); return `<path d="${d}L${p[p.length - 1][0].toFixed(1)} ${Y(0)}L${p[0][0].toFixed(1)} ${Y(0)}Z" fill="${c}" opacity="${op}"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.8"/>`; };
    if (!off.bat) g += area(v => v.ch, PW.bat.color, .14) + area(v => isNum(v.dis) ? -v.dis : null, PW.bat.color, .09);
    if (!off.grid) g += area(v => v.imp, PW.grid.color, .14) + area(v => isNum(v.exp) ? -v.exp : null, PW.grid.color, .09);
    if (!off.pv) g += line(v => v.pv, PW.pv.color); if (!off.load) g += line(v => v.load, PW.load.color);
    for (const [k, c] of [["buy", PINK], ["sell", CYAN]]) if (!off[k]) { const p = live.filter(x => isNum(x.v[k])).map(x => [cx(x), YP(x.v[k])]); if (p.length) g += `<path d="${pwSmooth(p)}" fill="none" stroke="${c}" stroke-width="3" filter="url(#pwgl)"/>` + p.map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5" fill="${c}" filter="url(#pwgl)"/>`).join(""); }
    if (!off.soc) { const p = live.filter(x => isNum(x.v.sMax) && isNum(x.v.sMin)); if (p.length) { const top = p.map(x => [cx(x), YS(x.v.sMax)]), bot = p.map(x => [cx(x), YS(x.v.sMin)]).reverse(); g += `<path d="${pwSmooth(top)}L${bot.map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}Z" fill="${TONE.blue}" opacity=".09"/><path d="${pwSmooth(bot.slice().reverse())}" fill="none" stroke="${TONE.blue}" stroke-width="1.2" opacity=".6"/><path d="${pwSmooth(top)}" fill="none" stroke="${TONE.blue}" stroke-width="3"/>`; } }
    if (now > a && now < b) g += `<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}" class="nowl"/><text x="${X(now) + 5}" y="${T + 12}" class="nowt">teraz</text>`;
  }
  if (!off.soc && (D.raw.soc?.length || D.st?.soc?.length)) for (let p = 0; p <= 100; p += 25) g += `<text x="${L + 4}" y="${YS(p) - 3}" class="ax pw-sax">${p}%</text>`;
  return `<svg class="pw-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${defs}${g}<line class="pw-hl" y1="${T}" y2="${H - B}" style="display:none"/><g class="pw-dots"></g><rect class="pw-ov" x="${L}" y="${T}" width="${Math.max(0, X(end) - L)}" height="${H - T - B}" fill="transparent" data-a="${a}" data-b="${b}" data-l="${L}" data-r="${R}" data-w="${W}"/></svg>`;
}
function pwTitle(r) {
  const t = new Date(), d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  if (r.mode === "day") return isoDate(r.start) === isoDate(d0) ? "dziś" : isoDate(r.start) === isoDate(addDays(d0, -1)) ? "wczoraj" : plDate(r.start);
  return rangeLabel(r);
}
function pwCard(st, cfg, m, M, hass) {
  const liveVal = k => { const x = hass?.states?.[cfg[k]?.id]; return x && isNum(x.state) ? Number(x.state) * pwFactor(k, hass, cfg[k].id) * (PW[k].kind === "power" ? cfg[k].sign : 1) : null; };
  if (!Object.keys(cfg).length) return `<section class="box pw"><div class="pw-head"><h3>Moc i bateria</h3></div><div class="nohist">Wskaż encje (moc PV, baterii, konsumpcji, sieci, SOC oraz liczniki falownika poboru i oddania) w Ustawienia → Urządzenia i usługi → PGE Net-Billing → Konfiguruj. Brakujące encje są po prostu pomijane.</div></section>`;
  const r = st.range, t0 = new Date(), today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()), isDay = r.mode === "day";
  const on = k => (k === "today" && isDay && isoDate(r.start) === isoDate(today)) || (k === "yday" && isDay && isoDate(r.start) === isoDate(addDays(today, -1))) || k === r.mode;
  const D = M?.D, T = M?.tot || {}, live = r.end > Date.now(), nowSoc = cfg.soc ? liveVal("soc") : null;
  const kw = v => isNum(v) ? NF.format(v) + " kW" : "—", pct = v => isNum(v) ? Math.round(v) + "%" : "—", price = v => isNum(v) ? NF4.format(v) + " zł/kWh" : "—";
  const at = t => !isNum(t) ? "" : isDay ? `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}` : r.mode === "year" || r.mode === "month" ? `${dayShort(new Date(t))} ${pad(new Date(t).getHours())}:00` : `${dayShort(new Date(t))} ${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;
  const tile = (key, hist, color, label, val, sub, vc) => `<div class="pw-tile hist" data-hist="${hist}" tabindex="0" role="button" title="Kliknij: historia"><small><i style="background:${color}"></i>${label}</small><b style="color:${vc || color}">${val}</b><em>${sub}</em></div>`;
  const miss = "brak encji – ustaw w opcjach";
  const e1 = [
    tile("pv", "pw_pv", PW.pv.color, "Produkcja PV", cfg.pv || cfg.pvE ? kwh(T.pv) : "—", cfg.pv || cfg.pvE ? (cfg.pv ? `szczyt ${kw(T.pvMax)}` : "") + (T.src?.pv ? (cfg.pv ? " · " : "") + "licznik falownika" : "") : miss),
    tile("ch", "pw_bat", PW.bat.color, "Ładowanie baterii", cfg.bat || cfg.chE ? kwh(T.ch) : "—", cfg.bat || cfg.chE ? (cfg.bat ? `maks. moc ${kw(T.chMax)}` : "") + (T.src?.ch ? (cfg.bat ? " · " : "") + "licznik" : "") : miss),
    tile("dis", "pw_bat", PW.bat.color, "Rozładowanie baterii", cfg.bat || cfg.disE ? kwh(T.dis) : "—", cfg.bat || cfg.disE ? (cfg.bat ? `maks. moc ${kw(T.disMax)}` : "") + (T.src?.dis ? (cfg.bat ? " · " : "") + "licznik" : "") : miss, "#b7aaff"),
    tile("soc", "pw_soc", TONE.blue, "SOC magazynu min / maks", cfg.soc ? `${pct(T.sMin)} <span class="pw-arr">→</span> ${pct(T.sMax)}` : "—", cfg.soc ? `${isNum(T.tMin) ? "min " + at(T.tMin) + " · maks " + at(T.tMax) : ""}${live && isNum(nowSoc) ? " · teraz " + pct(nowSoc) : ""}` : miss),
    tile("imp", cfg.grid ? "pw_grid" : "cost", PW.grid.color, "Import z sieci", cfg.imp ? kwh(T.imp) : "—", cfg.imp ? "licznik falownika" : miss),
    tile("exp", cfg.grid ? "pw_grid" : "sell", PW.grid.color, "Eksport do sieci", cfg.exp ? kwh(T.exp) : "—", cfg.exp ? "licznik falownika" : miss, "#ffd27a"),
    tile("load", "pw_load", PW.load.color, "Pobór domu", cfg.load || cfg.loadE ? kwh(T.load) : "—", cfg.load || cfg.loadE ? `${T.src?.load ? "licznik · " : ""}szczyt ${kw(T.ldMax)}${live && isDay ? " · teraz " + kw(liveVal("load")) : ""}` : miss),
  ].join("");
  const b = T.best;
  const e2 = [
    tile("cost", "cost", TONE.red, "Zapłacono za zakup", cfg.imp ? zl(T.cost) : "—", cfg.imp ? "energia brutto (G12)" : miss),
    tile("house", "cost", "#ff8a5b", "Zakup – poszło na dom", cfg.imp && isNum(T.houseCost) ? zl(T.houseCost) : "—", cfg.imp ? (isNum(T.houseKwh) ? `${kwh(T.houseKwh)} · ${isNum(T.imp) && T.imp > 0 ? Math.round((T.houseKwh || 0) / T.imp * 100) : 0}% zakupu` : "brak zużycia domu") : miss),
    tile("tobat", "cost", "#8b7cff", "Zakup – do magazynu", cfg.imp && isNum(T.batCost) ? zl(T.batCost) : "—", cfg.imp ? (isNum(T.batKwh) ? `${kwh(T.batKwh)} · ${isNum(T.imp) && T.imp > 0 ? Math.round((T.batKwh || 0) / T.imp * 100) : 0}% zakupu` : "brak zużycia domu") : miss, "#b7aaff"),
    tile("val", "sell", TONE.green, "Wartość sprzedaży", cfg.exp ? zl(T.val) : "—", cfg.exp ? "RCE brutto – trafia do depozytu" : miss),
    tile("profit", "sell", TONE.green, "Zarobek na sprzedaży", cfg.exp && isNum(T.profit) ? zl(T.profit, true) : "—", cfg.exp ? "sprzedaż − koszt sprzedanej energii z magazynu" : miss, isNum(T.profit) && T.profit < 0 ? TONE.red : TONE.green),
    tile("buy", "tariff", PINK, "Śr. cena kupna", cfg.imp ? price(T.buy) : "—", cfg.imp ? `z ${kwh(T.imp)} importu` : miss),
    tile("cheap", "tariff", TONE.blue, "Kupno – tania taryfa nocna", cfg.imp ? kwh(T.impS2 || 0) : "—", cfg.imp ? `za ${zl(T.costS2 || 0)} · ${isNum(T.imp) && T.imp > 0 ? Math.round((T.impS2 || 0) / T.imp * 100) : 0}%` : miss, "#7fb3ff"),
    tile("dear", "tariff", PINK, "Kupno – droga taryfa dzienna", cfg.imp ? kwh(T.impS1 || 0) : "—", cfg.imp ? `za ${zl(T.costS1 || 0)} · ${isNum(T.imp) && T.imp > 0 ? Math.round((T.impS1 || 0) / T.imp * 100) : 0}%` : miss),
    tile("sell", "rce", CYAN, "Śr. cena sprzedaży", cfg.exp ? price(T.sell) : "—", cfg.exp ? `z ${kwh(T.exp)} eksportu` : miss),
    tile("best", "rce", CYAN, "Najwyższa cena sprzedaży", cfg.exp ? (b ? price(b.sell) : "—") : "—", cfg.exp ? (b ? `${isDay ? "" : dayShort(new Date(b.t)) + " "}${pad(new Date(b.t).getHours())}:${pad(new Date(b.t).getMinutes())}–${pad(new Date(b.t + 9e5).getHours())}:${pad(new Date(b.t + 9e5).getMinutes())} · sprzedano ${kwh(b.kwh)}` : "brak sprzedaży w okresie") : miss),
  ].join("");
  const body = !D ? `<div class="nohist big">Ładowanie…</div>` : D.error ? `<div class="nohist big">Nie udało się pobrać historii: ${esc(D.error)}</div>` : pwSvg(M, st.off);
  return `<section class="box pw">
  <div class="pw-head"><h3>Moc i bateria <span>(${esc(pwTitle(r))})</span></h3>${cfg.soc && isNum(nowSoc) ? `<div class="muted">teraz · SOC <b class="t-blue">${pct(nowSoc)}</b></div>` : ""}</div>
  <div class="fc-ctrl"><button class="fc-btn fc-arrow" data-pw="-1" aria-label="Wcześniej"><ha-icon icon="mdi:chevron-left"></ha-icon></button><button class="fc-btn fc-arrow" data-pw="1" ${r.end > Date.now() ? "disabled" : ""} aria-label="Później"><ha-icon icon="mdi:chevron-right"></ha-icon></button><span class="fc-sep"></span>
    <button class="fc-btn fc-mode${on("today") ? " on" : ""}" data-pwm="today">Dzisiaj</button><button class="fc-btn fc-mode${on("yday") ? " on" : ""}" data-pwm="yday">Wczoraj</button><span class="fc-sep"></span>
    ${PW_MODES.map(([k, l]) => `<button class="fc-btn fc-mode${on(k) ? " on" : ""}" data-pwm="${k}">${l}</button>`).join("")}</div>
  <div class="pw-legend">${PW_LEGEND.filter(([k]) => k === "buy" || k === "sell" ? true : k === "grid" ? cfg.grid || cfg.imp || cfg.exp : cfg[k]).map(([k, l, c]) => `<button class="pw-lg${st.off[k] ? " off" : ""}" data-lg="${k}"><i style="background:${c}"></i>${l}</button>`).join("")}</div>
  <div class="pw-plot">${body}<div class="fc-tip pw-tip" hidden></div></div>
  <div class="pw-sec">Energia</div><div class="pw-tiles">${e1}</div>
  <div class="pw-sec">Pieniądze</div><div class="pw-tiles">${e2}</div>
  ${cfg.imp && isNum(T.houseCost) ? `<div class="pw-flow"><b style="color:${TONE.red}">Zapłacono ${zl(T.cost)}</b><span>=</span><b style="color:#ff8a5b">na dom ${zl(T.houseCost)}</b><span>+</span><b style="color:#b7aaff">do magazynu ${zl(T.batCost)}</b>${cfg.exp && isNum(T.val) ? `<span>·</span><span>sprzedano ${kwh(T.exp)} za</span><b style="color:${TONE.green}">${zl(T.val)}</b>` : ""}</div>` : ""}
  ${apSection(M, cfg, isDay)}
  <div class="pw-note">${D?.long ? "Punkt = suma energii w " + (r.mode === "year" ? "miesiącu" : "dniu") + " (z liczników falownika, a gdzie ich brak – moc z godzinowych statystyk HA × 1 h; SOC = najniższy i najwyższy odczyt). " : "Surowe odczyty z historii HA (bez uśredniania; przy wielu odczytach na piksel rysowany jest najniższy i najwyższy). "}Kupno / sprzedaż = przyrost liczników falownika w każdym kwadransie × cena G12 brutto / RCE brutto z tego kwadransu. „Na dom” = w każdym kwadransie (Miesiąc / Rok: godzinie) mniejsza z wartości: kupione, zużyte przez dom; reszta = do magazynu. Zarobek = sprzedaż − sprzedane kWh × średni koszt zakupu do magazynu. Gruba neonowa linia = wtedy faktycznie kupowałeś (róż) albo sprzedawałeś (turkus). Ceny G12 wg obecnych stawek z konfiguracji.</div>
</section>`;
}
const PW_CSS = `
.pw{margin-top:13px;padding:16px 16px 12px}.pw-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.pw-head h3{margin:0;font-size:18px}.pw-head h3 span{color:var(--mut);font-weight:400}
.pw .fc-ctrl{margin:12px 0 4px}
.pw-legend{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px}.pw-lg{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;color:var(--mut2);padding:4px 10px;border:1px solid #1d3a55;border-radius:20px;background:transparent;cursor:pointer}.pw-lg.off{opacity:.35}.pw-lg i{width:14px;height:4px;border-radius:2px}
.pw-plot{position:relative;min-height:260px}.pw-svg{width:100%;height:auto;display:block}.pw-svg .grid{stroke:#1a3246}.pw-svg .vgrid{stroke:#14293a}.pw-svg .zero{stroke:#3b5a73;stroke-width:1.2}.pw-svg .ax,.pw-svg .xl,.pw-svg .unit{fill:var(--mut);font-size:13px}.pw-svg .pw-pax{fill:${CYAN};opacity:.85}.pw-svg .pw-sax{fill:${TONE.blue};opacity:.55;font-size:11px}
.pw-night{fill:#3b8cff;opacity:.05}.pw-svg .nowl{stroke:#c9d7e2;stroke-dasharray:3 3;opacity:.6}.pw-svg .nowt{fill:#c9d7e2;font-size:12px}.pw-hl{stroke:#c9d7e2;opacity:.5}.pw-ov{cursor:crosshair}
.pw-tip .r{display:flex;justify-content:space-between;gap:16px}.pw-tip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.pw-tip hr{border:0;border-top:1px solid #1d3a55;margin:5px 0}.pw-tip .act{font-weight:600}
.pw-sec{font-size:12px;color:var(--mut);margin:12px 0 6px 2px}
.pw-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.pw-tile{border:1px solid #17304a;border-radius:10px;background:linear-gradient(150deg,#0d2131,#0a1a27);padding:8px 10px;min-width:0}
.pw-tile small{display:flex;align-items:center;gap:6px;color:var(--mut2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pw-tile small i{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.pw-tile b{display:block;font-size:17px;font-weight:700;margin-top:2px;white-space:nowrap}.pw-tile em{display:block;font-style:normal;color:var(--mut);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pw-arr{font-size:12px;color:var(--mut);font-weight:400}
.pw-note{font-size:11.5px;color:var(--mut);margin-top:10px}.pw-flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;margin:10px 0 0 2px;color:var(--mut2)}.pw-flow span{color:var(--mut)}.pw-flow b{font-weight:600}
@media(max-width:820px){.pw-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
/* ---------- "Zarobek z automatyki" (v1.8.0): when the system bought to storage and sold above / below the break-even ---------- */
function apBuckets(M) {
  const r = M.r, D = M.D, thr = M.tot?.ap?.thr, out = [];
  if (!isNum(thr)) return null;
  const mk = (a, b, lab, tip, d) => ({ a, b, lab, tip, d, okK: 0, badK: 0, okG: 0, badG: 0, val: 0, sk: 0, bk: 0, bc: 0, prices: [] });
  if (r.mode === "day") for (let h = 0; h < 24; h++) { const a = +new Date(new Date(D.a).setHours(h, 0, 0, 0)); out.push(mk(a, a + 36e5, pad(h), `${pad(h)}:00–${pad((h + 1) % 24)}:00`, new Date(a))); }
  else if (r.mode === "year") for (let m = 0; m < 12; m++) { const a = new Date(r.start.getFullYear(), m, 1); out.push(mk(+a, +new Date(a.getFullYear(), m + 1, 1), MONTH_SHORT[m], monthName(a), a)); }
  else for (let d = new Date(r.start); d < r.end; d = addDays(d, 1)) out.push(mk(+d, +addDays(d, 1), r.mode === "week" ? ["nd", "pon", "wt", "śr", "czw", "pt", "sob"][d.getDay()] : pad(d.getDate()), `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`, d));
  let j = 0;
  for (const s of M.slots) {
    while (j < out.length && s.t >= out[j].b) j++;
    const x = out[j]; if (!x || s.t < x.a || !s.past) continue;
    if (s.hb > 0) { x.bk += s.hb; if (isNum(s.buy)) x.bc += s.hb * s.buy; }
    if (s.de > 0.001 && isNum(s.sell)) { const g = s.de * (s.sell - thr); x.sk += s.de; x.val += s.de * s.sell; if (s.sell >= thr) { x.okK += s.de; x.okG += g; } else { x.badK += s.de; x.badG += g; } }
  }
  for (const x of out) x.live = x.a < D.end;
  return { thr, list: out };
}
function apSvg(M, AB) {
  const W = 1000, H = 330, L = 50, R = 60, T = 16, B = 34, D = M.D, a = AB.list[0].a, b = AB.list[AB.list.length - 1].b, now = Date.now();
  const X = t => L + (t - a) / (b - a) * (W - L - R), short = M.r.mode === "day" || M.r.mode === "week";
  const up = Math.max(0.5, ...AB.list.map(x => x.sk)), dn = Math.max(0.5, ...AB.list.map(x => x.bk));
  const st = niceStep(Math.max(up, dn), 3), hi = Math.ceil(up / st) * st, lo = -Math.ceil(dn / st) * st;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const px = [AB.thr]; if (short) for (const s of M.slots) if (s.t >= a && s.t < b) px.push(s.sell, s.buy); else null;
  if (!short) for (const x of AB.list) if (x.sk > 0) px.push(x.val / x.sk); if (!short) for (const x of AB.list) if (x.bk > 0) px.push(x.bc / x.bk);
  const pTop = pwPriceTop(px), YP = v => T + (pTop - v) / pTop * (H - T - B);
  let g = `<defs><filter id="apgl" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  if (M.r.mode === "day") for (const x of AB.list) if (g12Zone(new Date(x.a)) === "s2") g += `<rect x="${X(x.a)}" y="${T}" width="${X(x.b) - X(x.a)}" height="${H - T - B}" class="pw-night"/>`;
  for (let v = lo; v <= hi + st / 1e6; v += st) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${Math.abs(v) < st / 1e6 ? "zero" : "grid"}"/><text x="${L - 7}" y="${Y(v) + 4}" text-anchor="end" class="ax">${String(+Math.abs(v).toFixed(2)).replace(".", ",")}</text>`;
  const pst = pTop > 4 ? 1 : 0.5; for (let v = 0; v <= pTop + 1e-9; v += pst) g += `<text x="${W - R + 6}" y="${YP(v) + 4}" class="ax pw-pax">${NF.format(v)}</text>`;
  g += `<text x="4" y="12" class="unit">kWh</text><text x="${W - R + 4}" y="12" class="unit pw-pax">zł/kWh</text><text x="${L + 5}" y="${Y(hi) + 12}" class="ax" style="fill:${TONE.green};font-size:11px">sprzedaż ↑</text><text x="${L + 5}" y="${Y(lo) - 5}" class="ax" style="fill:#8b7cff;font-size:11px">kupno do magazynu ↓</text>`;
  const ev = AB.list.length > 16 ? 2 : 1;
  AB.list.forEach((x, i) => { if (i % ev === 0) g += `<text x="${X((x.a + x.b) / 2)}" y="${H - 12}" text-anchor="middle" class="xl">${x.lab}</text>`; });
  for (const x of AB.list) {
    if (!x.live) continue;
    const w = (X(x.b) - X(x.a)) * .62, x0 = X(x.a) + (X(x.b) - X(x.a) - w) / 2;
    if (x.okK > 0) g += `<rect x="${x0}" y="${Y(x.okK)}" width="${w}" height="${Y(0) - Y(x.okK)}" rx="2.5" fill="${TONE.green}" opacity=".85"/>`;
    if (x.badK > 0) g += `<rect x="${x0}" y="${Y(x.okK + x.badK)}" width="${w}" height="${Y(x.okK) - Y(x.okK + x.badK)}" rx="2.5" fill="${TONE.red}" opacity=".9"/>`;
    if (x.bk > 0) g += `<rect x="${x0}" y="${Y(0)}" width="${w}" height="${Y(-x.bk) - Y(0)}" rx="2.5" fill="#8b7cff" opacity=".7"/>`;
  }
  if (short) {
    const step = (k, c, wd, ex) => { let d = ""; for (const s of M.slots) { if (s.t < a || s.t >= b || !isNum(s[k])) continue; const y = YP(s[k]).toFixed(1); d += `M${X(s.t).toFixed(1)} ${y}H${X(s.t + 9e5).toFixed(1)}`; } return d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${wd}" ${ex}/>` : ""; };
    g += step("buy", PINK, 1.6, 'opacity=".7"') + step("sell", CYAN, 2.6, 'filter="url(#apgl)"');
  } else {
    for (const [f, c, wd] of [[x => x.bk > 0 ? x.bc / x.bk : null, PINK, 1.8], [x => x.sk > 0 ? x.val / x.sk : null, CYAN, 2.8]]) {
      const p = AB.list.filter(x => x.live && isNum(f(x))).map(x => [X((x.a + x.b) / 2), YP(f(x))]);
      if (p.length) g += `<path d="${pwSmooth(p)}" fill="none" stroke="${c}" stroke-width="${wd}" ${c === CYAN ? 'filter="url(#apgl)"' : 'opacity=".75"'}/>` + p.map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3" fill="${c}"/>`).join("");
    }
  }
  g += `<line x1="${L}" x2="${W - R}" y1="${YP(AB.thr)}" y2="${YP(AB.thr)}" stroke="${CYAN}" stroke-width="1.6" stroke-dasharray="7 5" opacity=".9"/><text x="${W - R - 4}" y="${YP(AB.thr) - 5}" text-anchor="end" class="ax pw-pax" style="font-size:11px">próg ${NF4.format(AB.thr)} zł</text>`;
  if (now > a && now < b) g += `<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}" class="nowl"/><text x="${X(now) + 5}" y="${T + 12}" class="nowt">teraz</text>`;
  g += `<line class="ap-hl" y1="${T}" y2="${H - B}" style="display:none"/>` + AB.list.map((x, i) => `<rect class="ap-hit" data-i="${i}" x="${X(x.a)}" y="${T}" width="${Math.max(1, X(x.b) - X(x.a))}" height="${H - T - B}" fill="transparent"/>`).join("");
  return `<svg class="pw-svg ap-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function apSection(M, cfg, isDay) {
  const T = M?.tot || {}, A = T.ap, AB = M?.D && !M.D.error && A ? apBuckets(M) : null;
  if (!cfg.exp) return "";
  const price = v => isNum(v) ? NF4.format(v) + " zł/kWh" : "—", pctS = (x, y) => y > 0 ? Math.round(x / y * 100) + "%" : "0%";
  const tile = (hist, color, label, val, sub, vc, cls = "") => `<div class="pw-tile hist${cls}" data-hist="${hist}" tabindex="0" role="button" title="Kliknij: historia"><small><i style="background:${color}"></i>${label}</small><b style="color:${vc || color}">${val}</b><em>${sub}</em></div>`;
  const when = x => x ? `${isDay ? "" : dayShort(new Date(x.t)) + " "}${pad(new Date(x.t).getHours())}:${pad(new Date(x.t).getMinutes())}–${pad(new Date(x.t + 9e5).getHours())}:${pad(new Date(x.t + 9e5).getMinutes())}` : "";
  const sold = A ? A.okK + A.badK : 0;
  const tiles = !A ? `<div class="nohist">Do policzenia progu potrzebne są liczniki falownika (import, eksport) i zużycie domu.</div>` : [
    tile("sell", TONE.green, "Realny zarobek automatyki", zl(A.gain, true), "sprzedaż − (koszt kWh w magazynie + dystrybucja)", A.gain < 0 ? TONE.red : TONE.green),
    tile("rce", CYAN, "Próg opłacalności sprzedaży", price(A.thr), `kWh w magazynie ${NF4.format(A.sc)} + dystrybucja ${NF4.format(M.D.ap.dist)}`),
    tile("rce", TONE.green, "kWh sprzedane powyżej progu", kwh(A.okK), `za ${zl(A.okV)} · zysk ${zl(A.okG, true)} · ${pctS(A.okK, sold)}`),
    tile("rce", TONE.red, "kWh sprzedane poniżej progu", kwh(A.badK), `za ${zl(A.badV)} · strata ${zl(A.badG, true)} · ${pctS(A.badK, sold)}`, null, A.badK > 0.001 ? " pw-bad" : ""),
    tile("rce", TONE.red, "Najgorsza sprzedaż", A.worst ? price(A.worst.sell) : "—", A.worst ? `${when(A.worst)} · ${kwh(A.worst.kwh)} · ${zl(A.worst.g, true)}` : "brak sprzedaży", A.worst && A.worst.g >= 0 ? TONE.green : TONE.red),
    tile("rce", CYAN, "Najlepsza sprzedaż", A.best ? price(A.best.sell) : "—", A.best ? `${when(A.best)} · ${kwh(A.best.kwh)} · ${zl(A.best.g, true)}` : "brak sprzedaży"),
    tile("cost", "#8b7cff", "Średni koszt kWh w magazynie", price(A.sc), isNum(T.batKwh) && T.batKwh > 0 ? `z ${kwh(T.batKwh)} kupionych do baterii` : "brak zakupu do baterii – wg średniej ceny kupna", "#b7aaff"),
    tile("pw_bat", TONE.orange, "Bateria: weszło − wyszło", isNum(A.lossK) ? kwh(A.lossK) : "—", isNum(A.lossK) ? `${zl(A.loss)} · ${isNum(A.socD) ? `SOC ${A.socD >= 0 ? "+" : ""}${Math.round(A.socD)} pp (część zostaje w baterii)` : "liczniki falownika"}` : "brak liczników baterii"),
  ].join("");
  const bar = A && sold > 0 ? `<div class="ap-bar"><i style="width:${A.okK / sold * 100}%;background:${TONE.green}"></i><i style="width:${A.badK / sold * 100}%;background:${TONE.red}"></i></div><div class="ap-leg"><span>sprzedane powyżej progu ${pctS(A.okK, sold)}</span><span>poniżej progu ${pctS(A.badK, sold)}</span></div>` : "";
  const strip = AB && M.r.mode === "day" ? `<div class="ap-strip">${AB.list.map(x => { const c = !x.live ? "" : x.badK > 0.001 ? TONE.red : x.okK > 0.001 ? TONE.green : x.bk > 0.001 ? "#8b7cff" : ""; return `<div style="${c ? `background:${c};color:#06111b` : ""}${!x.live ? ";opacity:.35" : ""}">${x.lab}</div>`; }).join("")}</div>` : "";
  return `<div class="pw-sec">Zarobek z automatyki</div>
  <div class="pw-legend ap-legend"><span><i style="background:#8b7cff"></i>Kupno do magazynu</span><span><i style="background:${TONE.green}"></i>Sprzedaż powyżej progu</span><span><i style="background:${TONE.red}"></i>Sprzedaż poniżej progu</span><span><i style="background:${CYAN}"></i>${isDay || M?.r.mode === "week" ? "Cena RCE" : "Śr. cena sprzedaży"}</span><span><i style="background:${PINK}"></i>${isDay || M?.r.mode === "week" ? "Cena kupna G12" : "Śr. cena zakupu do magazynu"}</span><span><i class="dash"></i>Próg opłacalności</span></div>
  <div class="pw-plot ap-plot">${AB ? apSvg(M, AB) : `<div class="nohist">${M?.D ? "Brak danych o sprzedaży w tym okresie" : "Ładowanie…"}</div>`}<div class="fc-tip ap-tip" hidden></div></div>
  ${strip}<div class="pw-tiles" style="margin-top:10px">${tiles}</div>${bar}`;
}
const AP_CSS = `
.ap-legend span{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mut2);padding:3px 8px}.ap-legend i{width:14px;height:6px;border-radius:2px}.ap-legend i.dash{background:repeating-linear-gradient(90deg,${CYAN} 0 4px,transparent 4px 7px)}
.ap-plot{min-height:200px}.ap-hl{stroke:#c9d7e2;opacity:.4}.ap-hit{cursor:pointer}
.ap-strip{display:flex;gap:3px;margin-top:8px;height:26px}.ap-strip div{flex:1;border-radius:4px;background:#14293a;color:var(--mut);font-size:10.5px;display:flex;align-items:center;justify-content:center;font-weight:600;overflow:hidden}
.ap-bar{height:10px;border-radius:6px;background:#14293a;overflow:hidden;display:flex;margin:10px 0 4px}.ap-bar i{display:block;height:100%}.ap-leg{display:flex;justify-content:space-between;font-size:12px;color:var(--mut)}
.pw-tile.pw-bad{border-color:${TONE.red}}
`;
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
  pw_pv: { title: "Moc produkcji PV", tone: TONE.green, kind: "power", pk: "pv", fmt: v => isNum(v) ? NF.format(v) + " kW" : "—", note: "Surowe odczyty z historii Home Assistant, bez uśredniania. Przyszłości nie ma – to pomiary." },
  pw_bat: { title: "Moc baterii", tone: "#8b7cff", kind: "power", pk: "bat", fmt: v => isNum(v) ? NF.format(v) + " kW" : "—", signed: true, note: "Surowe odczyty z historii HA. + = ładowanie, − = rozładowanie (znak ustawiasz w opcjach integracji)." },
  pw_grid: { title: "Moc sieci", tone: TONE.orange, kind: "power", pk: "grid", fmt: v => isNum(v) ? NF.format(v) + " kW" : "—", signed: true, note: "Surowe odczyty z historii HA. + = pobór z sieci, − = oddanie (znak ustawiasz w opcjach integracji)." },
  pw_load: { title: "Moc konsumpcji domu", tone: TONE.red, kind: "power", pk: "load", fmt: v => isNum(v) ? NF.format(v) + " kW" : "—", note: "Surowe odczyty z historii Home Assistant, bez uśredniania." },
  pw_soc: { title: "SOC baterii", tone: TONE.blue, kind: "power", pk: "soc", fmt: v => isNum(v) ? Math.round(v) + "%" : "—", note: "Surowe odczyty stanu naładowania z historii Home Assistant." },
  rce: { title: "Cena RCE brutto", tone: TONE.blue, kind: "rce", fmt: pricePL, note: "Ceny z PSE (RCE-PLN) × współczynnik prosumencki z konfiguracji (domyślnie 1,23) – tyle realnie trafia do depozytu za kWh (ujemne ceny depozyt liczy jako 0). Linia ciągła = historia, przerywana = ceny już opublikowane na przyszłość (D+1 ok. 14:30)." },
  tariff: { title: "Taryfa G12 – cena za kWh brutto", tone: TONE.orange, kind: "tariff", fmt: pricePL, note: "Harmonogram stref G12 jest znany z góry. Cena = energia + dystrybucja zmienna, brutto, wg obecnych stawek z konfiguracji (wstecz pokazuje dzisiejsze stawki)." },
};
const H_MODES = { energy: MODES, rce: MODES, tariff: MODES.slice(0, 3), months: [], power: MODES.slice(0, 3) };

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
  const hits = o.type === "step" ? `<rect class="hit ov" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-l="${L}" data-r="${R}" data-w="${W}" data-t0="${t0}" data-t1="${t1}"/>` : items.map((it, i) => `<rect class="hit" data-i="${i}" x="${X(it.t0)}" y="${T}" width="${Math.max(1, X(it.t1) - X(it.t0))}" height="${H - T - B}" fill="transparent"/>`).join("");
  return `<svg class="hs" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><text x="4" y="12" class="unit">${o.unit}</text>${g}${marks}${labs}${nowL}<line class="hl" y1="${T}" y2="${H - B}" style="display:none"/>${hits}</svg>`;
}

class PGEHistory extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._key = e => { if (e.key === "Escape") this.close(); }; }
  open(panel, key, range) {
    this._p = panel; this._k = key; const h = HIST[key], now = new Date();
    const pr = range || panel._range;
    this._r = h.kind === "power" ? (range && ["day", "week", "month"].includes(range.mode) ? range : makeRange(range?.mode === "year" ? "month" : "day", range?.mode === "year" ? now : range?.start || now)) : h.kind === "energy" && pr ? pr : makeRange(h.kind === "rce" && now.getHours() >= 15 ? "week" : "day", now);
    if (h.kind === "tariff" && !H_MODES.tariff.some(x => x[0] === this._r.mode)) this._r = makeRange("day", now);
    document.addEventListener("keydown", this._key);
    this._load();
  }
  close() { document.removeEventListener("keydown", this._key); this.remove(); }
  _set(r) { if (r && r.start < r.end) { this._r = r; this._load(); } }
  _limit() { // last day a range may start on
    const h = HIST[this._k], t = new Date(), d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return h.kind === "energy" || h.kind === "power" ? t : h.kind === "rce" ? addDays(d0, 1) : addDays(d0, 400);
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
        const days = (r.end - r.start) / 864e5, agg = "raw"; // always real 15-min prices, never averaged
        const res = await hass.callApi("GET", `pge_net_billing/rce?start=${isoDate(r.start)}&end=${isoDate(addDays(r.end, -1))}&agg=${agg}`);
        const mul = p._model().rceMul || 1.23, len = agg === "raw" ? 9e5 : agg === "hour" ? 36e5 : 864e5, now = Date.now();
        const items = (res?.rows || []).map(x => { const t = new Date(x[0]); const t1 = agg === "day" ? +addDays(t, 1) : +t + len;
          return { t0: +t, t1, v: x[1] * mul, lo: isNum(x[2]) ? x[2] * mul : undefined, hi: isNum(x[3]) ? x[3] * mul : undefined, tlo: x[4] ? new Date(x[4]) : t, thi: x[5] ? new Date(x[5]) : t, fut: +t > now, tip: agg === "raw" ? `${dayShort(t)}, ${pad(t.getHours())}:${pad(t.getMinutes())}–${pad(new Date(t1).getHours())}:${pad(new Date(t1).getMinutes())}` : agg === "hour" ? `${dayShort(t)}, ${pad(t.getHours())}:00–${pad((t.getHours() + 1) % 24)}:00` : `${dayShort(t)} ${t.getFullYear()}` }; });
        items.forEach(it => { const t = new Date(it.t0); if (t.getMinutes() || (days > 1.1 && t.getHours())) return;
          if (days <= 1.1) { if (t.getHours() % 3 === 0) it.lab = pad(t.getHours()) + ":00"; }
          else if (days <= 8) it.lab = dayShort(t);
          else if (days <= 62) { if (t.getDate() % 2 === 1) it.lab = pad(t.getDate()); }
          else if (t.getDate() === 1) it.lab = MONTH_SHORT[t.getMonth()]; });
        d = { items, agg, until: res?.published_until ? new Date(+new Date(res.published_until) + 9e5) : null };
      } else if (h.kind === "power") {
        const cfg = pwConfig(hass, p._ids), one = cfg[h.pk] ? { [h.pk]: cfg[h.pk] } : {};
        const res = await pwLoad(hass, one, +r.start, +r.end);
        if (res.error) throw new Error(res.error);
        const s0 = res[h.pk] || [], end = Math.min(+r.end, Date.now()), v0 = pwAt(s0, +r.start);
        const pts = (isNum(v0) ? [[+r.start, v0]] : []).concat(s0.filter(x => x[0] > +r.start && x[0] < end));
        const items = pts.map((x, i) => { const t1 = i + 1 < pts.length ? pts[i + 1][0] : end, t = new Date(x[0]);
          return { t0: x[0], t1, v: x[1], fut: false, tip: `${dayShort(t)} ${t.getFullYear()}, ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}` }; });
        const days = (r.end - r.start) / 864e5;
        for (let t = +r.start; t < +r.end; t += 36e5) { const dd = new Date(t), lab = days <= 1.1 ? (dd.getHours() % 3 ? "" : pad(dd.getHours()) + ":00") : dd.getHours() ? "" : days <= 8 ? dayShort(dd) : dd.getDate() % 2 ? pad(dd.getDate()) : "";
          if (lab) items.push({ t0: t, t1: t, v: null, lab, tip: "" }); }
        items.sort((x, y) => x.t0 - y.t0);
        d = { items, en: pwEnergy(s0, +r.start, end), pk: h.pk };
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
    if (h.kind === "power") {
      const now = nums.length ? nums.at(-1) : null, kwhS = v => isNum(v) ? kwh(v) : "—";
      const first = h.pk === "soc" ? box("Teraz / ostatni", now ? h.fmt(now.v) : "—", now?.tip || "") : h.pk === "bat" ? box("Ładowanie", kwhS(d.en.pos), "rozład. " + kwhS(d.en.neg)) : h.pk === "grid" ? box("Pobór z sieci", kwhS(d.en.pos), "oddano " + kwhS(d.en.neg)) : box("Energia w okresie", kwhS(d.en.pos));
      return first + box("Najwięcej", mx ? h.fmt(mx.v) : "—", mx?.tip || "") + box("Najmniej", mn ? h.fmt(mn.v) : "—", mn?.tip || "") + box("Odczytów", String(nums.length), "surowe, bez uśredniania");
    }
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
      // extremes from the real 15-min prices (hi/lo of each bucket), never from averages
      const at = t => `${dayShort(t)} ${t.getFullYear()}, ${pad(t.getHours())}:${pad(t.getMinutes())}`;
      const top = nums.length ? nums.reduce((a, b) => Number(b.hi ?? b.v) > Number(a.hi ?? a.v) ? b : a) : null;
      const bot = nums.length ? nums.reduce((a, b) => Number(b.lo ?? b.v) < Number(a.lo ?? a.v) ? b : a) : null;
      return box("Średnia w okresie", pricePL(avg), `z ${nums.length} cen 15-min`) + box("Najdrożej", top ? pricePL(top.hi ?? top.v) : "—", top ? at(top.thi || new Date(top.t0)) : "") + box("Najtaniej", bot ? pricePL(bot.lo ?? bot.v) : "—", bot ? at(bot.tlo || new Date(bot.t0)) : "") + box(nowI ? "Teraz" : "Opublikowane do", nowI ? pricePL(nowI.v) : d.until ? stamp(d.until) : "—", nowI && d.until ? `opublikowane do ${stamp(d.until)}` : "");
    }
    const z = g12Zone(new Date());
    return box("Strefa dzienna (S1)", pricePL(d.pg.s1)) + box("Strefa nocna (S2)", pricePL(d.pg.s2)) + box("Teraz", z === "s1" ? "dzienna" : "nocna", pricePL(d.pg[z])) + box("Strefa nocna", "22–6 + 13–15", "lato (IV–IX): 15–17");
  }
  _draw() {
    const h = HIST[this._k], r = this._r, d = this._d, lim = this._limit(), nx = shiftRange(r, 1);
    const unit = h.kind === "power" ? (h.pk === "soc" ? "%" : "kW") : h.kind === "energy" ? (["imp", "exp", "bal"].includes(this._k) ? "kWh" : "zł") : h.kind === "months" ? "zł" : "zł/kWh";
    const axis = v => h.kind === "energy" || h.kind === "months" || h.kind === "power" ? String(+v.toFixed(2)).replace(".", ",") : v.toFixed(2).replace(".", ",");
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
    const ov = svg.querySelector(".ov");
    if (ov) { // one overlay: find the real 15-min price under the cursor (binary search by time)
      const its = d.items, L = +ov.dataset.l, R = +ov.dataset.r, W = +ov.dataset.w, a = +ov.dataset.t0, b = +ov.dataset.t1;
      let last = -1;
      ov.onmousemove = e => {
        const bx = svg.getBoundingClientRect(), fx = (e.clientX - bx.left) / bx.width * W, t = a + (fx - L) / (W - L - R) * (b - a);
        let lo = 0, hi = its.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (its[mid].t0 <= t) lo = mid; else hi = mid - 1; }
        const it = its[lo]; if (!it || t < it.t0 || t >= it.t1 || lo === last) { if (!it || t < it.t0 || t >= it.t1) { tip.hidden = true; hl.style.display = "none"; last = -1; } return; }
        last = lo;
        const x = L + ((it.t0 + it.t1) / 2 - a) / (b - a) * (W - L - R);
        hl.style.display = ""; hl.setAttribute("x1", x); hl.setAttribute("x2", x);
        tip.innerHTML = `<div class="tt">${esc(it.tip)}${it.fut ? " · przyszłość" : ""}</div><b>${isNum(it.v) ? h.fmt(it.v) : "brak danych"}</b>${it.x ? `<div class="mut">${esc(it.x)}</div>` : ""}`;
        tip.hidden = false; tip.style.left = `clamp(100px, ${x / 10}%, calc(100% - 100px))`;
      };
    }
    svg.querySelectorAll(".hit:not(.ov)").forEach(el => {
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
  _pwState() {
    const t = new Date();
    this._pw ||= { range: makeRange("day", t), off: {}, M: null };
    return this._pw;
  }
  _pwEnsure() {
    const st = this._pwState(), cfg = pwConfig(this._hass, this._ids);
    if (!Object.keys(cfg).length || st.busy) return;
    const k = st.range.mode + isoDate(st.range.start) + JSON.stringify(cfg), live = st.range.end > Date.now();
    if (st.key === k && (!live || Date.now() - st.at < 60000)) return;
    st.busy = true;
    const m = this._model();
    pwFetch(this._hass, cfg, st.range, m.rceMul || 1.23).then(D => {
      st.busy = false;
      if (k !== st.range.mode + isoDate(st.range.start) + JSON.stringify(pwConfig(this._hass, this._ids))) { this._pwEnsure(); return; }
      st.D = D; st.key = k; st.at = Date.now(); this._draw();
    }).catch(e => { st.busy = false; st.D = { error: e?.message || String(e) }; st.key = k; st.at = Date.now(); this._draw(); });
  }
  _pwSet(range) { const st = this._pwState(); if (!range || !(range.start < range.end)) return; st.range = range; st.D = null; st.key = ""; this._draw(); }
  _pwModel(m) { const st = this._pwState(); return st.D ? pwModel(st, st.D, m) : null; }
  _bindPower(m, M) {
    const card = this.shadowRoot.querySelector(".pw"); if (!card) return;
    const st = this._pwState(), cfg = pwConfig(this._hass, this._ids), today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
    card.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => this._pwSet(shiftRange(st.range, Number(b.dataset.pw))));
    card.querySelectorAll("[data-pwm]").forEach(b => b.onclick = () => {
      const k = b.dataset.pwm;
      this._pwSet(k === "today" ? makeRange("day", today()) : k === "yday" ? makeRange("day", addDays(today(), -1)) : makeRange(k, new Date()));
    });
    card.querySelectorAll("[data-lg]").forEach(b => b.onclick = () => { st.off[b.dataset.lg] = !st.off[b.dataset.lg]; this._draw(); });
    const svg = card.querySelector(".pw-svg"), ov = card.querySelector(".pw-ov"), tip = card.querySelector(".pw-tip");
    if (!ov || !svg || !M?.D || M.D.error) return;
    const hl = svg.querySelector(".pw-hl"), dots = svg.querySelector(".pw-dots"), D = M.D;
    const a = +ov.dataset.a, b = +ov.dataset.b, L = +ov.dataset.l, R = +ov.dataset.r, W = +ov.dataset.w;
    const row = (c, l, v) => `<div class="r"><span><i style="background:${c}"></i>${l}</span><b>${v}</b></div>`;
    const price = v => isNum(v) ? NF4.format(v) + " zł/kWh" : "—", kw = v => isNum(v) ? NF.format(v) + " kW" : "—";
    const place = (fx, html) => { hl.style.display = ""; hl.setAttribute("x1", fx); hl.setAttribute("x2", fx); tip.innerHTML = html; tip.hidden = false; tip.style.left = `clamp(130px, ${fx / 10}%, calc(100% - 130px))`; };
    const fxOf = e => { const bx = svg.getBoundingClientRect(); return (e.clientX - bx.left) / bx.width * W; };
    if (!D.long) {
      ov.onmousemove = e => {
        const fx = fxOf(e), t = a + (fx - L) / (W - L - R) * (b - a), dt = new Date(t), s = M.slots[Math.floor((t - a) / 9e5)];
        let act = "";
        if (cfg.imp || cfg.exp) act = s?.di > 0.001 ? `<div class="r act" style="color:${PINK}"><span>Kupiłeś</span><b>${kwh(s.di)} po ${price(s.buy)}</b></div>`
          : s?.de > 0.001 ? `<div class="r act" style="color:${CYAN}"><span>Sprzedałeś</span><b>${kwh(s.de)} po ${price(s.sell)}</b></div>` : `<div class="r"><span>Brak wymiany z siecią</span><b>—</b></div>`;
        const q0 = s ? new Date(s.t) : dt, q1 = new Date(+q0 + 9e5);
        const vals = ["soc", "pv", "bat", "grid", "load"].filter(k => cfg[k] && !st.off[k]).map(k => { const v = pwAt(D.raw[k], t); return row(PW[k].color, PW[k].label, !isNum(v) ? "—" : k === "soc" ? Math.round(v) + "%" : kw(v)); }).join("");
        place(fx, `<div class="tt">${b - a > 1.5 * 864e5 ? dayShort(dt) + ", " : ""}${pad(dt.getHours())}:${pad(dt.getMinutes())} · ${s?.z === "s2" ? "strefa nocna" : "strefa dzienna"}</div>${act ? act + `<div class="mut" style="font-size:11px">w kwadransie ${pad(q0.getHours())}:${pad(q0.getMinutes())}–${pad(q1.getHours())}:${pad(q1.getMinutes())}</div><hr>` : ""}${row(PINK, "Cena kupna (G12)", price(s?.buy))}${row(CYAN, "Cena sprzedaży (RCE)", price(s?.sell))}${vals ? "<hr>" + vals : ""}`);
      };
    } else {
      const bk = M.buckets.filter(x => x.v), X = t => L + (t - a) / (b - a) * (W - L - R);
      const YS = p => 16 + (100 - p) / 100 * (400 - 16 - 34);
      let cur = null;
      ov.onmousemove = e => {
        const fx = fxOf(e), t = a + (fx - L) / (W - L - R) * (b - a);
        cur = bk.reduce((p, x) => !p || Math.abs((x.a + x.b) / 2 - t) < Math.abs((p.a + p.b) / 2 - t) ? x : p, null); if (!cur) return;
        const v = cur.v, cx = X((cur.a + cur.b) / 2);
        dots.innerHTML = cfg.soc && isNum(v.sMax) ? `<circle cx="${cx}" cy="${YS(v.sMax)}" r="4.5" fill="${TONE.blue}"/>` : "";
        const bst = v.best ? `${price(v.best.sell)} (${r2(v.best.t)})` : "—";
        place(cx, `<div class="tt">${esc(cur.tip)}${cur.b > Date.now() ? " (do teraz)" : ""} · kliknij = szczegóły</div>${cfg.imp ? row(PINK, "Kupiłeś po (śr.)", price(v.buy)) + row(TONE.red, "Zapłacono", zl(v.cost)) : ""}${cfg.exp ? row(CYAN, "Sprzedałeś po (śr.)", price(v.sell)) + row(CYAN, "Najwyższa sprzedaż", bst) + row(TONE.green, "Za sprzedaż", zl(v.val)) : ""}<hr>${cfg.pv ? row(PW.pv.color, "Produkcja", kwh(v.pv)) : ""}${cfg.bat ? row(PW.bat.color, "Ładowanie / rozład.", kwh(v.ch) + " / " + kwh(v.dis)) : ""}${cfg.imp || cfg.exp ? row(PW.grid.color, "Import / eksport", kwh(v.imp) + " / " + kwh(v.exp)) : ""}${cfg.imp ? row("#7fb3ff", "Kupno tanio", kwh(v.impS2 || 0) + " za " + zl(v.costS2 || 0)) + row(PINK, "Kupno drogo", kwh(v.impS1 || 0) + " za " + zl(v.costS1 || 0)) : ""}${cfg.load ? row(PW.load.color, "Pobór domu", kwh(v.load)) : ""}${cfg.soc ? row(TONE.blue, "SOC min / maks", (isNum(v.sMin) ? Math.round(v.sMin) + "%" : "—") + " → " + (isNum(v.sMax) ? Math.round(v.sMax) + "%" : "—")) : ""}`);
      };
      ov.onclick = () => { if (cur) this._pwSet(st.range.mode === "year" ? makeRange("month", cur.d) : makeRange("day", cur.d)); };
      ov.style.cursor = "pointer";
    }
    this._bindAp(M, cfg);
    function r2(t) { const d = new Date(t); return `${dayShort(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    ov.onmouseleave = () => { tip.hidden = true; hl.style.display = "none"; if (dots) dots.innerHTML = ""; };
  }
  _bindAp(M, cfg) {
    const card = this.shadowRoot.querySelector(".pw"), svg = card?.querySelector(".ap-svg"), tip = card?.querySelector(".ap-tip");
    if (!svg || !M?.tot?.ap) return;
    const AB = apBuckets(M); if (!AB) return;
    const hl = svg.querySelector(".ap-hl"), st = this._pwState(), price = v => isNum(v) ? NF4.format(v) + " zł/kWh" : "—";
    const row = (c, l, v) => `<div class="r"><span><i style="background:${c}"></i>${l}</span><b>${v}</b></div>`;
    svg.querySelectorAll(".ap-hit").forEach(el => {
      const x = AB.list[Number(el.dataset.i)];
      el.onmouseenter = () => {
        const cx = Number(el.getAttribute("x")) + Number(el.getAttribute("width")) / 2;
        hl.style.display = ""; hl.setAttribute("x1", cx); hl.setAttribute("x2", cx);
        const act = [];
        if (x.okK > 0.001) act.push(`<div class="r act" style="color:${TONE.green}"><span>Sprzedaż powyżej progu</span><b>${kwh(x.okK)} · ${zl(x.okG, true)}</b></div>`);
        if (x.badK > 0.001) act.push(`<div class="r act" style="color:${TONE.red}"><span>Sprzedaż poniżej progu</span><b>${kwh(x.badK)} · ${zl(x.badG, true)}</b></div>`);
        if (x.bk > 0.001) act.push(`<div class="r act" style="color:#b7aaff"><span>Kupno do magazynu</span><b>${kwh(x.bk)} za ${zl(x.bc)}</b></div>`);
        if (!act.length) act.push(`<div class="r"><span>${x.live ? "Automat nic nie sprzedawał ani nie kupował do magazynu" : "Jeszcze nie było"}</span><b>—</b></div>`);
        tip.innerHTML = `<div class="tt">${esc(x.tip)}${st.range.mode !== "day" && x.live ? " · kliknij = szczegóły" : ""}</div>${act.join("")}<hr>${x.sk > 0 ? row(CYAN, "Sprzedano po (śr.)", price(x.val / x.sk)) : ""}${x.bk > 0 ? row(PINK, "Kupiono do magazynu po (śr.)", price(x.bc / x.bk)) : ""}${row(CYAN, "Próg opłacalności", price(AB.thr))}${x.sk > 0 ? row("#9db2c3", "Wynik", zl(x.okG + x.badG, true)) : ""}`;
        tip.hidden = false; tip.style.left = `clamp(130px, ${cx / 10}%, calc(100% - 130px))`;
      };
      if (st.range.mode !== "day" && x.live) el.onclick = () => this._pwSet(st.range.mode === "year" ? makeRange("month", x.d) : makeRange("day", x.d));
    });
    svg.onmouseleave = () => { tip.hidden = true; hl.style.display = "none"; };
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

    this.shadowRoot.innerHTML = `<style>${CSS}${PW_CSS}${AP_CSS}</style><main class="pf">
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

  ${(this._pwM = this._pwModel(m), pwCard(this._pwState(), pwConfig(this._hass, this._ids), m, this._pwM, this._hass))}

  ${chartCard(ch)}

  <section class="bot">
    <div class="box hist" data-hist="cost" tabindex="0" role="button" title="Kliknij: historia">${icon("cart", "red", "ic-plain")}<div class="b-body"><div class="muted2">Koszt zakupu energii</div><div class="b-val">${zl(m.month.cost)}</div>
      <div class="b-foot"><div>${delta(m.month.cost, m.prev.cost, true)}${isNum(m.prev.cost) && m.prev.cost ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.cost, TONE.red, 90, 44)}</div></div></div>
    <div class="box hist" data-hist="sell" tabindex="0" role="button" title="Kliknij: historia">${icon("trending-up", "green", "ic-plain")}<div class="b-body"><div class="muted2">Wartość oddanej energii</div><div class="b-val">${zl(m.month.sell)}</div>
      <div class="b-foot"><div>${delta(m.month.sell, m.prev.sell, false)}${isNum(m.prev.sell) && m.prev.sell ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.sell, TONE.green, 90, 44)}</div></div></div>
    <div class="box hist" data-hist="rce" tabindex="0" role="button" title="Kliknij: historia i ceny na jutro">${icon("chart-bar", "blue", "ic-plain")}<div class="b-body"><div class="muted2">Aktualna cena RCE brutto</div><div class="b-val">${isNum(m.rce) ? NF4.format(m.rce) + " zł/kWh" : "—"}</div><div class="b-note">${esc(rceSlot)}</div>
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
    this._bindPower(m, this._pwM); this._pwEnsure();
    this.shadowRoot.querySelectorAll("[data-hist]").forEach(el => {
      const go = () => openHistory(this, el.dataset.hist, el.dataset.pi !== undefined ? periodRange(m, Number(el.dataset.pi)) : el.dataset.hist.startsWith("pw_") || el.closest(".pw") ? this._pwState().range : undefined);
      el.onclick = e => { if (e.target.closest(".info")) return; go(); };
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
    this.shadowRoot.querySelectorAll(".nav").forEach(b => b.onclick = () => { this._offset = Math.min(0, this._offset + Number(b.dataset.d)); this._range = makeRange("month", monthStart(new Date(), this._offset)); this._chartRaw = null;
      // v1.7.1: header month = whole dashboard – "Moc i bateria" jumps to the month view of that month too
      const pw = this._pwState(); pw.range = makeRange("month", monthStart(new Date(), this._offset)); pw.D = null; pw.key = "";
      this._sig = ""; this._refresh(); });
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
