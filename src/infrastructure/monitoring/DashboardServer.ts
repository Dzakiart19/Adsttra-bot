import { createServer, IncomingMessage, ServerResponse } from 'http';
import { StateService, LiveState } from './StateService';
import { logger } from '../logging/logger';

const PORT = parseInt(process.env.PORT || '3000', 10);

// ── SSE client pool ──────────────────────────────────────────────────────────
const clients = new Set<ServerResponse>();

function broadcast(state: LiveState): void {
  const payload = 'data: ' + JSON.stringify(state) + '\n\n';
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

StateService.on('update', (state: LiveState) => broadcast(state));

setInterval(() => {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch { clients.delete(res); }
  }
}, 30_000);

// ── Embedded dashboard HTML ───────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Veneno Bot — Live Monitor</title>
<style>
:root{
  --bg:#06090a;--surf:#0c1216;--surf2:#111820;
  --border:#1a2a35;--green:#00e676;--gdim:#00704a;
  --yellow:#ffd54f;--red:#ff5252;--blue:#40c4ff;
  --text:#b2d8d8;--dim:#4a6070;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;font-size:13px;min-height:100vh;-webkit-text-size-adjust:100%}

/* ── HEADER ── */
.hdr{
  background:var(--surf);border-bottom:1px solid var(--border);
  padding:10px 14px;display:flex;align-items:center;
  justify-content:space-between;position:sticky;top:0;z-index:20;gap:8px;
}
.hdr-left{display:flex;align-items:center;gap:8px;min-width:0}
.dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green);flex-shrink:0;animation:blink 1.8s infinite}
.dot.idle{background:var(--dim);box-shadow:none;animation:none}
.dot.cool{background:var(--yellow);box-shadow:0 0 7px var(--yellow)}
.dot.err{background:var(--red);box-shadow:0 0 7px var(--red)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.title{font-size:13px;font-weight:bold;color:var(--green);letter-spacing:2px;white-space:nowrap}
.uptime-txt{color:var(--dim);font-size:10px;white-space:nowrap;flex-shrink:0}

/* ── CARDS GRID ── */
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px}
.card{background:var(--surf);border:1px solid var(--border);border-radius:6px;padding:8px 10px}
.clbl{color:var(--dim);font-size:8px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:2px}
.cval{font-size:18px;font-weight:bold;color:var(--green);line-height:1.1}
.cval.warn{color:var(--yellow)}
.cval.bad{color:var(--red)}
.csub{font-size:8px;color:var(--dim);margin-top:2px;line-height:1.3}

/* ── TARGET PROGRESS BAR ── */
.target-bar{margin:0 8px 6px;background:var(--surf);border:1px solid var(--border);border-radius:6px;padding:8px 12px}
.target-bar-lbl{font-size:8px;color:var(--dim);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;display:flex;justify-content:space-between}
.prog-track{height:5px;background:var(--border);border-radius:3px;overflow:hidden}
.prog-fill{height:100%;background:var(--green);border-radius:3px;transition:width .4s ease}

/* ── ACTIVITY BOX ── */
.act{margin:0 8px 6px;background:var(--surf);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.act-hdr{
  padding:8px 12px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;gap:8px;
}
.act-hdr-title{font-size:8px;color:var(--dim);letter-spacing:1.2px;text-transform:uppercase}
.conn-dot{font-size:10px}
.act-body{padding:10px 12px;display:flex;flex-direction:column;gap:6px}

/* badges */
.badges{display:flex;flex-wrap:wrap;gap:5px}
.badge{padding:3px 7px;border-radius:4px;font-size:9px;font-weight:bold;letter-spacing:.6px;white-space:nowrap}
.b-status{background:#002a10;color:var(--green);border:1px solid var(--gdim)}
.b-status.cool{background:#2a1c00;color:var(--yellow);border:1px solid #664400}
.b-status.err{background:#2a0000;color:var(--red);border:1px solid #440000}
.b-sess{background:#001525;color:var(--blue);border:1px solid #003355}
.b-proxy{background:#1a1200;color:var(--yellow);border:1px solid #4a3000}
.b-proxy.clean{background:#001f0f;color:var(--green);border:1px solid var(--gdim)}
.b-proxy.burnt{background:#1f0000;color:var(--red);border:1px solid #440000}

/* step progress */
.step-row{display:flex;align-items:center;gap:8px}
.step-prog{flex:1;min-width:0}
.step-lbl{font-size:9px;color:var(--dim);margin-bottom:3px}
.step-track{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.step-fill{height:100%;background:var(--green);border-radius:2px;transition:width .15s linear}
.step-timer{font-size:11px;color:var(--dim);min-width:40px;text-align:right;flex-shrink:0}

/* REAL-TIME ACTION (ditonjolkan) */
.action-box{
  background:var(--surf2);border:1px solid var(--border);border-radius:6px;
  padding:10px 12px;
}
.action-label{font-size:8px;color:var(--dim);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px}
.action-txt{
  color:#e0f7fa;font-size:12px;font-weight:bold;line-height:1.5;
  word-break:break-word;min-height:20px;
}
.url-txt{color:var(--blue);font-size:9px;word-break:break-all;margin-top:3px;opacity:.8}
.ref-txt{color:var(--dim);font-size:9px;margin-top:1px}

/* ── LOG ── */
.log-wrap{margin:0 8px 14px;background:var(--surf);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.log-hdr{padding:7px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:8px;color:var(--dim);letter-spacing:1.2px;text-transform:uppercase}
.log-body{height:220px;overflow-y:auto}
.le{padding:2px 12px;font-size:10px;line-height:1.7;border-left:2px solid transparent;word-break:break-word;white-space:pre-wrap}
.le:hover{background:rgba(255,255,255,.02)}
.le.success{border-color:var(--green);color:var(--green)}
.le.warn{border-color:var(--yellow);color:var(--yellow)}
.le.error{border-color:var(--red);color:var(--red)}
.le .ts{color:var(--dim);margin-right:6px;font-size:9px}

/* ── SCROLLBAR ── */
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* ── DESKTOP OVERRIDES ── */
@media(min-width:600px){
  body{font-size:12px}
  .title{font-size:14px;letter-spacing:3px}
  .cards{grid-template-columns:repeat(auto-fit,minmax(130px,1fr));padding:10px 12px;gap:6px}
  .cval{font-size:20px}
  .clbl,.csub{font-size:9px}
  .act,.target-bar,.log-wrap{margin-left:12px;margin-right:12px}
  .cards{padding-left:12px;padding-right:12px}
  .log-body{height:320px}
  .action-txt{font-size:13px}
}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-left">
    <span class="dot" id="dot"></span>
    <span class="title">VENENO BOT v2</span>
  </div>
  <span class="uptime-txt" id="upt">uptime: 0s</span>
</div>

<!-- Stats cards row 1 -->
<div class="cards">
  <div class="card">
    <div class="clbl">Round</div>
    <div class="cval" id="cRound">—</div>
    <div class="csub">putaran aktif</div>
  </div>
  <div class="card">
    <div class="clbl">Total Sesi</div>
    <div class="cval" id="cTotal">0</div>
    <div class="csub" id="cTotalSub">—</div>
  </div>
  <div class="card">
    <div class="clbl">Success Rate</div>
    <div class="cval" id="cRate">—</div>
    <div class="csub" id="cRateSub">—</div>
  </div>
  <div class="card">
    <div class="clbl">Proxy Pool</div>
    <div class="cval" id="cPool">—</div>
    <div class="csub">proxy valid</div>
  </div>
  <div class="card">
    <div class="clbl">Retry</div>
    <div class="cval warn" id="cRetry">0</div>
    <div class="csub">proxy gagal</div>
  </div>
  <div class="card" id="cTargetCard" style="display:none">
    <div class="clbl">Target</div>
    <div class="cval" id="cTargetVal">—</div>
    <div class="csub" id="cTargetSub">impressions</div>
  </div>
  <div class="card">
    <div class="clbl">Pertama Aktif</div>
    <div class="cval" id="cFirst" style="font-size:11px;line-height:1.4">—</div>
    <div class="csub" id="cFirstSub"></div>
  </div>
  <div class="card">
    <div class="clbl">Total Online</div>
    <div class="cval" id="cTotalUp" style="font-size:14px">—</div>
    <div class="csub">sejak pertama</div>
  </div>
  <div class="card">
    <div class="clbl">Restart</div>
    <div class="cval warn" id="cRestart">0</div>
    <div class="csub">kali restart</div>
  </div>
</div>

<!-- Target progress bar -->
<div class="target-bar" id="targetBarWrap" style="display:none">
  <div class="target-bar-lbl"><span>🎯 Progress Target</span><span id="targetPct">0%</span></div>
  <div class="prog-track"><div class="prog-fill" id="targetFill" style="width:0%"></div></div>
</div>

<!-- Activity real-time -->
<div class="act">
  <div class="act-hdr">
    <span class="act-hdr-title">● Aktivitas Real-time</span>
    <span class="conn-dot" id="connTxt">⬤ connecting...</span>
  </div>
  <div class="act-body">

    <div class="badges">
      <span class="badge b-status" id="bStatus">STARTING</span>
      <span class="badge b-sess" id="bSess">—</span>
      <span class="badge b-proxy" id="bProxy">no proxy</span>
    </div>

    <div class="step-row">
      <div class="step-prog">
        <div class="step-lbl" id="stepLbl">Step — / —</div>
        <div class="step-track"><div class="step-fill" id="progFill" style="width:0%"></div></div>
      </div>
      <span class="step-timer" id="timerTxt">—</span>
    </div>

    <!-- KOTAK AKSI REAL-TIME -->
    <div class="action-box">
      <div class="action-label">⚡ Aksi Bot Sekarang</div>
      <div class="action-txt" id="actTxt">Menunggu...</div>
      <div class="url-txt" id="urlTxt"></div>
      <div class="ref-txt" id="refTxt"></div>
    </div>

  </div>
</div>

<!-- Log sukses -->
<div class="log-wrap">
  <div class="log-hdr">
    <span>✓ Sesi Sukses</span>
    <span id="logCnt">0 sesi</span>
  </div>
  <div class="log-body" id="logBody"></div>
</div>

<script>
var S = null;
var autoScroll = true;
var lb = document.getElementById('logBody');
lb.addEventListener('scroll', function(){ autoScroll = lb.scrollTop < 20; });

function fmtUptime(s){
  var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  if(h>0) return h+'j '+m+'m '+sec+'s';
  if(m>0) return m+'m '+sec+'s';
  return sec+'s';
}
function fmtTs(ts){
  var d=new Date(ts),h=d.getHours(),m=d.getMinutes(),sec=d.getSeconds();
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
}
function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var lastUptimeSnap=0, lastUptimeAt=0;

function updateUI(s){
  S=s;
  lastUptimeSnap=s.uptime; lastUptimeAt=Date.now();

  // Dot
  var dot=document.getElementById('dot');
  dot.className='dot'+(s.status==='cooldown'?' cool':s.status==='error'?' err':s.status==='starting'||s.status==='loading_proxies'?' idle':'');

  // Uptime header
  document.getElementById('upt').textContent='uptime: '+fmtUptime(s.uptime);

  // Cards
  document.getElementById('cRound').textContent=s.round>0?'#'+s.round:'—';
  document.getElementById('cTotal').textContent=s.totalSessions;
  document.getElementById('cTotalSub').textContent=s.successSessions+' sukses / '+s.failedSessions+' gagal';

  var comp=s.successSessions+s.failedSessions;
  var rate=comp>0?((s.successSessions/comp)*100).toFixed(1)+'%':'—';
  var rEl=document.getElementById('cRate');
  rEl.textContent=rate;
  rEl.className='cval'+(s.failedSessions>0&&s.failedSessions>=s.successSessions?' bad':'');
  document.getElementById('cRateSub').textContent=s.successSessions+' ✓ / '+s.failedSessions+' ✗';

  var poolEl=document.getElementById('cPool');
  poolEl.textContent=s.proxyPoolSize>0?s.proxyPoolSize:'—';
  document.getElementById('cRetry').textContent=s.proxyRetries;

  // Target card
  if(s.targetImpressions>0){
    document.getElementById('cTargetCard').style.display='';
    document.getElementById('targetBarWrap').style.display='';
    var pct=Math.min(100,Math.round((s.successSessions/s.targetImpressions)*100));
    document.getElementById('cTargetVal').textContent=s.successSessions+'/'+s.targetImpressions;
    document.getElementById('cTargetSub').textContent=pct+'% tercapai';
    document.getElementById('targetFill').style.width=pct+'%';
    document.getElementById('targetPct').textContent=pct+'%';
  }

  // Persistent uptime
  document.getElementById('cRestart').textContent=s.restartCount;
  if(s.firstStartAt>0){
    var fd=new Date(s.firstStartAt);
    var days=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    var mons=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    document.getElementById('cFirst').textContent=days[fd.getDay()]+', '+fd.getDate()+' '+mons[fd.getMonth()]+' '+fd.getFullYear();
    document.getElementById('cFirstSub').textContent=(fd.getHours()<10?'0':'')+fd.getHours()+':'+(fd.getMinutes()<10?'0':'')+fd.getMinutes();
  }

  // Status badge
  var statusMap={starting:'STARTING',loading_proxies:'LOAD PROXY',running:'RUNNING',cooldown:'COOLDOWN',done:'DONE',error:'ERROR'};
  var bSt=document.getElementById('bStatus');
  bSt.textContent=statusMap[s.status]||s.status.toUpperCase();
  bSt.className='badge b-status'+(s.status==='cooldown'?' cool':s.status==='error'?' err':'');

  // Session badge
  if(s.round>0){
    document.getElementById('bSess').textContent='R'+s.round+'·S'+(s.sessionIndex+1)+'/'+s.sessionsPerRound+'·try'+(s.attempt+1);
  }

  // Proxy badge
  var bp=document.getElementById('bProxy');
  if(s.proxy){
    bp.textContent=s.proxy+(s.proxyBurnt?' ⚠burnt':' ✓ok');
    bp.className='badge b-proxy'+(s.proxyBurnt?' burnt':' clean');
  } else {
    bp.textContent='no proxy'; bp.className='badge b-proxy';
  }

  // Step
  if(s.step>0){
    document.getElementById('stepLbl').textContent='Step '+s.step+' / '+s.totalSteps;
  } else {
    document.getElementById('stepLbl').textContent='— / —';
    document.getElementById('progFill').style.width='0%';
    document.getElementById('timerTxt').textContent='—';
  }

  // ── ACTION TEXT (real-time) ──
  document.getElementById('actTxt').textContent=s.action||'—';
  document.getElementById('urlTxt').textContent=s.targetUrl||'';
  document.getElementById('refTxt').textContent=s.referrer?'via: '+s.referrer:'';

  renderLog(s.log);
}

function renderLog(entries){
  var ok=entries.filter(function(e){ return e.level==='success'; });
  document.getElementById('logCnt').textContent=ok.length+' sesi';
  var html='';
  for(var i=0;i<ok.length;i++){
    var e=ok[i];
    html+='<div class="le success"><span class="ts">'+fmtTs(e.ts)+'</span>'+escH(e.msg)+'</div>';
  }
  lb.innerHTML=html||'<div style="padding:14px 12px;color:var(--dim);font-size:10px">Menunggu sesi sukses pertama...</div>';
  if(autoScroll) lb.scrollTop=0;
}

// Uptime counter (1s tick)
setInterval(function(){
  if(!S) return;
  if(S.firstStartAt>0){
    var totalSec=Math.floor((Date.now()-S.firstStartAt)/1000);
    document.getElementById('cTotalUp').textContent=fmtUptime(totalSec);
  }
  if(lastUptimeAt>0){
    var el=Math.floor((Date.now()-lastUptimeAt)/1000);
    document.getElementById('upt').textContent='uptime: '+fmtUptime(lastUptimeSnap+el);
  }
},1000);

// Step progress bar (100ms tick)
setInterval(function(){
  if(!S||S.step<=0||!S.stepStartAt||!S.stepDurationMs) return;
  var elapsed=Date.now()-S.stepStartAt;
  var pct=Math.min(100,(elapsed/S.stepDurationMs)*100);
  document.getElementById('progFill').style.width=pct+'%';
  var rem=Math.max(0,(S.stepDurationMs-elapsed)/1000);
  document.getElementById('timerTxt').textContent=rem.toFixed(1)+'s';
},100);

// Cooldown countdown
setInterval(function(){
  if(!S||S.status!=='cooldown'||!S.cooldownEndsAt) return;
  var rem=Math.max(0,Math.floor((S.cooldownEndsAt-Date.now())/1000));
  document.getElementById('actTxt').textContent='⏳ Cooldown — lanjut dalam '+rem+'s';
},1000);

// SSE connection
var es;
function connect(){
  es=new EventSource('/events');
  es.onopen=function(){
    var el=document.getElementById('connTxt');
    el.textContent='⬤ live'; el.style.color='#00704a';
  };
  es.onmessage=function(e){ try{ updateUI(JSON.parse(e.data)); }catch(x){} };
  es.onerror=function(){
    var el=document.getElementById('connTxt');
    el.textContent='⬤ reconnecting...'; el.style.color='#ff5252';
    es.close(); setTimeout(connect,3000);
  };
}
connect();
</script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────────────────────
export function startDashboard(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url === '/health' || url === '/health/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        sessions: StateService.getState().totalSessions,
        successRate: (() => {
          const s = StateService.getState();
          const c = s.successSessions + s.failedSessions;
          return c > 0 ? ((s.successSessions / c) * 100).toFixed(1) + '%' : 'N/A';
        })(),
      }));

    } else if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      res.write('data: ' + JSON.stringify(StateService.getState()) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));

    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
    }
  });

  server.on('error', (err: any) => {
    logger.error('DashboardServer error', { message: err.message });
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info('Dashboard live', { url: 'http://0.0.0.0:' + PORT, health: '/health', events: '/events' });
  });
}
