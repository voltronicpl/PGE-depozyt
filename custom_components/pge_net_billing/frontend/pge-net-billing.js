/* PGE Net-Billing v1.1.0 – Home Assistant panel + Lovelace cards (layout matched to reference dashboard) */
const DOMAIN = "pge_net_billing";
const VERSION = "1.1.0";
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
const fmt = (v, unit, signed = false) => !isNum(v) ? "—" : (signed && v > 0 ? "+" : "") + NF.format(v) + (unit ? " " + unit : "");
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
async function loadStats(hass, ids, start, end) {
  const list = STAT_KEYS.map(k => ids[k]).filter(Boolean);
  if (!list.length || !hass?.callWS) return null;
  const key = list.join(",") + "|" + start.toISOString() + "|" + end.toISOString();
  const hit = statCache.get(key);
  if (hit && Date.now() - hit.t < 300000) return hit.p;
  const p = hass.callWS({
    type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
    statistic_ids: list, period: "day", types: ["change", "max", "mean"],
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
  for (const k of ["import_s1", "import_s2", "export_kwh", "energy_cost", "export_value"]) pick(k, "change");
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
  const flow = series(14, r => ({ imp: imp(r), exp: r.export_kwh }));
  const s30 = f => series(30, f).map(x => x.v).filter(isNum).map(Number);

  const invoice = isNum(months[selK]?.invoice) ? months[selK].invoice : (isCurrent ? val("invoice_forecast") : null);
  const invoicePrev = months[prevK]?.invoice;
  const deposit = isNum(months[selK]?.deposit_balance) ? months[selK].deposit_balance : (isCurrent ? val("deposit_estimate") : null);

  const rce = st("rce_current");
  const rceToday = (rce?.attributes?.today || []).map(x => Number(x[1])).filter(isNum);
  const rceSlot = rce?.attributes?.slot ? new Date(rce.attributes.slot) : null;
  const updated = KEYS.map(k => st(k)?.last_updated).filter(Boolean).map(Date.parse).filter(isNum);

  return {
    sel, prevD, isCurrent, hasStats, months, tariff, vat,
    invoice, invoicePrev, deposit, month, prev, periods, flow,
    spark: {
      invoice: series(30, r => r.invoice_forecast).filter(x => x.d >= sel).map(x => x.v).filter(isNum).map(Number), deposit: s30(r => r.deposit_estimate),
      imp: s30(imp), exp: s30(r => r.export_kwh), sell: s30(r => r.export_value), cost: s30(r => r.energy_cost),
      bal: s30(r => isNum(r.export_kwh) && isNum(imp(r)) ? r.export_kwh - imp(r) : null),
    },
    rce: val("rce_current"), rceToday, rceSlot,
    updated: updated.length ? new Date(Math.max(...updated)) : null,
    found: Object.values(ids).some(Boolean),
  };
}

/* ---------- drawing primitives ---------- */
const TONE = { orange: "#ffad2e", green: "#18e08e", blue: "#3b8cff", red: "#ff4757", grey: "#8fa8ba" };
let gid = 0;
function spark(values, color, w = 120, h = 44) {
  const v = values.filter(isNum);
  if (v.length < 2) return `<div class="nohist" style="height:${h}px">brak historii</div>`;
  const lo = Math.min(...v), hi = Math.max(...v), d = hi - lo || 1;
  const pts = v.map((y, i) => [i / (v.length - 1) * w, h - 3 - (y - lo) / d * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const id = "pg" + (++gid);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
const icon = (name, tone, cls = "") => `<span class="ic ic-${tone} ${cls}"><ha-icon icon="mdi:${name}"></ha-icon></span>`;
const bar = (pct, kind = "money") => `<div class="bar bar-${kind}"><i style="left:${Math.max(2, Math.min(98, pct)).toFixed(1)}%"></i></div>`;
function depositScale(v) { return Math.max(500, Math.ceil(Math.abs(Number(v) || 0) / 500) * 500); }
function depositPct(v) { const s = depositScale(v); return 50 + (Number(v) || 0) / s * 50; }
function energyPct(imp, exp) { const t = (Number(imp) || 0) + (Number(exp) || 0); return t > 0 ? exp / t * 100 : 50; }
function delta(cur, prev, upIsBad) {
  if (!isNum(cur) || !isNum(prev) || Number(prev) === 0) return "";
  const p = (cur - prev) / Math.abs(prev) * 100, up = p >= 0;
  const bad = upIsBad ? up : !up;
  return `<span class="delta ${bad ? "t-red" : "t-green"}"><ha-icon icon="mdi:arrow-${up ? "up" : "down"}"></ha-icon>${up ? "+" : "−"}${Math.abs(p).toFixed(0)}%</span>`;
}
function logo(config, size = "lg") {
  if (config?.logo) return `<img class="logo logo-${size}" src="${esc(config.logo)}" alt="">`;
  return `<span class="logo logo-${size} logo-badge"><ha-icon icon="mdi:transmission-tower"></ha-icon></span>`;
}
function flowChart(flow) {
  const W = 680, H = 206, L = 34, R = 8, T = 24, B = 26;
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
    return `<rect x="${cx - bw / 2}" y="${y(a)}" width="${bw}" height="${Math.max(0, y(0) - y(a))}" rx="2" fill="url(#gImp)"/><rect x="${cx - bw / 2}" y="${y(0) + 1}" width="${bw}" height="${Math.max(0, y(-e) - y(0))}" rx="2" fill="url(#gExp)"/><text x="${cx}" y="${H - 6}" text-anchor="middle">${dayShort(f.d)}</text>`;
  }).join("");
  return `<svg class="flow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb52e"/><stop offset="1" stop-color="#f08a14"/></linearGradient><linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16c97f"/><stop offset="1" stop-color="#2af0a0"/></linearGradient></defs><text x="${L - 30}" y="10" class="unit">kWh</text>${g}${bars}</svg>`;
}

/* ---------- shared tiles (panel aside + Lovelace) ---------- */
const TILES = {
  compact(m, c) {
    const cell = (ic, tone, label, value, cls, extra, vals, col) => `<div class="c-cell"><div class="c-row"><span class="c-ic c-${tone}"><ha-icon icon="mdi:${ic}"></ha-icon></span><div class="c-txt"><div class="c-label">${label}</div><div class="c-val ${cls}">${value}</div>${extra ? `<div class="c-extra">${extra}</div>` : ""}</div></div><div class="c-spark">${spark(vals, col, 120, 46)}</div></div>`;
    const unit = (txt, u) => txt === "—" ? txt : txt.replace(" " + u, `<small> ${u}</small>`);
    return `<div class="tile t-compact link"><div class="c-head">${logo(c, "md")}<div><div class="c-title">Net-Billing</div><div class="c-month">${esc(monthName(m.sel))}</div></div></div>
      <div class="c-grid">
        ${cell("file-document-outline", "orange", "Rachunek", zl(m.invoice), "", delta(m.invoice, m.invoicePrev, true), m.spark.invoice, TONE.red)}
        ${cell("wallet-outline", "blue", "Saldo", zl(m.deposit, true), "t-green", "", m.spark.deposit, TONE.blue)}
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
    return `<div class="tile t-mini link">${icon("file-document-outline", "orange", "ic-lg")}<div class="t-body"><div class="v-lg t-orange">${zl(m.invoice)}</div><div class="muted">Rachunek ${monthOnly(m.sel)}</div>${delta(m.invoice, m.invoicePrev, true)}</div><div class="t-spark">${spark(m.spark.invoice, TONE.red, 90, 56)}</div></div>`;
  },
  balance(m) {
    return `<div class="tile t-mini link">${icon("leaf", "green", "ic-lg")}<div class="t-body"><div class="v-lg ${isNum(m.month.bal) && m.month.bal < 0 ? "t-red" : "t-green"}">${kwh(m.month.bal, true)}</div><div class="muted">Bilans energii</div></div><div class="t-spark">${spark(m.spark.bal.length ? m.spark.bal : m.spark.exp, TONE.green, 90, 56)}</div></div>`;
  },
  wallet(m) {
    return `<div class="tile t-mini link">${icon("wallet-outline", "blue", "ic-lg")}<div class="t-body"><div class="v-lg t-green">${zl(m.deposit, true)}</div><div class="muted">Saldo depozytu</div></div><div class="t-spark">${spark(m.spark.deposit, TONE.green, 90, 56)}</div></div>`;
  },
  summary(m, c) {
    return `<div class="tile t-summary link"><div class="t-head">${logo(c, "sm")}<span class="t-title">PGE Net-Billing</span></div>
      <div class="split"><div><div class="muted2">Pobrano</div><div class="v-md t-orange">${kwh(m.month.imp)}</div></div><div class="r"><div class="muted2">Oddano</div><div class="v-md t-green">${kwh(m.month.exp)}</div></div></div>
      ${bar(energyPct(m.month.imp, m.month.exp), "energy")}
      <div class="split"><div><div class="v-md t-green">${kwh(m.month.bal, true)}</div><div class="muted">Bilans</div></div><div class="r"><div class="v-md t-blue2">${zl(m.deposit, true)}</div><div class="muted">Saldo</div></div></div>
      <div class="t-foot">${icon("file-document-outline", "orange")}<div class="t-body"><div class="v-md">${zl(m.invoice)}</div><div class="muted">Rachunek ${monthOnly(m.sel)}</div></div><div class="t-spark">${spark(m.spark.invoice, TONE.red, 80, 40)}</div></div></div>`;
  },
};

/* ---------- styles ---------- */
const CSS = `
:host{display:block;--bg:#06111b;--card1:#0c1f2e;--card2:#081826;--line:#14293a;--txt:#eaf2f9;--mut:#9db2c3;--mut2:#c9d7e2;--o:#ffad2e;--g:#18e08e;--b:#3b8cff;--r:#ff4757;color:var(--txt);font-family:Inter,Roboto,"Segoe UI",Arial,sans-serif}
*{box-sizing:border-box}ha-icon{--mdc-icon-size:100%;display:inline-flex;width:100%;height:100%}
.t-orange{color:var(--o)}.t-green{color:var(--g)}.t-blue{color:var(--b)}.t-blue2{color:#7fb3ff}.t-red{color:var(--r)}
.muted{color:var(--mut);font-size:13px}.muted2{color:var(--mut2);font-size:13px}.r{text-align:right}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.box,.tile{background:linear-gradient(150deg,var(--card1),var(--card2));border:1px solid var(--line);border-radius:16px;min-width:0;position:relative}
.ic{flex:0 0 auto;display:grid;place-items:center;width:42px;height:42px;border-radius:12px;padding:9px}
.ic.ic-lg{width:54px;height:54px;padding:12px;border-radius:14px}
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
.t-feature .t-center{text-align:center;margin-top:4px}.v-xl{font-size:28px;font-weight:800;letter-spacing:-.4px}.v-lg{font-size:25px;font-weight:800;letter-spacing:-.3px}.v-md{font-size:18px;font-weight:800;letter-spacing:-.2px}
.split{display:flex;justify-content:space-between;gap:10px;align-items:flex-end}.split>div{min-width:0}
.t-mini{display:flex;align-items:flex-start;gap:16px;min-height:126px}.t-mini .t-body{flex:1;min-width:0;padding-top:4px;position:relative;z-index:1}.t-mini .muted{margin-top:6px;font-size:14px}.t-mini .t-spark{position:absolute;right:14px;bottom:12px;width:36%}.t-foot .t-spark{flex:0 0 36%;align-self:flex-end}.v-lg,.v-md,.v-xl{white-space:nowrap}
.t-summary .split{margin-top:12px}.t-summary .bar{margin:14px 0 6px}.t-foot{display:flex;align-items:center;gap:12px;margin-top:16px}.t-foot .t-body{flex:1;min-width:0}
/* Compact 3-column card (default Lovelace tile) */
.t-compact{padding:16px 16px 10px;border-radius:18px;background:linear-gradient(135deg,#0b1b28,#0a1621 60%,#0b1d2a)}
.c-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}.logo-md{width:48px;height:48px;padding:10px;border-radius:13px}img.logo-md{width:84px;height:46px}
.c-title{font-size:20px;font-weight:700;letter-spacing:-.2px}.c-month{color:var(--mut);font-size:14px;margin-top:2px}
.c-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.c-cell{min-width:0;padding:0 12px;border-left:1px solid #1d3344;display:flex;flex-direction:column}.c-cell:first-child{border-left:0;padding-left:0}.c-cell:last-child{padding-right:0}
.c-row{display:flex;align-items:flex-start;gap:10px}
.c-ic{flex:0 0 44px;width:44px;height:44px;border-radius:50%;padding:10px;display:grid;place-items:center;margin-top:2px}
.c-orange{color:#ffaa22;background:radial-gradient(circle at 35% 30%,#4a3613,#2a2014)}.c-blue{color:#3d8dff;background:radial-gradient(circle at 35% 30%,#123a78,#0b2246)}.c-green{color:#1fe090;background:radial-gradient(circle at 35% 30%,#0f4535,#0a2a22)}
.c-txt{min-width:0}.c-label{font-size:15px;color:#e7f0f7}.c-val{font-size:clamp(15px,2.1vw,22px);font-weight:600;letter-spacing:-.3px;white-space:nowrap;margin-top:2px}.c-val small{font-size:.72em;font-weight:500}
.c-extra .delta{font-size:14px;margin-top:2px}.c-extra .delta ha-icon{width:16px;height:16px}
.c-spark{margin:auto 0 0 54px;padding-top:6px}
@media(max-width:520px){.c-ic{flex-basis:32px;width:32px;height:32px;padding:7px}.c-spark{margin-left:0}.c-cell{padding:0 7px}.c-label{font-size:13px}.c-title{font-size:17px}}
/* Panel */
.pf{min-height:100vh;background:radial-gradient(ellipse at 40% -10%,#0b2233 0%,var(--bg) 60%);padding:20px 20px 28px}
.pf-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;max-width:1700px;margin:0 auto}
.pf-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.pf-brand{display:flex;align-items:center;gap:16px}
.pf-brand h1{font-size:27px;margin:0;font-weight:700;letter-spacing:-.4px}.pf-sub{color:var(--mut);font-size:13px;margin-top:4px}
.pf-date{background:#0c1f2e;border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:270px}
.pf-date-row{display:flex;align-items:center;gap:10px;font-size:15px}.pf-date-row .ic{width:26px;height:26px;padding:3px;border-radius:7px}.pf-date-row .lbl{flex:1}
.nav{all:unset;cursor:pointer;width:26px;height:26px;color:var(--mut2);border-radius:6px}.nav:hover{background:#163246}.nav[disabled]{opacity:.25;cursor:default;background:none}
.pf-upd{font-size:13px;color:var(--mut2);margin-top:8px;display:flex;align-items:center;gap:8px}.pf-upd i{width:9px;height:9px;border-radius:50%;background:var(--g);box-shadow:0 0 6px var(--g)}.pf-upd i.stale{background:#e2a12c;box-shadow:none}
.top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.top .box{padding:18px 18px 16px;min-height:226px;display:flex;flex-direction:column}
.k-head{display:flex;align-items:flex-start;gap:16px}.k-head .ic{width:54px;height:54px;padding:12px;border-radius:14px}.k-label{font-size:14px;color:var(--mut2);display:flex;align-items:center;gap:6px;padding-top:6px}.info{width:17px;height:17px;color:var(--mut);cursor:help}
.k-val{font-size:clamp(26px,2.5vw,38px);font-weight:800;letter-spacing:-.6px;margin-top:6px;white-space:nowrap}.k-sub{color:var(--mut2);font-size:14px;margin-top:4px}
.k-bottom{display:flex;align-items:flex-end;gap:8px;margin-top:auto}.k-bottom>div:first-child{flex:1;min-width:0}.k-bottom .spark-wrap{flex:0 0 46%}
.k-ends{display:flex;justify-content:space-between;font-size:14px;font-weight:600}.k-ends small{display:block;font-weight:400;color:var(--mut);font-size:12px}
.mid{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(230px,1fr);gap:14px;margin-top:14px}
.chart{padding:16px 16px 8px}.chart-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
h3{margin:0;font-size:16px;font-weight:700}h3 span{font-weight:400;color:var(--mut2)}.legend{font-size:13px;color:var(--mut2);display:flex;gap:16px}.legend b{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.flow{width:100%;height:auto;display:block;margin-top:8px}.flow text{fill:#c3d1dc;font-size:11px}.flow .unit{fill:#c3d1dc}.flow .grid{stroke:#173044;stroke-width:1}.flow .zero{stroke:#2b5470;stroke-width:1.2}
.stack{display:grid;gap:12px;grid-auto-rows:1fr}.stack .box{display:flex;align-items:center;gap:14px;padding:12px 14px}.stack .s-body{flex:1;min-width:0}.stack .s-val{font-size:17px;font-weight:700;margin-top:3px;white-space:nowrap}.stack .spark-wrap{flex:0 0 38%}
.bot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:14px}.bot .box{padding:16px;min-height:158px;display:flex;gap:14px}.bot .ic{width:36px;height:36px;padding:5px}.bot .b-body{flex:1;min-width:0;display:flex;flex-direction:column}
.b-val{font-size:clamp(19px,1.7vw,25px);font-weight:700;margin-top:6px;white-space:nowrap}.b-note{font-size:13px;color:var(--mut2)}.bot .delta{font-size:15px}.b-foot{display:flex;align-items:flex-end;gap:6px;margin-top:auto}.b-foot>div:first-child{flex:1}.b-foot .spark-wrap{flex:0 0 48%}
.zone{display:flex;align-items:center;gap:10px;margin-top:auto}.zone .ic{width:34px;height:34px;padding:4px}
.tables{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.tables .box{padding:16px 16px 6px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}th{font-weight:400;color:var(--mut2);text-align:right;padding:9px 6px;background:#0f2536}td{text-align:right;padding:10px 6px;border-bottom:1px solid #132b3c;white-space:nowrap}tr:last-child td{border-bottom:0}th:first-child,td:first-child{text-align:left}
.aside h2{font-size:19px;font-weight:500;margin:6px 0 16px}.aside .tile{margin-bottom:14px}
.foot{color:#6f8ca0;font-size:11px;margin-top:14px;max-width:1700px;margin-left:auto;margin-right:auto}
.warn{background:#2a1d0c;border:1px solid #5a3d12;color:#ffcf80;border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:13px}
@media(max-width:1350px){.pf-grid{grid-template-columns:1fr}.aside{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}.aside h2{grid-column:1/-1;margin:0}.aside .tile{margin:0}}
@media(max-width:1100px){.bot{grid-template-columns:repeat(2,minmax(0,1fr))}.mid{grid-template-columns:1fr}.stack{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:820px){.pf{padding:12px}.top,.tables,.stack{grid-template-columns:1fr}.pf-head{flex-wrap:wrap}.pf-date{min-width:0;width:100%}.top .box{min-height:0}}
@media(max-width:480px){.bot{grid-template-columns:1fr}.k-val{font-size:28px}.tables .box{overflow-x:auto}table{font-size:11.5px}td,th{padding:8px 3px}.flow{min-height:170px}.flow text{font-size:15px}}
`;

/* ---------- base element ---------- */
class PGEBase extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._offset = 0; this._raw = null; this._sig = ""; }
  setConfig(config) { this._config = config || {}; this._sig = ""; this._refresh(); }
  set hass(h) {
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
  window.customCards = window.customCards || [];
  if (!window.customCards.some(c => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: true });
}

/* ---------- full panel ---------- */
class PGEPanel extends PGEBase {
  set panel(p) { this._panelConfig = p?.config || {}; }
  set narrow(n) { this._narrow = n; }
  _draw() {
    const m = this._model(), c = { ...(this._panelConfig || {}), ...this._config };
    const info = t => `<ha-icon class="info" icon="mdi:information-outline" title="${esc(t)}"></ha-icon>`;
    const mAcc = MONTH_ACC[m.sel.getMonth()], prevI = MONTH_INSTR[m.prevD.getMonth()];
    const invDiff = isNum(m.invoice) && isNum(m.invoicePrev) ? m.invoice - m.invoicePrev : null;
    const sc = depositScale(m.deposit);
    const stale = m.updated && Date.now() - m.updated > 2 * 36e5;
    const tariff = m.tariff, zoneKey = tariff?.zone, zPrice = tariff?.price_gross?.[zoneKey];
    const rceSlot = m.rceSlot ? `${m.rceSlot.getDate()} ${MONTH_SHORT[m.rceSlot.getMonth()]} ${m.rceSlot.getFullYear()}, godz. ${pad(m.rceSlot.getHours())}:${pad(m.rceSlot.getMinutes())}` : "";
    const sw = (vals, col, w, h) => `<div class="spark-wrap">${spark(vals, col, w, h)}</div>`;
    const row = (label, r) => `<tr><td>${esc(label)}</td><td>${kwh(r.imp)}</td><td>${kwh(r.exp)}</td><td class="${isNum(r.bal) && r.bal < 0 ? "t-red" : "t-green"}">${kwh(r.bal, true)}</td></tr>`;
    const frow = (label, r) => `<tr><td>${esc(label)}</td><td>${zl(r.cost)}</td><td>${zl(r.sell)}</td><td class="${isNum(r.saldo) && r.saldo < 0 ? "t-red" : "t-green"}">${zl(r.saldo, true)}</td></tr>`;

    this.shadowRoot.innerHTML = `<style>${CSS}</style><main class="pf">
<div class="pf-grid"><div class="main">
  <header class="pf-head"><div class="pf-brand">${logo(c, "lg")}<div><h1>PGE Net-Billing</h1><div class="pf-sub">PGE Obrót · Dystrybucja · RCE · ${esc(tariff?.name || "G12")}</div></div></div>
    <div class="pf-date"><div class="pf-date-row">${icon("calendar-month", "blue")}<span class="lbl">${esc(monthName(m.sel))}</span><button class="nav" data-d="-1" ${this._offset <= -24 ? "disabled" : ""} aria-label="Poprzedni miesiąc"><ha-icon icon="mdi:chevron-left"></ha-icon></button><button class="nav" data-d="1" ${this._offset >= 0 ? "disabled" : ""} aria-label="Następny miesiąc"><ha-icon icon="mdi:chevron-right"></ha-icon></button></div>
    <div class="pf-upd"><i class="${stale ? "stale" : ""}"></i>Ostatnia aktualizacja: ${m.updated ? stamp(m.updated) : "—"}</div></div></header>
  ${m.found ? "" : `<div class="warn">Nie znaleziono encji integracji PGE Net-Billing. Sprawdź, czy integracja jest skonfigurowana.</div>`}
  ${m.hasStats ? "" : `<div class="warn">Brak statystyk długoterminowych z Recordera – tabele, wykresy i porównania pojawią się po pierwszych godzinach/dobach zbierania danych.</div>`}

  <section class="top">
    <div class="box"><div class="k-head">${icon("file-document-outline", "orange")}<div><div class="k-label">Szacowana kwota rachunku ${info("Prognoza lokalna (energia po depozycie + dystrybucja + opłaty stałe, brutto). To nie jest faktura PGE.")}</div>
      <div class="k-val t-orange">${zl(m.invoice)}</div><div class="k-sub">za ${mAcc} ${m.sel.getFullYear()}</div></div></div>
      <div class="k-bottom"><div>${delta(m.invoice, m.invoicePrev, true)}${invDiff !== null ? `<div class="muted">w porównaniu z ${prevI}<br>(${zl(invDiff, true)})</div>` : ""}</div>${sw(m.spark.invoice, TONE.red, 120, 60)}</div></div>

    <div class="box"><div class="k-head">${icon("wallet-outline", "blue")}<div><div class="k-label">Saldo depozytu prosumenckiego ${info("Prognoza FIFO: wartość eksportu wg RCE × współczynnik, ważna 12 mies. To nie jest saldo bankowe.")}</div>
      <div class="k-val t-green">${zl(m.deposit, true)}</div><div class="k-sub">Dostępne środki do rozliczenia</div></div></div>
      <div style="margin-top:auto">${bar(depositPct(m.deposit))}<div class="k-ends"><span>−${sc} zł<small>(do dopłaty)</small></span><span class="r">+${sc} zł<small>(nadwyżka)</small></span></div></div></div>

    <div class="box"><div class="k-head">${icon("leaf", "green")}<div><div class="k-label">Bilans energii ${info("Oddano minus pobrano w wybranym miesiącu (statystyki Recordera).")}</div>
      <div class="k-val ${isNum(m.month.bal) && m.month.bal < 0 ? "t-red" : "t-green"}">${kwh(m.month.bal, true)}</div><div class="k-sub">${!isNum(m.month.bal) ? "Brak danych" : m.month.bal >= 0 ? "Więcej oddano niż pobrano" : "Więcej pobrano niż oddano"}</div></div></div>
      <div style="margin-top:auto">${bar(energyPct(m.month.imp, m.month.exp), "energy")}<div class="k-ends"><span>Pobrano<small class="t-orange" style="font-size:15px;font-weight:700;color:var(--o)">${kwh(m.month.imp)}</small></span><span class="r">Oddano<small style="font-size:15px;font-weight:700;color:var(--g)">${kwh(m.month.exp)}</small></span></div></div></div>
  </section>

  <section class="mid">
    <div class="box chart"><div class="chart-head"><h3>Przepływ energii <span>(ostatnie 14 dni)</span></h3><div class="legend"><span><b style="background:var(--o)"></b>Pobór z sieci</span><span><b style="background:var(--g)"></b>Oddanie do sieci</span></div></div>${flowChart(m.flow)}</div>
    <div class="stack">
      <div class="box">${icon("lightning-bolt", "orange", "ic-plain")}<div class="s-body"><div class="muted2">Pobór z sieci</div><div class="s-val">${kwh(m.month.imp)}</div></div>${sw(m.spark.imp, TONE.orange, 100, 34)}</div>
      <div class="box">${icon("arrow-up", "green", "ic-plain")}<div class="s-body"><div class="muted2">Oddanie do sieci</div><div class="s-val">${kwh(m.month.exp)}</div></div>${sw(m.spark.exp, TONE.green, 100, 34)}</div>
      <div class="box">${icon("database-outline", "blue", "ic-plain")}<div class="s-body"><div class="muted2">Wartość sprzedaży (RCE)</div><div class="s-val">${zl(m.month.sell)}</div></div>${sw(m.spark.sell, TONE.blue, 100, 34)}</div>
    </div>
  </section>

  <section class="bot">
    <div class="box">${icon("cart", "red", "ic-plain")}<div class="b-body"><div class="muted2">Koszt zakupu energii</div><div class="b-val">${zl(m.month.cost)}</div>
      <div class="b-foot"><div>${delta(m.month.cost, m.prev.cost, true)}${isNum(m.prev.cost) && m.prev.cost ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.cost, TONE.red, 90, 44)}</div></div></div>
    <div class="box">${icon("trending-up", "green", "ic-plain")}<div class="b-body"><div class="muted2">Wartość oddanej energii</div><div class="b-val">${zl(m.month.sell)}</div>
      <div class="b-foot"><div>${delta(m.month.sell, m.prev.sell, false)}${isNum(m.prev.sell) && m.prev.sell ? `<div class="b-note">w porównaniu z ${prevI}</div>` : ""}</div>${sw(m.spark.sell, TONE.green, 90, 44)}</div></div></div>
    <div class="box">${icon("chart-bar", "blue", "ic-plain")}<div class="b-body"><div class="muted2">Aktualna cena RCE</div><div class="b-val">${isNum(m.rce) ? NF4.format(m.rce) + " zł/kWh" : "—"}</div><div class="b-note">${esc(rceSlot)}</div>
      <div class="b-foot" style="margin-top:auto">${spark(m.rceToday, TONE.blue, 200, 40)}</div></div></div>
    <div class="box">${icon("clock-outline", "blue", "ic-plain")}<div class="b-body"><div class="muted2">Taryfa dystrybucji</div><div class="b-val">${esc(tariff?.name || "G12")}</div>
      <div class="b-note">Obecnie: ${zoneKey === "s1" ? "strefa dzienna" : zoneKey === "s2" ? "strefa nocna" : "—"}</div>
      <div class="zone">${icon(zoneKey === "s2" ? "weather-night" : "white-balance-sunny", zoneKey === "s2" ? "blue" : "orange", "ic-plain")}<div><div class="b-val" style="margin:0;font-size:20px">${isNum(zPrice) ? NF4.format(zPrice) + " zł/kWh" : "—"}</div><div class="b-note" style="font-size:11px">energia + dystrybucja zmienna, brutto</div></div></div></div></div>
  </section>

  <section class="tables">
    <div class="box"><h3>Bilans energii</h3><table><thead><tr><th>Okres</th><th>Pobrano</th><th>Oddano</th><th>Bilans</th></tr></thead><tbody>${m.periods.map(([l, r]) => row(l, r)).join("")}</tbody></table></div>
    <div class="box"><h3>Rozliczenia finansowe</h3><table><thead><tr><th>Okres</th><th>Zakup energii</th><th>Sprzedaż (RCE)</th><th>Saldo</th></tr></thead><tbody>${m.periods.map(([l, r]) => frow(l, r)).join("")}</tbody></table></div>
  </section>
</div>
<aside class="aside"><h2>Mały kafelek do Twoich kart</h2>${TILES.deposit(m, c)}${TILES.invoice(m, c)}${TILES.balance(m, c)}${TILES.wallet(m, c)}${TILES.summary(m, c)}</aside>
</div>
<div class="foot">Kwoty są prognozą lokalną integracji (stawki z konfiguracji, RCE z PSE), nie fakturą PGE. Zakup energii w tabeli i kafelku – brutto (bez dystrybucji). v${VERSION}</div>
</main>`;
    this.shadowRoot.querySelectorAll(".nav").forEach(b => b.onclick = () => { this._offset = Math.min(0, this._offset + Number(b.dataset.d)); this._sig = ""; this._refresh(); });
    // aside tiles are previews only – no navigation inside the panel
    this.shadowRoot.querySelectorAll(".aside .link").forEach(el => el.classList.remove("link"));
  }
}
if (!customElements.get("pge-net-billing-panel")) customElements.define("pge-net-billing-panel", PGEPanel);
console.info(`%c PGE-NET-BILLING %c v${VERSION} `, "background:#ff3045;color:#fff;font-weight:700", "background:#0c1f2e;color:#fff");