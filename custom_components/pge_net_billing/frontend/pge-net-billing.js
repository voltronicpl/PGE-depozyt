/* PGE Net-Billing v1.0.0 – Home Assistant custom panel and Lovelace card */
const DOMAIN="pge_net_billing";
const LABELS={invoice_forecast:"Rachunek",deposit_estimate:"Saldo depozytu",export_kwh:"Oddano",import_s1:"Pobrano S1",import_s2:"Pobrano S2",rce_current:"RCE",export_value:"Wartość eksportu",energy_cost:"Koszt zakupu",distribution_cost:"Dystrybucja",pending_export_kwh:"Oczekuje na RCE"};
const css=`
:host{display:block;min-height:100%;color:#ecf6ff;font-family:Inter,Roboto,Arial,sans-serif;--pge-bg:#061723;--pge-card:#0b2232;--pge-line:#183447;--pge-green:#2ee39b;--pge-orange:#ffb238;--pge-blue:#419dff}
*{box-sizing:border-box}.panel{min-height:100vh;background:radial-gradient(ellipse at 20% 0%,#0b293b 0%,#061723 55%);padding:22px 26px 38px;max-width:none;margin:0}.wrap{background:linear-gradient(145deg,#102b3c,#071a27);border:1px solid #1b4053;border-radius:17px;padding:17px;box-shadow:0 10px 24px #0003}
.heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.brand{font-size:25px;font-weight:800;letter-spacing:-.6px;color:#f4faff}.sub{font-size:12px;color:#93b7ce;margin-top:5px}.pill{font-size:12px;color:#95b9d0}.logo{display:inline-flex;align-items:center;gap:13px}.logo-mark{display:grid;place-items:center;width:60px;height:54px;font-size:22px;font-style:italic;font-weight:900;color:#fff;position:relative}.logo-mark:before{content:"";position:absolute;top:2px;left:0;right:0;height:15px;border-top:5px solid #fa3d4d;border-radius:100% 100% 0 0;transform:rotate(-14deg)}.logo-mark b{position:relative}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric,.section,.detail,.sidecard{background:linear-gradient(145deg,#10293a,#081c2a);border:1px solid #17394c;border-radius:16px;min-width:0}.metric{padding:20px;min-height:195px;position:relative;overflow:hidden}.kicker{font-size:13px;color:#c4d7e5}.num{font-size:clamp(21px,2.3vw,34px);font-weight:800;margin-top:12px;overflow-wrap:anywhere;letter-spacing:-.6px}.orange{color:var(--pge-orange)}.green{color:var(--pge-green)}.blue{color:var(--pge-blue)}.red{color:#ff5e66}.mini{height:40px;margin-top:12px;width:100%}.balance{margin-top:17px;height:10px;border-radius:20px;background:linear-gradient(90deg,#f03f53,#e6ae46 48%,#20d78c);position:relative}.balance i{position:absolute;left:var(--pct);height:19px;width:4px;background:#f5fbff;border-radius:4px;top:-5px;transform:translateX(-50%);box-shadow:0 0 6px #fff7}
.between{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#9cb8cb;margin-top:13px}.between strong{color:#e8f3ff}
.panel .metrics{margin-bottom:13px}.section{padding:19px;margin-bottom:13px}.section h3{margin:0 0 15px;font-size:16px}.details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.detail{padding:16px;min-height:104px}.detail .num{font-size:23px}.chart{height:200px;width:100%}.note{font-size:11px;color:#8eacbf;line-height:1.6}.link{cursor:pointer}.link:hover{border-color:#3b9ae9}
.dashboard{display:grid;grid-template-columns:minmax(0,2.1fr) minmax(260px,.85fr);gap:13px}.dashboard-left,.dashboard-right{min-width:0}.dashboard-right{display:grid;grid-template-rows:repeat(3,1fr);gap:12px;margin-bottom:13px}.sidecard{padding:19px;display:flex;flex-direction:column;justify-content:center}.sidecard .num{font-size:26px}.sidecard .mini{margin-top:5px}.top-metrics .metric{min-height:207px}.top-metrics .kicker{display:flex;gap:9px;align-items:center}.glyph{font-size:21px;display:inline-flex;width:42px;height:42px;border-radius:12px;align-items:center;justify-content:center;background:#173d50}.legend{display:flex;gap:14px;justify-content:flex-end;color:#9bbbd0;font-size:12px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:var(--pge-orange)}.dot.green-dot{background:var(--pge-green)}.bottom-tables{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table-head,.table-line{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:8px;padding:9px 0;border-bottom:1px solid #193649;font-size:12px}.table-head{color:#8fb0c5}.table-line strong{text-align:right}.table-line span:not(:first-child){text-align:right}.compact-title{font-size:16px;font-weight:750;margin:0 0 13px}
.pge-card .metric{min-height:105px;padding:13px}.pge-card .num{font-size:clamp(17px,2vw,25px)}.pge-card .mini{height:23px;margin-top:4px}.pge-card .heading{margin-bottom:10px}.pge-card .brand{font-size:16px}.pge-card .metrics{gap:8px}
@media(max-width:1100px){.dashboard{grid-template-columns:1fr}.dashboard-right{grid-template-columns:repeat(3,1fr);grid-template-rows:auto}.details{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.panel{padding:12px}.metrics{grid-template-columns:1fr}.dashboard-right{grid-template-columns:1fr}.bottom-tables{grid-template-columns:1fr}.metric{min-height:135px}.details{grid-template-columns:1fr 1fr}.pge-card .metrics{grid-template-columns:1fr}.heading{align-items:flex-start}.pill{display:none}}
/* Compact Lovelace card: one row of three metrics at any dashboard width */
.pge-card{padding:15px 16px;background:linear-gradient(135deg,#0a1b2a,#0c2637);border-radius:17px;width:100%;overflow:hidden;box-shadow:none}
.pge-card .heading{margin-bottom:13px;align-items:center}
.pge-card .brand{font-size:16px;letter-spacing:0}
.pge-card .sub{font-size:11px;margin-top:3px}
.pge-card .metrics{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important}
.pge-card .metric{background:transparent;border:0;border-right:1px solid #244255;border-radius:0;min-height:94px;padding:7px 12px 4px;overflow:hidden}
.pge-card .metric:first-child{padding-left:2px}.pge-card .metric:last-child{border-right:0;padding-right:2px}
.pge-card .kicker{font-size:clamp(9px,1.4vw,11px);line-height:1.3;min-height:29px;color:#b2c9d8;white-space:normal}
.pge-card .num{font-size:clamp(13px,2.5vw,24px);letter-spacing:-.4px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:clip}
.pge-card .mini{height:24px;margin-top:7px;display:block}
.pge-card .pill{display:inline;color:#93b4c8;white-space:nowrap;font-size:10px}
@media(max-width:700px){.pge-card .metrics{grid-template-columns:repeat(3,minmax(0,1fr))!important}.pge-card .metric{min-height:85px;padding:5px 8px}.pge-card .num{font-size:clamp(12px,3.2vw,18px)}.pge-card .kicker{font-size:10px}.pge-card .pill{display:none}}

/* Approved variant 9: compact 3-column card, matched to supplied reference */
:host{min-height:0}
.pge-v9{width:100%;height:auto;min-height:160px;padding:12px 14px 10px;border:1px solid #19394b;border-radius:14px;background:linear-gradient(120deg,#071622 0%,#0a2130 65%,#071926 100%);color:#f4f8fb;box-shadow:none;overflow:hidden}
.pge-v9 .v9-head{display:flex;align-items:center;gap:12px;height:48px;margin-bottom:6px}
.pge-v9 .v9-logo{flex:0 0 56px;width:56px;height:40px}
.pge-v9 .v9-title{font-size:15px;font-weight:750;line-height:1.2;letter-spacing:-.25px}
.pge-v9 .v9-month{font-size:11px;color:#9bbbd0;margin-top:3px}
.pge-v9 .v9-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;min-height:77px}
.pge-v9 .v9-cell{min-width:0;padding:4px 8px 0;border-right:1px solid #1b3545}
.pge-v9 .v9-cell:first-child{padding-left:0}.pge-v9 .v9-cell:last-child{padding-right:0;border-right:0}
.pge-v9 .v9-row{display:flex;align-items:flex-start;gap:7px;min-width:0}
.pge-v9 .v9-icon{flex:0 0 33px;width:33px;height:33px;border-radius:50%;display:grid;place-items:center;background:#192a31}
.pge-v9 .v9-icon svg{width:22px;height:22px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round}
.pge-v9 .v9-icon.bill{color:#ffaf18;background:#2a281d}.pge-v9 .v9-icon.wallet{color:#168eff;background:#09283e}.pge-v9 .v9-icon.leaf{color:#0be08c;background:#0a342b}
.pge-v9 .v9-content{min-width:0;flex:1}
.pge-v9 .v9-label{font-size:11px;line-height:1.1;color:#f0f5fa;margin-top:2px}
.pge-v9 .v9-value{font-size:clamp(12px,1.7vw,17px);line-height:1.2;font-weight:800;letter-spacing:-.55px;white-space:nowrap;margin-top:5px;color:#f4f8fb}
.pge-v9 .v9-value.positive{color:#0ce88f}.pge-v9 .v9-value.negative{color:#ff6069}
.pge-v9 .v9-trend{height:16px;margin-top:4px;font-size:12px;font-weight:700;color:#ff454d}
.pge-v9 .v9-chart{display:block;width:100%;height:28px;margin-top:2px}
.pge-v9 .v9-chart svg{display:block;width:100%;height:100%}
.pge-v9 .v9-empty{font-size:9px;color:#668499;margin-top:12px}
@media(max-width:460px){.pge-v9{padding:11px 10px}.pge-v9 .v9-cell{padding-left:5px;padding-right:5px}.pge-v9 .v9-row{gap:4px}.pge-v9 .v9-icon{width:25px;height:25px;flex-basis:25px}.pge-v9 .v9-icon svg{width:17px;height:17px}.pge-v9 .v9-value{font-size:clamp(10px,3vw,15px)}.pge-v9 .v9-label{font-size:10px}}
`;
function esc(v){return String(v??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(v,unit){const n=Number(v);return v!==null&&v!==undefined&&v!==""&&Number.isFinite(n)?new Intl.NumberFormat("pl-PL",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+" "+unit:"—";}
function color(v){return Number(v)>=0?"green":"red";}
function spark(values,stroke){const nums=values.filter(x=>Number.isFinite(x));if(nums.length<2)return '<text x="5" y="23" fill="#7898ab" font-size="10">Brak historii</text>';const lo=Math.min(...nums),hi=Math.max(...nums),d=hi-lo||1;const points=nums.map((v,i)=>`${(i/(nums.length-1)*220).toFixed(1)},${(28-(v-lo)/d*24).toFixed(1)}`).join(" ");return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;}
class PGEBase extends HTMLElement{
 constructor(){super();this.attachShadow({mode:"open"});this._history={};this._lastFetch=0;this._config={};}
 setConfig(config){this._config=config||{};this.draw();}
 set hass(h){this._hass=h;this.draw();if(Date.now()-this._lastFetch>300000){this._lastFetch=Date.now();this.loadHistory();}}
 get hass(){return this._hass;}
 entities(){const states=Object.values(this._hass?.states||{}).filter(s=>s.entity_id.startsWith("sensor.")&&s.attributes?.friendly_name);const result={};for(const [key,label] of Object.entries({...LABELS,import_s1:"Pobór S1",import_s2:"Pobór S2",export_kwh:"Eksport",invoice_forecast:"Prognoza rachunku za bieżący miesiąc",deposit_estimate:"Saldo depozytu (prognoza)",rce_current:"Aktualna RCE",export_value:"Wartość eksportu (szacunek)",energy_cost:"Koszt energii netto",distribution_cost:"Koszt dystrybucji zmiennej netto",pending_export_kwh:"Eksport oczekujący na RCE"})){const explicit=this._config.entities?.[key];result[key]=explicit||states.find(s=>s.attributes.friendly_name?.endsWith(label))?.entity_id;}return result;}
 val(k){const id=this.entities()[k];const n=Number(this._hass?.states?.[id]?.state);return id&&Number.isFinite(n)&&!["unknown","unavailable"].includes(this._hass?.states?.[id]?.state)?n:null;}
 import(){const a=this.val("import_s1"),b=this.val("import_s2");return a===null&&b===null?null:(a||0)+(b||0);}
 balance(){const a=this.val("export_kwh"),b=this.import();return a===null||b===null?null:a-b;}
 pct(v){return Math.max(2,Math.min(98,50+(Number(v)||0)/Math.max(500,Math.abs(Number(v)||0))*45));}
 gauge(v){return `<div class="balance" style="--pct:${this.pct(v)}%"><i></i></div>`;}
 trend(k,stroke){return `<svg class="mini" viewBox="0 0 220 32" preserveAspectRatio="none">${spark(this._history[k]||[],stroke)}</svg>`;}
 metric(label,value,cls,trend){return `<div class="metric"><div class="kicker">${esc(label)}</div><div class="num ${cls}">${esc(value)}</div>${trend||""}</div>`;}
 summary(){const invoice=this.val("invoice_forecast"),dep=this.val("deposit_estimate"),bal=this.balance();return `<div class="metrics">${this.metric("▤ Rachunek (prognoza)",fmt(invoice,"zł"),"orange",this.trend("invoice_forecast","#ffad37"))}${this.metric("▣ Saldo depozytu",fmt(dep,"zł"),color(dep),this.trend("deposit_estimate","#429aff"))}${this.metric("♻ Bilans energii",fmt(bal,"kWh"),color(bal),this.trend("export_kwh","#42d887"))}</div>`;}
 async loadHistory(){if(!this._hass?.callApi)return;const ids=this.entities();const keys=["invoice_forecast","deposit_estimate","export_kwh","import_s1","import_s2"];const start=new Date(Date.now()-14*86400000).toISOString();try{const requested=keys.filter(k=>ids[k]);if(!requested.length)return;const raw=await this._hass.callApi("GET",`history/period/${start}?filter_entity_id=${requested.map(k=>encodeURIComponent(ids[k])).join(",")}&minimal_response&no_attributes`);for(const k of requested){const row=raw.find(r=>r?.[0]?.entity_id===ids[k]);this._history[k]=(row||[]).map(p=>Number(p.state)).filter(Number.isFinite);}this.draw();}catch(e){console.warn("PGE history unavailable",e);}}
 draw(){}
}
class PGECompactCard extends PGEBase{
 static getStubConfig(){return {type:"custom:pge-net-billing-card"};}
 getCardSize(){return 2;}
 draw(){
  if(!this.shadowRoot)return;
  const invoice=this.val("invoice_forecast"),deposit=this.val("deposit_estimate"),balance=this.balance();
  const month=new Intl.DateTimeFormat("pl-PL",{month:"long",year:"numeric"}).format(new Date());
  const logo=`<svg class="v9-logo" viewBox="0 0 75 51" aria-label="PGE" role="img"><path d="M4 25 C19 8 38 3 57 8" fill="none" stroke="#fa253b" stroke-width="5" stroke-linecap="round"/><path d="M57 8 C64 10 68 13 71 17" fill="none" stroke="#ff8b20" stroke-width="5" stroke-linecap="round"/><text x="15" y="44" fill="#fff" font-family="Arial,sans-serif" font-size="27" font-style="italic" font-weight="900" letter-spacing="-3">PGE</text></svg>`;
  const icons={
   bill:`<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="13" height="18" rx="2"/><path d="M8 7h6M8 11h6M8 15h3"/><circle cx="18" cy="18" r="4"/><path d="m16.5 18 1 1 2-2"/></svg>`,
   wallet:`<svg viewBox="0 0 24 24"><path d="M4 7V5a2 2 0 0 1 2-2h12M4 7h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V9a2 2 0 0 1 2-2z"/><path d="M21 12h-7a2 2 0 0 0 0 4h7"/></svg>`,
   leaf:`<svg viewBox="0 0 24 24"><path d="M20 3C9 3 4 7 4 15a6 6 0 0 0 6 6c8 0 12-8 10-18z"/><path d="M4 21c4-7 8-10 13-13"/></svg>`
  };
  const chart=(key,stroke)=>{
   const values=(this._history[key]||[]).filter(Number.isFinite);
   if(values.length<2)return `<div class="v9-empty">Brak historii</div>`;
   const recent=values.slice(-40),lo=Math.min(...recent),hi=Math.max(...recent),range=hi-lo||1;
   const coords=recent.map((v,i)=>[i*100/(recent.length-1),25-22*(v-lo)/range]);
   const path=coords.map(([x,y],i)=>`${i?"L":"M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
   const area=`${path} L100 28 L0 28 Z`;
   const id="v9-"+key;
   return `<div class="v9-chart"><svg viewBox="0 0 100 28" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${stroke}" stop-opacity=".25"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${path}" stroke="${stroke}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  };
  const cell=(kind,label,value,cls,history,stroke,extra="")=>`<div class="v9-cell"><div class="v9-row"><span class="v9-icon ${kind}">${icons[kind]}</span><div class="v9-content"><div class="v9-label">${label}</div><div class="v9-value ${cls}">${esc(value)}</div>${extra?'<div class="v9-trend">'+extra+'</div>':""}${chart(history,stroke)}</div></div></div>`;
  this.shadowRoot.innerHTML=`<style>${css}</style><div class="pge-v9 link" role="link" tabindex="0" aria-label="Otwórz panel PGE Net-Billing"><div class="v9-head">${logo}<div><div class="v9-title">Net-Billing</div><div class="v9-month">${esc(month)}</div></div></div><div class="v9-grid">${cell("bill","Rachunek",fmt(invoice,"zł"),"","invoice_forecast","#ff404c")}${cell("wallet","Saldo",fmt(deposit,"zł"),"positive","deposit_estimate","#168eff")}${cell("leaf","Bilans",fmt(balance,"kWh"),balance!==null&&balance<0?"negative":"positive","export_kwh","#0ce88f")}</div></div>`;
  const el=this.shadowRoot.querySelector(".link");
  const go=()=>{window.location.pathname="/pge-net-billing";};
  el.addEventListener("click",go);
  el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}});
 }
}
class PGEPanel extends PGEBase{
 draw(){
  if(!this.shadowRoot)return;
  const imp=this.import(),exp=this.val("export_kwh"),dep=this.val("deposit_estimate"),bal=this.balance(),invoice=this.val("invoice_forecast");
  const tile=(label,value,cls,icon,trend)=>`<div class="metric"><div class="kicker"><span class="glyph">${icon}</span>${esc(label)}</div><div class="num ${cls}">${esc(value)}</div>${trend||""}</div>`;
  const detail=(name,v,cls)=>`<div class="detail"><div class="kicker">${esc(name)}</div><div class="num ${cls}">${esc(v)}</div></div>`;
  const side=(icon,name,val,cls,trend)=>`<div class="sidecard"><div class="kicker"><span class="glyph">${icon}</span> ${esc(name)}</div><div class="num ${cls}">${esc(val)}</div>${this.trend(trend,cls==="green"?"#2ee39b":"#ffb238")}</div>`;
  const row=(a,b,c)=>`<div class="table-line"><span>${esc(a)}</span><span>${esc(b)}</span><strong>${esc(c)}</strong></div>`;
  this.shadowRoot.innerHTML=`<style>${css}</style><main class="panel">
   <div class="heading"><div class="logo"><div class="logo-mark"><b>PGE</b></div><div><div class="brand">PGE Net-Billing</div><div class="sub">PGE Obrót · Dystrybucja · RCE · G12</div></div></div><span class="pill">Prognoza lokalna · nie faktura PGE</span></div>
   <div class="metrics top-metrics">
    ${tile("Szacowana kwota rachunku",fmt(invoice,"zł"),"orange","▤",this.trend("invoice_forecast","#ff5966"))}
    ${tile("Saldo depozytu prosumenckiego",fmt(dep,"zł"),"green","▣",this.gauge(dep)+`<div class="between"><span>Do rozliczenia</span><span>Saldo prognozowane</span></div>`)}
    ${tile("Bilans energii",fmt(bal,"kWh"),color(bal),"♻",this.gauge(bal)+`<div class="between"><span>Pobrano: <strong>${esc(fmt(imp,"kWh"))}</strong></span><span>Oddano: <strong>${esc(fmt(exp,"kWh"))}</strong></span></div>`)}
   </div>
   <div class="dashboard"><div class="dashboard-left">
    <div class="section"><div class="heading"><h3>Przepływy energii · ostatnie 14 dni</h3><div class="legend"><span><i class="dot"></i>Pobór</span><span><i class="dot green-dot"></i>Oddanie</span></div></div>
      <svg class="chart" viewBox="0 0 700 200" preserveAspectRatio="none"><line x1="0" y1="100" x2="700" y2="100" stroke="#315268" stroke-width="1"/><g transform="translate(10,10) scale(3,2.5)">${spark(this._history.import_s1||[],"#ffad36")}</g><g transform="translate(10,110) scale(3,2.5)">${spark(this._history.export_kwh||[],"#28db91")}</g></svg>
      <div class="note">Historia stanów liczników z Home Assistant. Dane i wykresy pojawią się po zgromadzeniu historii.</div>
    </div>
   </div><div class="dashboard-right">
     ${side("⚡","Pobór z sieci",fmt(imp,"kWh"),"orange","import_s1")}
     ${side("↗","Oddanie do sieci",fmt(exp,"kWh"),"green","export_kwh")}
     ${side("▤","Wartość sprzedaży RCE",fmt(this.val("export_value"),"zł"),"blue","deposit_estimate")}
   </div></div>
   <div class="details">
    ${detail("Koszt zakupu energii",fmt(this.val("energy_cost"),"zł"),"orange")}
    ${detail("Wartość oddanej energii",fmt(this.val("export_value"),"zł"),"green")}
    ${detail("Aktualna cena RCE",fmt(this.val("rce_current"),"zł/kWh"),"blue")}
    ${detail("Taryfa dystrybucji","G12","blue")}
   </div>
   <div class="bottom-tables" style="margin-top:13px">
    <div class="section"><h3>Bilans energii</h3><div class="table-head"><span>Okres</span><span>Pobrano</span><span>Oddano</span></div>${row("Od uruchomienia",fmt(imp,"kWh"),fmt(exp,"kWh"))}${row("Bilans", "Eksport − import",fmt(bal,"kWh"))}</div>
    <div class="section"><h3>Rozliczenia finansowe</h3><div class="table-head"><span>Pozycja</span><span>Rodzaj</span><span>Wartość</span></div>${row("Zakup energii","Netto",fmt(this.val("energy_cost"),"zł"))}${row("Sprzedaż RCE","Szacunek",fmt(this.val("export_value"),"zł"))}${row("Depozyt","Prognoza",fmt(dep,"zł"))}${row("Rachunek","Prognoza",fmt(invoice,"zł"))}</div>
   </div><p class="note">Wartości są szacunkowe; bilans kWh nie jest depozytem w zł. Brak historii nie oznacza braku bieżących odczytów.</p>
  </main>`;
 }
}
if(!customElements.get("pge-net-billing-card"))customElements.define("pge-net-billing-card",PGECompactCard);
if(!customElements.get("pge-net-billing-panel"))customElements.define("pge-net-billing-panel",PGEPanel);
window.customCards=window.customCards||[];if(!window.customCards.some(c=>c.type==="pge-net-billing-card"))window.customCards.push({type:"pge-net-billing-card",name:"PGE Net-Billing – kafelek",description:"Rachunek, depozyt i bilans energii"});
