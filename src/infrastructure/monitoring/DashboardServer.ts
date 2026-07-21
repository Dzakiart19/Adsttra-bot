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

// ── Embedded dashboard HTML ───────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veneno Bot — Live Monitor</title>
<style>
:root{--bg:#06090a;--surf:#0c1216;--surf2:#111820;--border:#1a2a35;--green:#00e676;--gdim:#00704a;--yellow:#ffd54f;--red:#ff5252;--blue:#40c4ff;--text:#b2d8d8;--dim:#4a6070}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;font-size:12px;min-height:100vh}
/* header */
.hdr{background:var(--surf);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:20}
.dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green);display:inline-block;margin-right:8px;animation:blink 1.8s infinite}
.dot.idle{background:var(--dim);box-shadow:none;animation:none}
.dot.cool{background:var(--yellow);box-shadow:0 0 7px var(--yellow)}
.dot.err{background:var(--red);box-shadow:0 0 7px var(--red)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.title{font-size:14px;font-weight:bold;color:var(--green);letter-spacing:3px}
.uptime-txt{color:var(--dim);font-size:11px}
/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;padding:10px 12px}
.card{background:var(--surf);border:1px solid var(--border);border-radius:3px;padding:9px 12px}
.clbl{color:var(--dim);font-size:9px;letter-spacing:1.5px;text-transform:uppercase}
.cval{font-size:20px;font-weight:bold;color:var(--green);margin-top:3px;line-height:1}
.cval.warn{color:var(--yellow)}
.cval.bad{color:var(--red)}
.csub{font-size:9px;color:var(--dim);margin-top:3px}
/* activity */
.act{margin:0 12px 10px;background:var(--surf);border:1px solid var(--border);border-radius:3px;padding:12px 14px}
.sec-title{font-size:9px;color:var(--dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.row{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap}
.badge{padding:2px 7px;border-radius:2px;font-size:10px;font-weight:bold;letter-spacing:.8px}
.b-status{background:#002a10;color:var(--green);border:1px solid var(--gdim)}
.b-status.cool{background:#2a1c00;color:var(--yellow);border:1px solid #664400}
.b-status.err{background:#2a0000;color:var(--red);border:1px solid #440000}
.b-sess{background:#001525;color:var(--blue);border:1px solid #003355}
.b-proxy{background:#1a1200;color:var(--yellow);border:1px solid #4a3000}
.b-proxy.clean{background:#001f0f;color:var(--green);border:1px solid var(--gdim)}
.b-proxy.burnt{background:#1f0000;color:var(--red);border:1px solid #440000}
/* progress */
.prog-wrap{flex:1;min-width:100px}
.prog-lbl{font-size:9px;color:var(--dim);margin-bottom:3px}
.prog-bar{height:5px;background:var(--border);border-radius:3px;overflow:hidden}
.prog-fill{height:100%;background:var(--green);border-radius:3px;transition:width .15s linear}
.timer-txt{font-size:11px;color:var(--dim);min-width:55px;text-align:right}
.action-txt{color:var(--text);font-size:11px;margin-top:4px}
.url-txt{color:var(--blue);font-size:10px;word-break:break-all;margin-top:3px;opacity:.8}
.ref-txt{color:var(--dim);font-size:9px;margin-top:2px}
/* log */
.log-wrap{margin:0 12px 14px;background:var(--surf);border:1px solid var(--border);border-radius:3px;overflow:hidden}
.log-hdr{padding:7px 12px;border-bottom:1px solid var(--border);font-size:9px;color:var(--dim);letter-spacing:1.5px;text-transform:uppercase;display:flex;justify-content:space-between}
.log-body{height:380px;overflow-y:auto}
.le{padding:1px 12px;font-size:10px;line-height:1.7;border-left:2px solid transparent;white-space:pre-wrap;word-break:break-word}
.le:hover{background:rgba(255,255,255,.02)}
.le.success{border-color:var(--green);color:var(--green)}
.le.warn{border-color:var(--yellow);color:var(--yellow)}
.le.error{border-color:var(--red);color:var(--red)}
.le .ts{color:var(--dim);margin-right:7px;font-size:9px}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
</style>
</head>
<body>

<div class="hdr">
  <div style="display:flex;align-items:center">
    <span class="dot" id="dot"></span>
    <span class="title">VENENO TRAFFIC BOT v2</span>
  </div>
  <span class="uptime-txt" id="upt">uptime: 0s</span>
</div>

<div class="cards">
  <div class="card"><div class="clbl">Round</div><div class="cval" id="cRound">—</div><div class="csub">putaran aktif</div></div>
  <div class="card"><div class="clbl">Total Sesi</div><div class="cval" id="cTotal">0</div><div class="csub" id="cTotalSub">sepanjang masa</div></div>
  <div class="card"><div class="clbl">Success Rate</div><div class="cval" id="cRate">—</div><div class="csub" id="cRateSub">sukses / gagal</div></div>
  <div class="card"><div class="clbl">Proxy Pool</div><div class="cval" id="cPool">—</div><div class="csub">proxy valid</div></div>
  <div class="card"><div class="clbl">Proxy Retry</div><div class="cval warn" id="cRetry">0</div><div class="csub">total retry proxy gagal</div></div>
</div>

<div class="act">
  <div class="sec-title">
    <span>&#9679; Aktivitas Real-time</span>
    <span id="connTxt" style="font-size:9px;color:#333">connecting...</span>
  </div>
  <div class="row">
    <span class="badge b-status" id="bStatus">STARTING</span>
    <span class="badge b-sess" id="bSess">—</span>
    <span class="badge b-proxy" id="bProxy">no proxy</span>
  </div>
  <div class="row">
    <div class="prog-wrap">
      <div class="prog-lbl" id="stepLbl">Step — / —</div>
      <div class="prog-bar"><div class="prog-fill" id="progFill" style="width:0%"></div></div>
    </div>
    <span class="timer-txt" id="timerTxt">—</span>
  </div>
  <div class="action-txt" id="actTxt">Menunggu...</div>
  <div class="url-txt" id="urlTxt"></div>
  <div class="ref-txt" id="refTxt"></div>
</div>

<div class="log-wrap">
  <div class="log-hdr"><span>Live Log</span><span id="logCnt">0 events</span></div>
  <div class="log-body" id="logBody"></div>
</div>

<script>
var S = null;
var autoScroll = true;
var lb = document.getElementById('logBody');
lb.addEventListener('scroll', function(){ autoScroll = lb.scrollTop < 20; });

function fmtUptime(s){
  var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if(h>0) return h+'j '+m+'m '+sec+'s';
  if(m>0) return m+'m '+sec+'s';
  return sec+'s';
}
function fmtTs(ts){
  var d=new Date(ts), h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
}
function escH(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function updateUI(s){
  S = s;
  // Dot
  var dot = document.getElementById('dot');
  dot.className = 'dot' + (s.status==='cooldown'?' cool': s.status==='error'?' err': s.status==='starting'||s.status==='loading_proxies'?' idle':'');
  // Uptime
  document.getElementById('upt').textContent = 'uptime: '+fmtUptime(s.uptime);
  // Cards
  document.getElementById('cRound').textContent = s.round>0 ? '#'+s.round : '—';
  document.getElementById('cTotal').textContent = s.totalSessions;
  document.getElementById('cTotalSub').textContent = s.successSessions+' sukses, '+s.failedSessions+' gagal';
  var comp = s.successSessions + s.failedSessions;
  var rate = comp>0 ? ((s.successSessions/comp)*100).toFixed(1)+'%' : '—';
  var rEl = document.getElementById('cRate');
  rEl.textContent = rate;
  rEl.className = 'cval'+(s.failedSessions>0&&s.failedSessions>=s.successSessions?' bad':'');
  document.getElementById('cRateSub').textContent = s.successSessions+' sukses / '+s.failedSessions+' gagal';
  document.getElementById('cPool').textContent = s.proxyPoolSize>0 ? s.proxyPoolSize : '—';
  document.getElementById('cRetry').textContent = s.proxyRetries;
  // Status badge
  var statusMap = {starting:'STARTING',loading_proxies:'LOAD PROXY',running:'RUNNING',cooldown:'COOLDOWN',done:'DONE',error:'ERROR'};
  var bSt = document.getElementById('bStatus');
  bSt.textContent = statusMap[s.status] || s.status.toUpperCase();
  bSt.className = 'badge b-status'+(s.status==='cooldown'?' cool':s.status==='error'?' err':'');
  // Session badge
  if(s.round>0){
    document.getElementById('bSess').textContent = 'R'+s.round+' · S'+(s.sessionIndex+1)+'/'+s.sessionsPerRound+' · try'+(s.attempt+1)+'/'+s.maxAttempts;
  }
  // Proxy badge
  var bp = document.getElementById('bProxy');
  if(s.proxy){ bp.textContent = s.proxy+(s.proxyBurnt?' ⚠ burnt':' ✓ ok'); bp.className='badge b-proxy'+(s.proxyBurnt?' burnt':' clean'); }
  else { bp.textContent='no proxy'; bp.className='badge b-proxy'; }
  // Step
  if(s.step>0){
    document.getElementById('stepLbl').textContent = 'Step '+s.step+' / '+s.totalSteps;
  } else {
    document.getElementById('stepLbl').textContent = '— / —';
    document.getElementById('progFill').style.width='0%';
    document.getElementById('timerTxt').textContent='—';
  }
  // Action / URL / Referrer
  document.getElementById('actTxt').textContent = s.action || '—';
  document.getElementById('urlTxt').textContent = s.targetUrl || '';
  document.getElementById('refTxt').textContent = s.referrer ? 'via: '+s.referrer : '';
  // Log
  renderLog(s.log);
}

function renderLog(entries){
  document.getElementById('logCnt').textContent = entries.length+' events';
  var html = '';
  for(var i=0;i<entries.length;i++){
    var e=entries[i];
    var cls=e.level==='error'?'error':e.level==='warn'?'warn':e.level==='success'?'success':'';
    html += '<div class="le '+cls+'"><span class="ts">'+fmtTs(e.ts)+'</span>'+escH(e.msg)+'</div>';
  }
  lb.innerHTML = html;
  if(autoScroll) lb.scrollTop = 0;
}

// Step progress timer (100ms tick)
setInterval(function(){
  if(!S||S.step<=0||!S.stepStartAt||!S.stepDurationMs) return;
  var elapsed = Date.now()-S.stepStartAt;
  var pct = Math.min(100,(elapsed/S.stepDurationMs)*100);
  document.getElementById('progFill').style.width = pct+'%';
  var rem = Math.max(0,(S.stepDurationMs-elapsed)/1000);
  document.getElementById('timerTxt').textContent = rem.toFixed(1)+'s';
}, 100);

// Cooldown countdown
setInterval(function(){
  if(!S||S.status!=='cooldown'||!S.cooldownEndsAt) return;
  var rem = Math.max(0,Math.floor((S.cooldownEndsAt-Date.now())/1000));
  document.getElementById('actTxt').textContent = 'Cooldown — lanjut dalam '+rem+'s';
}, 1000);

// SSE
var es;
function connect(){
  es = new EventSource('/events');
  es.onopen = function(){ document.getElementById('connTxt').textContent='🟢 live'; document.getElementById('connTxt').style.color='#00704a'; };
  es.onmessage = function(e){ try{ updateUI(JSON.parse(e.data)); }catch(x){} };
  es.onerror = function(){ document.getElementById('connTxt').textContent='🔴 reconnecting...'; document.getElementById('connTxt').style.color='#ff5252'; es.close(); setTimeout(connect,3000); };
}
connect();
</script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────────────────────
export function startDashboard(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    // CORS preflight
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
      // Kirim state saat ini langsung saat connect
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
