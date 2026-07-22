/**
 * test-proxy-sources.ts — live proxy source validator
 * Setiap sumber: fetch → ambil sample → validasi 2-tahap (dengan hard timeout)
 * Output langsung per sumber (tidak nunggu semua selesai).
 */

import * as http  from 'http';
import * as https from 'https';
import * as net   from 'net';

const SAMPLE_PER_SOURCE = 6;    // proxy yang di-test per sumber
const VALIDATE_TIMEOUT  = 3500; // ms per test per tahap
const FETCH_TIMEOUT     = 8000;
const CONCURRENCY       = 6;    // validasi paralel per sumber

interface ProxyEntry { host: string; port: number; }
interface SrcResult   {
  name: string; group: number; fetched: number; tested: number; passed: number;
  countries: string[]; avgMs: number; fetchErr?: string;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error('fetch timeout')), FETCH_TIMEOUT);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { clearTimeout(tid); resolve(d); });
    });
    req.on('error', e => { clearTimeout(tid); reject(e); });
  });
}

function parseLines(text: string): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.includes('://')) line = line.split('://')[1];
    const [host, portStr] = line.split(':');
    if (host && portStr && /^\d+$/.test(portStr.trim())) out.push({ host, port: +portStr });
  }
  return out;
}
function parseRegex(text: string): ProxyEntry[] {
  const out: ProxyEntry[] = []; const re = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) { const p=+m[2]; if (p>=80&&p<=65535) out.push({host:m[1],port:p}); }
  return out;
}
function parseGeonode(text: string): ProxyEntry[] {
  try { const j=JSON.parse(text) as any; return (j.data||[]).map((p:any)=>({host:p.ip,port:+p.port})); } catch { return []; }
}

// ── Validate: hard timeout wrapper ────────────────────────────────────────────

function withTimeout<T>(ms: number, fallback: T, fn: () => Promise<T>): Promise<T> {
  return new Promise(resolve => {
    const tid = setTimeout(() => resolve(fallback), ms);
    fn().then(v => { clearTimeout(tid); resolve(v); }).catch(() => { clearTimeout(tid); resolve(fallback); });
  });
}

function testHttp(p: ProxyEntry): Promise<{ok:boolean;country?:string;ms:number}> {
  return withTimeout(VALIDATE_TIMEOUT, {ok:false,ms:VALIDATE_TIMEOUT}, () =>
    new Promise(resolve => {
      const t0 = Date.now();
      const req = http.request({
        host: p.host, port: p.port, method: 'GET', path: 'http://ip-api.com/json',
        headers: { Host:'ip-api.com','User-Agent':'Mozilla/5.0','Proxy-Connection':'keep-alive' },
      }, res => {
        if (!res.statusCode || res.statusCode>=400) { res.resume(); resolve({ok:false,ms:Date.now()-t0}); return; }
        let b=''; res.on('data',c=>b+=c);
        res.on('end',()=>{
          try { const j=JSON.parse(b); resolve({ok:true,country:j.countryCode||undefined,ms:Date.now()-t0}); }
          catch { resolve({ok:true,ms:Date.now()-t0}); }
        });
      });
      req.on('error',()=>resolve({ok:false,ms:Date.now()-t0}));
      req.setTimeout(VALIDATE_TIMEOUT, ()=>{ req.destroy(); resolve({ok:false,ms:VALIDATE_TIMEOUT}); });
      req.end();
    })
  );
}

function testHttpsConnect(p: ProxyEntry): Promise<boolean> {
  return withTimeout(VALIDATE_TIMEOUT, false, () =>
    new Promise(resolve => {
      const s = net.connect({host:p.host,port:p.port},()=>{
        s.write('CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\nProxy-Connection: keep-alive\r\n\r\n');
      });
      s.setTimeout(VALIDATE_TIMEOUT);
      s.once('data',chunk=>{ s.destroy(); resolve(chunk.toString().includes('200')); });
      s.on('error',()=>resolve(false));
      s.on('timeout',()=>{ s.destroy(); resolve(false); });
    })
  );
}

async function validate(p: ProxyEntry): Promise<{ok:boolean;country?:string;ms:number}> {
  const h = await testHttp(p);
  if (!h.ok) return {ok:false,ms:h.ms};
  const c = await testHttpsConnect(p);
  return {ok:c, country:h.country, ms:h.ms};
}

// ── Concurrent pool runner ────────────────────────────────────────────────────

async function runConcurrent<T>(items: T[], concurrency: number, fn: (item:T)=>Promise<void>) {
  const queue = [...items]; const workers: Promise<void>[] = [];
  const next = async () => { while (queue.length>0) { await fn(queue.shift()!); } };
  for (let i=0; i<Math.min(concurrency,items.length); i++) workers.push(next());
  await Promise.all(workers);
}

// ── Sources ───────────────────────────────────────────────────────────────────

interface Source { name:string; url:string; group:number; country?:string; parseMode?:'lines'|'regex'|'json-geonode'; }

const SOURCES: Source[] = [
  // GRUP 1 — Tier1 country-specific
  {group:1,name:'proxyscrape US 🇺🇸', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=US&ssl=all&anonymity=all',country:'US'},
  {group:1,name:'proxyscrape GB 🇬🇧', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=GB&ssl=all&anonymity=all',country:'GB'},
  {group:1,name:'proxyscrape CA 🇨🇦', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=CA&ssl=all&anonymity=all',country:'CA'},
  {group:1,name:'proxyscrape AU 🇦🇺', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=AU&ssl=all&anonymity=all',country:'AU'},
  {group:1,name:'proxyscrape DE 🇩🇪', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=DE&ssl=all&anonymity=all',country:'DE'},
  {group:1,name:'proxyscrape NL 🇳🇱', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=NL&ssl=all&anonymity=all',country:'NL'},
  {group:1,name:'proxyscrape FR 🇫🇷', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=FR&ssl=all&anonymity=all',country:'FR'},
  {group:1,name:'proxyscrape SE 🇸🇪', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=SE&ssl=all&anonymity=all',country:'SE'},
  {group:1,name:'proxyscrape JP 🇯🇵', url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=JP&ssl=all&anonymity=all',country:'JP'},
  {group:1,name:'proxifly GB 🇬🇧',    url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/GB/data.txt',country:'GB'},
  {group:1,name:'proxifly CA 🇨🇦',    url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CA/data.txt',country:'CA'},
  {group:1,name:'proxifly AU 🇦🇺',    url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/AU/data.txt',country:'AU'},
  {group:1,name:'proxifly DE 🇩🇪',    url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/DE/data.txt',country:'DE'},
  // GRUP 2 — Quality-checked
  {group:2,name:'geonode elite 90%',   url:'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=90&protocols=http,https&anonymityLevel=elite&anonymityLevel=anonymous',parseMode:'json-geonode'},
  {group:2,name:'yakumo pre-checked',  url:'https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt'},
  {group:2,name:'jetkai online-check', url:'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt'},
  {group:2,name:'vakhov fresh daily',  url:'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt'},
  {group:2,name:'almroot proxylist',   url:'https://raw.githubusercontent.com/almroot/proxylist/master/list.txt'},
  // GRUP 3 — Medium reliability
  {group:3,name:'monosans HTTP',       url:'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'},
  {group:3,name:'zevtyardt HTTP',      url:'https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt'},
  {group:3,name:'clarketm',           url:'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt'},
  {group:3,name:'spys.me',            url:'https://spys.me/proxy.txt',parseMode:'regex'},
  // GRUP 4 — High vol / low quality
  {group:4,name:'proxifly all HTTP',  url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt'},
  {group:4,name:'TheSpeedX HTTP',     url:'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'},
  {group:4,name:'proxyscrape ALL',    url:'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=all&ssl=all&anonymity=all'},
];

function shuffle<T>(a:T[]): T[] { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function bar(pct:number,w=18): string { const f=Math.round((pct/100)*w); return '█'.repeat(f)+'░'.repeat(w-f); }

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  process.stdout.write('\n╔══════════════════════════════════════════════════════════════════╗\n');
  process.stdout.write('║    VENENO PROXY SOURCE TEST — live 2-step validation            ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════════════════════╝\n\n');
  process.stdout.write(`Testing ${SAMPLE_PER_SOURCE} sampel per sumber | timeout ${VALIDATE_TIMEOUT}ms | concurrency ${CONCURRENCY}\n`);
  process.stdout.write('2 tahap: [1] HTTP GET ip-api.com  [2] HTTPS CONNECT google:443\n\n');

  const allResults: SrcResult[] = [];
  const groupNames = ['','Tier1 Country-specific','Quality-checked','Medium reliability','High vol/low quality'];
  let currentGroup = 0;

  for (const src of SOURCES) {
    if (src.group !== currentGroup) {
      currentGroup = src.group;
      process.stdout.write(`\n${'═'.repeat(68)}\n`);
      process.stdout.write(`GRUP ${src.group} — ${groupNames[src.group]}\n`);
      process.stdout.write(`${'═'.repeat(68)}\n`);
    }

    const r: SrcResult = { name:src.name, group:src.group, fetched:0, tested:0, passed:0, countries:[], avgMs:0 };

    // Fetch
    let raw: ProxyEntry[] = [];
    try {
      const text = await fetchText(src.url);
      switch (src.parseMode) {
        case 'regex':        raw = parseRegex(text);   break;
        case 'json-geonode': raw = parseGeonode(text); break;
        default:             raw = parseLines(text);   break;
      }
      r.fetched = raw.length;
    } catch (e:any) {
      r.fetchErr = e.message;
      process.stdout.write(`❌ ${src.name}: fetch error — ${e.message}\n`);
      allResults.push(r);
      continue;
    }

    if (raw.length === 0) {
      process.stdout.write(`❌ ${src.name}: 0 proxy ditemukan\n`);
      allResults.push(r);
      continue;
    }

    const sample = shuffle([...raw]).slice(0, SAMPLE_PER_SOURCE);
    r.tested = sample.length;

    // Validate with concurrency
    const outcomes: Array<{ok:boolean;country?:string;ms:number}> = [];
    await runConcurrent(sample, CONCURRENCY, async (p) => {
      const o = await validate(p);
      outcomes.push(o);
    });

    let totalMs = 0;
    const countries = new Set<string>();
    for (const o of outcomes) {
      if (o.ok) { r.passed++; totalMs += o.ms; if (o.country) countries.add(o.country); }
    }
    r.countries = [...countries];
    r.avgMs     = r.passed > 0 ? Math.round(totalMs / r.passed) : 0;

    const pct  = r.tested > 0 ? Math.round((r.passed / r.tested) * 100) : 0;
    const icon = pct >= 50 ? '✅' : pct >= 25 ? '⚠️ ' : '❌';
    const countries_str = r.countries.length > 0 ? ` | ${r.countries.join(',')}` : '';
    const latency_str   = r.avgMs > 0 ? ` | ${r.avgMs}ms avg` : '';

    process.stdout.write(
      `${icon} ${src.name.padEnd(28)} fetch:${String(r.fetched).padStart(5)}  ` +
      `[${bar(pct)}] ${String(pct).padStart(3)}%  ${r.passed}/${r.tested}${latency_str}${countries_str}\n`
    );

    allResults.push(r);
  }

  // ── Rangkuman per grup ────────────────────────────────────────────────────
  process.stdout.write(`\n\n${'═'.repeat(68)}\n`);
  process.stdout.write('RATA-RATA PASS RATE PER GRUP\n');
  process.stdout.write(`${'─'.repeat(68)}\n`);
  for (let g=1; g<=4; g++) {
    const gr = allResults.filter(r=>r.group===g && r.tested>0);
    if (!gr.length) continue;
    const avgPct = Math.round(gr.reduce((s,r)=>s+(r.tested>0?r.passed/r.tested*100:0),0)/gr.length);
    const avgMs  = Math.round(gr.filter(r=>r.avgMs>0).reduce((s,r)=>s+r.avgMs,0)/Math.max(1,gr.filter(r=>r.avgMs>0).length));
    const icon   = avgPct>=50?'✅':avgPct>=25?'⚠️ ':'❌';
    process.stdout.write(`${icon} Grup ${g} (${groupNames[g].padEnd(24)}): ${String(avgPct).padStart(3)}% pass rate, ~${avgMs}ms latency\n`);
  }

  // ── Ranking final ─────────────────────────────────────────────────────────
  process.stdout.write(`\n${'═'.repeat(68)}\n`);
  process.stdout.write('RANKING: PALING OPTIMAL → PALING BURUK\n');
  process.stdout.write(`${'─'.repeat(68)}\n`);

  const ranked = [...allResults].sort((a,b)=>{
    const pa=a.tested>0?a.passed/a.tested:0, pb=b.tested>0?b.passed/b.tested:0;
    if (pb!==pa) return pb-pa;
    return a.avgMs-b.avgMs;
  });

  for (let i=0; i<ranked.length; i++) {
    const r=ranked[i]; const pct=r.tested>0?Math.round(r.passed/r.tested*100):0;
    const icon=pct>=50?'✅':pct>=25?'⚠️ ':'❌';
    process.stdout.write(
      `${String(i+1).padStart(2)}. ${icon} G${r.group} ${r.name.padEnd(28)} ${String(pct).padStart(3)}%  ${r.passed}/${r.tested}` +
      `${r.avgMs>0?'  '+r.avgMs+'ms':''}\n`
    );
  }
  process.stdout.write('\n');
})();
