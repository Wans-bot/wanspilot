/** Isolated browser acceptance. Fixture APIs never mutate a NAS or submit real downloads. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../content/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-browser-'));
const out = path.resolve(process.env.WP_SCREENSHOTS || path.join(repo, 'verify/cinema-v3'));
fs.mkdirSync(out, { recursive: true });
const token = crypto.randomBytes(24).toString('base64url');
const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port; await new Promise(r => reserve.close(r));
const base = `http://127.0.0.1:${port}`;
const processLog = [];
const child = spawn(process.execPath, ['content/server/index.mjs'], { cwd: repo, env: { ...process.env, WP_PORT: String(port), WP_DATA_DIR: path.join(dir, 'data'), WP_DOWNLOAD_DIR: path.join(dir, 'downloads'), WP_CACHE_DIR: path.join(dir, 'cache'), WP_USERNAME: 'admin', WP_PASSWORD: token, WP_ACCESS_TOKEN: '', WP_TMDB_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => processLog.push(d.toString())); child.stderr.on('data', d => processLog.push(d.toString()));
let browser;
const results = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const record = (name, details = {}) => { results.push({ name, ...details }); console.log('PASS', name, JSON.stringify(details)); };
const fallbackHome = { blocks: ['热门电影', '热门剧集', '热门动漫', '高分电影', '高分剧集'].map((title, b) => ({ title, type: b % 2 ? 'tv' : 'movie', id: b < 3 ? 'popular' + b : 'top' + b, items: Array.from({ length: 12 }, (_, i) => ({ id: b * 100 + i + 1, type: b % 2 ? 'tv' : 'movie', title: ['远方来信', '雨夜列车', '深蓝之境', '星光之后'][i % 4], originalTitle: 'Cinema Fixture ' + (i + 1), year: '2026', voteAverage: 8.2, posterPath: '/fixture.jpg', backdropPath: '/fixture-backdrop.jpg', overview: '这是一段用于页面验收的示例简介。测试使用独立数据，不会提交真实下载。' })) })) };
const home = process.env.WP_HOME_FIXTURE ? JSON.parse(fs.readFileSync(process.env.WP_HOME_FIXTURE)) : fallbackHome;
const cards = home.blocks[0].items;
const subs = cards.slice(0, 5).map((film, i) => ({ ...film, id: 'fixture-sub-' + i, tmdbId: film.id, state: i === 2 ? 'error' : 'watching', enabled: true, autoDownload: true, downloadedKeys: [], pendingKeys: i === 0 ? ['S01E01'] : [], qualityPreference: '1080p', minSeeders: 5, maxSizeGB: 30, lastMessage: i === 2 ? '连接超时，稍后重试' : '等待更新' }));
subs[3] = { ...subs[3], id:'calendar-sub-2', type:'tv', downloadedKeys:['S01E01','S01E01'], totalEpisodes:3 };
subs[4] = { ...subs[4], id:'unknown-air-date', type:'tv', downloadedKeys:[], totalEpisodes:0 };
const task = { id: 'a'.repeat(40), infoHash: 'a'.repeat(40), name: 'Example.Movie.2026.1080p.WEB-DL', sizeBytes: 8 * 1024 ** 3, downloadedBytes: 3.2 * 1024 ** 3, progress: .4, state: 'downloading', rateDown: 6.5 * 1024 ** 2, rateUp: 512000, peers: 18, etaSeconds: 780, addedAt: new Date().toISOString(), savePath: '/downloads', files: [] };
const tasks = { items: [task, { ...task, id: 'b'.repeat(40), name: 'Example.Series.S01E01.2160p', state: 'seeding', progress: 1, rateDown: 0 }], stats: { active: 2, completed: 1, rateDown: task.rateDown, rateUp: task.rateUp, totalSizeBytes: task.sizeBytes * 2 } };
const status = { tmdbOk: true, tmdbKeySet: true, tmdbImageOk: true, tmdbMessage: 'TMDB 连接正常', tmdbImageMessage: '海报源连接正常', downloadDirOk: true, downloadDirMessage: '未挂载下载目录', engineReady: false, sources: [{ id: 'fixture', name: '示例索引源', ok: true, latencyMs: 128 }] };
const imageCache = new Map();
let logReads=0;
let sourceSequence=1, sourceMutations=[];
const sourceItems=[{id:'fixture-source',name:'家庭索引服务',type:'torznab',host:'nas.local:9117',enabled:true,apiKeySet:true,urlSet:true,lastTest:null}];

const placeholder = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="460"><rect width="780" height="460" fill="#26394b"/><circle cx="600" cy="150" r="90" fill="#485f73"/></svg>');
async function install(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.evaluateOnNewDocument(() => { sessionStorage.setItem('wanspilot.openingSeen', '1'); localStorage.setItem('wanspilot.theme', 'dark'); });
  await page.emulateTimezone('America/Los_Angeles');
  await page.setRequestInterception(true);
  page.on('request', async req => {
    try {
      const url = new URL(req.url());
      if (url.origin !== base) return req.continue();
      const json = body => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if(url.pathname==='/api/indexers'&&req.method()==='GET')return json({items:sourceItems,limit:12});
      if(url.pathname==='/api/indexers'&&req.method()==='POST'){
        const body=JSON.parse(req.postData());sourceMutations.push({method:'POST',body});const item={id:'fixture-source-'+sourceSequence++,name:body.name,type:body.type,host:new URL(body.url).host,enabled:body.enabled,apiKeySet:!!body.apiKey,urlSet:true,lastTest:null};sourceItems.push(item);return json({item});
      }
      if(/^\/api\/indexers\/[^/]+(?:\/test)?$/.test(url.pathname)){
        const id=url.pathname.split('/')[3],item=sourceItems.find(i=>i.id===id);
        if(url.pathname.endsWith('/test')){item.lastTest={ok:!item.name.includes('失败'),message:item.name.includes('失败')?'无法连接索引服务':'Torznab 连接和认证通过',latencyMs:12,at:'2026-11-12T12:00:00Z'};return json(item.lastTest);}
        if(req.method()==='DELETE'){sourceItems.splice(sourceItems.indexOf(item),1);return json({ok:true});}
        const body=JSON.parse(req.postData());sourceMutations.push({method:'PATCH',body});Object.assign(item,{...body,apiKeySet:body.clearApiKey?false:(!!body.apiKey||item.apiKeySet)});delete item.url;delete item.apiKey;return json({item});
      }
      if(url.pathname==='/api/notifications')return json({items:[{id:'notice-1',title:'订阅已提交',message:'Example 已提交 1 集',kind:'submitted',read:false,at:'2026-12-31T16:00:00Z'}],unread:1});
      if(url.pathname==='/api/notifications/read')return json({unread:0,items:[]});
      if(url.pathname==='/api/overview')return json({at:'2026-12-31T16:00:00Z',subscriptions:{total:5,enabled:4,checking:1},tasks:tasks.stats,capacity:{known:true,freeBytes:600*1024**3},engine:{ready:true},readiness:{tmdbKeySet:true,qbConfigured:true},queue:subs.slice(0,2),notifications:[]});
      if(url.pathname==='/api/subscriptions/batch'){const body=JSON.parse(req.postData());return json({results:body.ids.map(id=>{const item=subs.find(s=>s.id===id);if(item&&body.action==='pause')item.enabled=false;return {id,ok:!!item,message:item?'已更新':'不存在'};})});}
      if(url.pathname==='/api/tasks/batch'){const body=JSON.parse(req.postData());body.ids.forEach(id=>{const item=tasks.items.find(t=>t.id===id);if(item)item.state=body.action==='pause'?'paused':'downloading';});return json({...tasks,results:body.ids.map(id=>({id,ok:true,message:'已更新'}))});}
      if(/^\/api\/subscriptions\/[^/]+\/episodes$/.test(url.pathname))return json({season:1,seasons:[{seasonNumber:1,name:'第 1 季'}],episodes:Array.from({length:65},(_,i)=>({key:'S01E'+String(i+1).padStart(2,'0'),name:'测试集 '+(i+1),airDate:'2026-01-01',status:i===0?'downloading':'missing',inScope:true}))});
      if (url.pathname === '/api/settings' && req.method() === 'PUT' && JSON.parse(req.postData()).qbUsername === 'SAVE-FAILURE') return req.respond({ status: 507, contentType: 'application/json', body: '{"error":"测试：磁盘不可写"}' });
      if (url.pathname === '/api/logs') {logReads++;return req.respond({status:200,contentType:'text/plain',body:'2026-11-12 [INFO] [subs] 创建订阅 Example\n2026-11-12 [INFO] 正在搜索 S01E01\n刷新次数 '+logReads});}
      if (/^\/api\/subscriptions\/[^/]+\/check$/.test(url.pathname)) {
        const sub=subs.find(item=>item.id===url.pathname.split('/')[3]);
        sub.isChecking=true;sub.activity={stage:'searching',at:new Date().toISOString(),message:'正在搜索 S01E02'};sub.lastMessage='正在搜索 S01E02';sub.history=[{...sub.activity}];
        setTimeout(()=>{sub.isChecking=false;sub.pendingKeys=['S01E02'];sub.lastCheckAt=new Date().toISOString();sub.lastMessage='已提交 1 集到 qBittorrent';sub.history.push({stage:'submitted',message:sub.lastMessage,at:new Date().toISOString()});sub.downloads={downloading:1,tasks:[{id:'a'.repeat(40),name:'Example.S01E02',state:'downloading',progress:.4}]};},1800);
        return json({started:true,item:sub,message:'已开始检查'});
      }
      if (url.pathname === '/api/settings/test') {
        const body=JSON.parse(req.postData());
        if(body.kind==='qb') return json({ok:body.qbUsername!=='FAIL-PROBE',message:body.qbUsername==='FAIL-PROBE'?'模拟连接失败':'qB 4.6 连接正常'});
        return json({...status,tmdbImageOk:false,tmdbImageMessage:'模拟图片源不可用'});
      }
      if (/^\/api\/tasks\/[^/]+\/(pause|resume)$/.test(url.pathname)) {
        const item=tasks.items.find(item=>item.id===url.pathname.split('/')[3]);
        item.state=url.pathname.endsWith('/pause')?'paused':'downloading';
        return json({task:item});
      }
      if (url.pathname === '/api/settings/status') { await pause(1500); return json(status); }
      if (url.pathname === '/api/tmdb/home') return json(home);
      if (url.pathname === '/api/tmdb/genres') return json({ genres: [{ id: 18, name: '剧情' }, { id: 28, name: '动作' }] });
      if (url.pathname === '/api/tmdb/languages') return json({ languages: [{ code: 'zh', name: '中文' }, { code: 'en', name: '英语' }] });
      if (['/api/tmdb/browse', '/api/tmdb/discover', '/api/tmdb/search'].includes(url.pathname)) return json({ items: cards, page: 1, totalPages: 1, totalResults: cards.length });
      if (url.pathname === '/api/tmdb/detail') return json({ ...cards.find(c => String(c.id) === url.searchParams.get('id')) || cards[0], runtime: 128, status: '已上映', genres: ['剧情', '冒险'], related: cards.slice(1, 8), cast: [], stills: [], seasons: [] });
      if (url.pathname === '/api/resources') return json({ sources: [{ id: 'fixture', name: '示例索引源', ok: true, count: 3, latencyMs: 128 }], items: [1, 2, 3].map((n, i) => ({ id: n, infoHash: String(n).repeat(40), magnet: 'magnet:?xt=urn:btih:' + String(n).repeat(40), title: 'Example.Movie.2026.' + (i === 0 ? '2160p.BluRay.REMUX' : '1080p.WEB-DL') + '.H265', resolution: i === 0 ? '2160p' : '1080p', codec: 'H265', sourceTag: 'WEB', seeders: 28 + n * 15, sizeBytes: n * 1024 ** 3, indexerName: '示例索引源' })) });
      if (url.pathname === '/api/subscriptions' && req.method() === 'GET') return json({ items: subs });
      if (url.pathname === '/api/tasks' && req.method() === 'GET') return json(tasks);
      if (url.pathname === '/api/tasks/events') return req.respond({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(tasks)}\n\n` });
      if (url.pathname === '/api/calendar') {
        const month = url.searchParams.get('month');
        const item = (id, day, episode, status) => ({ ...subs[id % subs.length], subscriptionId: 'calendar-sub-' + id, tmdbId: cards[id % cards.length].id, title: cards[id % cards.length].title, season: 1, episode, episodeName: '新的旅程 · 第 ' + episode + ' 集', airDate: month + '-' + day, status });
        const days = [
          { date: month + '-03', items: [item(0, '03', 1, 'downloaded'), item(1, '03', 1, 'missing')] },
          { date: month + '-12', items: [item(0, '12', 2, 'downloaded'), item(0, '12', 3, 'missing'), item(1, '12', 2, 'downloading'), ...[2,3,4,5].map(id => item(id, '12', 1, 'missing'))] },
          { date: month + '-19', items: [item(0, '19', 4, 'upcoming'), item(2, '19', 2, 'upcoming')] },
          { date: month + '-26', items: [item(0, '26', 5, 'upcoming'), item(1, '26', 3, 'upcoming'), item(3, '26', 2, 'upcoming')] },
        ];
        // A delayed old-month response exercises rapid navigation race handling.
        if (month.endsWith('-10')) await pause(900);
        const missingDays=[{date:'2025-10-01',items:Array.from({length:11},(_,i)=>({...item(0,'01',i+10,'missing'),airDate:'2025-10-01'}))},...days.map(day=>({...day,items:day.items.filter(item=>item.status==='missing')})).filter(day=>day.items.length)];
        return json({ month, today: month + '-12', total: 14, missing: 17, missingTotal:17,monthMissing:6,missingComplete:true,missingDays, days });
      }
      if (url.pathname === '/api/health/report') return json({ tmdb: { ok: true, message: '连接正常' }, sources: status.sources, capacity: { freeBytes: 600 * 1024 ** 3, quotaGB: 0, downloadDir: '/downloads' }, tasks: tasks.stats, at: new Date().toISOString() });
      if (url.pathname === '/api/image') {
        if (process.env.WP_IMAGE_SOURCE) {
          if (!imageCache.has(url.search)) imageCache.set(url.search, fetch(process.env.WP_IMAGE_SOURCE + '/api/image' + url.search, { signal: AbortSignal.timeout(18000) }).then(async res => { if (!res.ok) throw new Error('Artwork unavailable'); return { status: res.status, contentType: res.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await res.arrayBuffer()) }; }).catch(() => ({ status: 200, contentType: 'image/svg+xml', body: placeholder })));
          return req.respond(await imageCache.get(url.search));
        }
        return req.respond({ status: 200, contentType: 'image/svg+xml', body: placeholder });
      }
      return req.continue();
    } catch { try { await req.abort(); } catch {} }
  });
}
async function checkLayout(page, name) {
  await pause(180);
  const data = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, heading: document.querySelector('#view h1')?.textContent || '', mainChildren: document.querySelector('#view')?.childElementCount }));
  assert.equal(data.overflow, false, name + ' horizontal overflow'); assert.ok(data.mainChildren, name + ' empty view');
  record(name, data);
}
try {
  for (let n = 0; n < 100; n++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await pause(50); }
  if (child.exitCode !== null) throw new Error('Preview server failed: ' + processLog.join(''));
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: token }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ tmdbApiKey: 'fixture-key', qbPassword: 'fixture-secret', theme: 'dark' }) });
  browser = await puppeteer.launch({ executablePath: process.env.WP_CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage(); await page.setViewport({ width: 1440, height: 1000 }); await install(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#access-form');
  await page.type('#access-username', 'admin'); await page.type('#access-token', 'incorrect-test-password');
  await page.click('.access__reveal'); assert.equal(await page.$eval('#access-token', node => node.type), 'text');
  await page.click('.access__reveal'); assert.equal(await page.$eval('#access-token', node => node.type), 'password'); record('login password visibility');
  await page.click('#access-form [type=submit]'); await page.waitForFunction(() => document.querySelector('.access__error')?.textContent.includes('账号或密码不正确')); record('login invalid credentials');
  await page.$eval('#access-token', node => { node.value = ''; });
  await page.$eval('#access-username', node => { node.value = ''; });
  await page.evaluate(() => { document.querySelector('.access__error').textContent = ''; });
  await page.waitForFunction(()=>document.querySelector('.access__scene')?.naturalWidth>0);
  assert.ok(await page.$$eval('.access__fields .field__label svg',nodes=>nodes.length>=2));
  record('login includes local SVG illustration and field icons');
  await checkLayout(page, 'login desktop'); await page.screenshot({ path: path.join(out, 'login-desktop.png') });
  await page.type('#access-username', 'admin'); await page.type('#access-token', token); await page.click('#access-form [type=submit]'); await page.waitForSelector('.feature');
  await page.waitForFunction(() => document.querySelector('.feature__image')?.naturalWidth > 0, { timeout: 22000 });
  const logo = await page.$eval('.brand__logo', async node => {
    await node.decode(); const canvas = document.createElement('canvas'); canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(node, 0, 0);
    return { background: getComputedStyle(node).backgroundColor, alpha: context.getImageData(0, 0, 1, 1).data[3] };
  });
  assert.equal(logo.background, 'rgba(0, 0, 0, 0)'); assert.equal(logo.alpha, 0); record('logo transparent image and CSS', logo);
  await checkLayout(page, 'home desktop'); await page.screenshot({ path: path.join(out, 'home-desktop.png') });
  await page.click('.feature__dot:nth-child(2)');
  assert.equal(await page.$eval('.feature__dot:nth-child(2)', n => n.getAttribute('aria-pressed')), 'true'); record('featured selection');
  const beforeBatch=await page.$$eval('.feature__dot',nodes=>nodes.map(n=>n.getAttribute('aria-label')));
  await page.click('[data-feature-refresh]');
  assert.notDeepEqual(await page.$$eval('.feature__dot',nodes=>nodes.map(n=>n.getAttribute('aria-label'))),beforeBatch);
  await page.evaluate(()=>document.activeElement.blur());await page.mouse.move(0,0);
  const beforeAuto=await page.$eval('.feature__dot.is-active',n=>n.getAttribute('aria-label'));
  await page.evaluate(()=>{window.__realNow=Date.now;Date.now=()=>window.__realNow()+9000;});
  await page.waitForFunction(old=>document.querySelector('.feature__dot.is-active')?.getAttribute('aria-label')!==old,{timeout:4000},beforeAuto);
  await page.evaluate(()=>{Date.now=window.__realNow;});
  await page.click('[data-feature-pause]');await page.evaluate(()=>document.activeElement.blur());await page.mouse.move(0,0);
  const pausedSlide=await page.$eval('.feature__dot.is-active',n=>n.getAttribute('aria-label'));
  await page.evaluate(()=>{Date.now=()=>window.__realNow()+9000;});await pause(1300);
  assert.equal(await page.$eval('.feature__dot.is-active',n=>n.getAttribute('aria-label')),pausedSlide);
  await page.evaluate(()=>{Date.now=window.__realNow;});
  record('featured batches refresh, autoplay advances and explicit pause stops rotation');
  await page.evaluate(() => { location.hash = '#/settings?tab=qb'; }); await page.waitForSelector('#settings-form');
  await page.type('[name=qbUsername]', 'DRAFT-PRESERVED'); await pause(1900);
  assert.equal(await page.$eval('[name=qbUsername]', n => n.value), 'DRAFT-PRESERVED'); record('self-test preserves draft');
  await page.screenshot({ path: path.join(out, 'settings-desktop.png') });
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.feature');
  await page.evaluate(() => { location.hash = '#/settings?tab=qb'; }); await page.waitForSelector('#settings-form');
  assert.equal(await page.$eval('[name=qbUsername]', n => n.value), 'DRAFT-PRESERVED'); record('navigation restores draft');
  await page.$eval('[name=qbUsername]', n => { n.value = 'SAVE-FAILURE'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#settings-form [type=submit]'); await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent.includes('保存失败'));
  assert.equal(await page.$eval('[name=qbUsername]', n => n.value), 'SAVE-FAILURE'); record('save failure preserves draft');
  await page.$eval('[name=qbUsername]', n => { n.value = 'SAVED-TEST'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#settings-form [type=submit]'); await page.waitForFunction(() => document.querySelector('#save-state')?.textContent === '所有更改已保存');
  assert.equal(await page.$eval('[name=qbPassword]', n => n.value), ''); record('save keeps secret masked');
  await page.click('[data-action="test-qb"]');
  await page.waitForFunction(()=>document.querySelector('#qb-test-result')?.dataset.state==='ok');
  await page.$eval('[name=qbUsername]',n=>{n.value='FAIL-PROBE';});
  await page.click('[data-action="test-qb"]');
  await page.waitForFunction(()=>document.querySelector('#qb-test-result')?.textContent.includes('模拟连接失败'));
  record('qB inline connection success and failure');
  await page.evaluate(()=>{location.hash='#/settings?tab=tmdb';}); await page.waitForSelector('[data-section="tmdb"]');
  await page.click('[data-section="tmdb"] [data-kind="tmdb"]');
  await page.waitForFunction(()=>document.querySelector('[data-section="tmdb"] .connection-result')?.dataset.state==='ok');
  await page.click('[data-section="tmdb"] [data-kind="image"]');
  await page.waitForFunction(()=>document.querySelector('[data-section="tmdb"] .connection-result')?.textContent.includes('模拟图片源不可用'));
  assert.equal(await page.$eval('[data-section="tmdb"] .connection-result',n=>n.dataset.state),'error');
  await page.click('[data-section="tmdb"] details > summary');
  await page.screenshot({path:path.join(out,'settings-network-expanded.png')});
  record('TMDB and image tests report independent results');
  await page.evaluate(()=>{location.hash='#/search';}); await page.waitForSelector('.filter-common select');
  await page.select('select[aria-label="风格"]','18');
  await page.waitForFunction(()=>location.hash.includes('genre=18')&&document.querySelector('.selected-filter')?.textContent.includes('剧情'));
  await page.click('.filter-advanced > summary');
  await page.screenshot({path:path.join(out,'search-advanced.png')});
  await page.click('[data-action="filter-reset"]');
  await page.waitForFunction(()=>!location.hash.includes('genre='));
  record('compact filters navigate and reset selected conditions');
  await pause(250);
  await page.waitForFunction(()=>!document.querySelector('#search-hint')&&document.querySelector('[data-key="years"][data-value="2021-2021"]'));
  if(!await page.$eval('.filter-advanced',node=>node.open))await page.click('.filter-advanced > summary');
  const currentShanghaiYear=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()));
  const yearLabels=await page.$$eval('[data-key="years"]',nodes=>nodes.map(node=>node.textContent));
  for(let year=2020;year<=currentShanghaiYear;year++)assert.ok(yearLabels.includes(String(year)));
  assert.ok(!yearLabels.includes(String(currentShanghaiYear+1)));
  for(const year of [...new Set(['2021','2022','2023',String(currentShanghaiYear)])]){
    const requested=page.waitForRequest(req=>{const url=new URL(req.url());return url.pathname==='/api/tmdb/discover'&&url.searchParams.get('yearFrom')===year&&url.searchParams.get('yearTo')===year;});
    await page.$eval('[data-key="years"][data-value="'+year+'-'+year+'"]',button=>button.click());await requested;
    await page.waitForFunction(value=>document.querySelector('[data-key="years"][data-value="'+value+'-'+value+'"]')?.getAttribute('aria-pressed')==='true',{},year);
    assert.ok((await page.$eval('.selected-filters',node=>node.textContent)).includes(year));
  }
  await page.screenshot({path:path.join(out,'search-specific-years-desktop.png')});
  await page.click('[data-key="years"][data-value="2020-2029"]');
  await page.waitForFunction(()=>location.hash.includes('years=2020-2029'));
  await page.waitForSelector('[data-action="filter-reset"]',{visible:true});await pause(180);await page.click('[data-action="filter-reset"]');await page.waitForFunction(()=>!location.hash.includes('years='));
  record('search exposes individual years through Shanghai current year and sends exact-year ranges');

  await page.evaluate(()=>{location.hash='#/tasks';}); await page.waitForSelector('[data-action="task-pause"]');
  await page.click('[data-action="task-pause"]');
  await page.waitForFunction(()=>document.querySelector('.task')?.textContent.includes('任务已暂停'));
  await page.click('.task [data-action="task-resume"]');
  await page.waitForFunction(()=>document.querySelector('.task')?.textContent.includes('任务已继续'));
  assert.equal(await page.$eval('.task [role="progressbar"]',n=>Number(n.getAttribute('aria-valuenow'))),40);
  record('download pause resume and accessible progress');
  await page.evaluate(()=>{location.hash='#/subscribe?type=tv';}); await page.waitForSelector('.sub-card__schedule');
  await page.waitForFunction(()=>[...document.querySelectorAll('.sub-card__schedule')].some(n=>n.textContent.includes('S01 E02')));
  assert.ok((await page.$eval('[data-id="calendar-sub-2"] .sub-card__progress',n=>n.textContent)).includes('已下载 1 / 已播 3 集'));
  assert.equal(await page.$eval('[data-id="unknown-air-date"] .sub-card__schedule',n=>n.textContent),'本月暂无后续播出计划');
  await page.screenshot({path:path.join(out,'subscriptions-tv-desktop.png')});
  record('TV subscriptions use unique downloaded counts and known calendar dates');
  await page.click('[data-id="calendar-sub-2"] [data-action="sub-check"]');
  await page.waitForFunction(()=>document.querySelector('[data-id="calendar-sub-2"] .sub-card__status')?.textContent.includes('正在搜索'));
  await page.click('[data-id="calendar-sub-2"] [data-action="sub-activity"]');await page.waitForSelector('[data-subscription-activity]');
  assert.ok((await page.$eval('[data-subscription-activity]',n=>n.textContent)).includes('正在搜索 S01E02'));
  await page.waitForFunction(()=>document.querySelector('[data-subscription-activity]')?.textContent.includes('关联下载任务'),{timeout:12000});
  assert.ok((await page.$eval('[data-id="calendar-sub-2"] .sub-card__status',n=>n.textContent)).includes('下载中'));
  await page.screenshot({path:path.join(out,'subscription-activity-desktop.png')});await page.click('.modal [data-close]');
  record('subscription search and download stages refresh without reload and history remains visible');
  await page.evaluate(()=>{location.hash='#/settings?tab=diag';});await page.waitForSelector('#logs');
  await page.waitForFunction(()=>document.querySelector('#logs')?.textContent.includes('创建订阅'));
  const initialReads=logReads;await page.waitForFunction(()=>document.querySelector('#logs')?.textContent.includes('刷新次数 2'),{timeout:10000});
  await page.type('#logs-filter','创建订阅');
  assert.ok(!(await page.$eval('#logs',n=>n.textContent)).includes('正在搜索'));
  await page.screenshot({path:path.join(out,'operation-logs-desktop.png')});record('operation logs auto load refresh and filter');

  await page.evaluate(()=>{location.hash='#/home';}); await page.waitForSelector('.feature__image');
  const responsive=await page.$eval('.feature__image',n=>({srcset:n.srcset,sizes:n.sizes}));
  assert.ok(responsive.srcset.includes('w1280')); assert.ok(responsive.sizes);
  await page.evaluate(()=>{const img=document.querySelector('.rail .card img');img.src='/missing-poster-for-acceptance.png';});
  await page.waitForSelector('.poster__empty');
  record('responsive backdrop and poster error fallback');
  const routes = [['sources','#/sources','.source-card'], ['search', '#/search', '.grid .card'], ['detail', '#/detail/movie/' + cards[0].id, '.hero__title'], ['resources', '#/resources/movie/1?title=Example', '.res'], ['tasks', '#/tasks', '.task'], ['subscribe', '#/subscribe', '.sub-card'], ['calendar', '#/calendar', '.cal__grid'], ['health', '#/health', '.grid--cards .panel'], ['overview','#/overview','.overview-grid'], ['notifications','#/notifications','.notification-item']];
  for (const [name, hash, selector] of routes) {
    await page.evaluate(hash => { location.hash = hash; }, hash); await page.waitForSelector(selector); await checkLayout(page, name + ' desktop'); await page.screenshot({ path: path.join(out, name + '-desktop.png') });
  }
  await page.evaluate(()=>{location.hash='#/sources';});await page.waitForSelector('.source-card');
  await page.evaluate(()=>[...document.querySelectorAll('.source-card button')].find(b=>b.textContent==='编辑').click());await page.waitForSelector('#source-form');
  assert.equal(await page.$eval('#source-form [name=url]',n=>n.value),'');assert.equal(await page.$eval('#source-form [name=apiKey]',n=>n.value),'');
  const sourceSwitch=await page.$eval('#source-form [name=enabled]',n=>({width:parseFloat(getComputedStyle(n).width),height:parseFloat(getComputedStyle(n).height),checked:n.checked}));assert.deepEqual(sourceSwitch,{width:36,height:22,checked:true});
  await page.focus('#source-form [name=enabled]');await page.keyboard.press('Space');assert.equal(await page.$eval('#source-form [name=enabled]',n=>n.checked),false);await page.keyboard.press('Space');
  await page.screenshot({path:path.join(out,'source-editor-desktop.png')});
  await page.click('#source-form [type=submit]');await page.waitForSelector('#source-form',{hidden:true});assert.equal(sourceMutations.at(-1).body.url,'');assert.equal(sourceMutations.at(-1).body.apiKey,'');record('source edit hides credentials, preserves blank fields and supports keyboard switches');
  await page.evaluate(()=>[...document.querySelectorAll('.source-card button')].find(b=>b.textContent.includes('测试')).click());await page.waitForFunction(()=>document.querySelector('.source-card').textContent.includes('连接正常'));assert.ok((await page.$eval('.source-card',n=>n.textContent)).includes('2026-11-12 20:00'));record('source connection result uses Shanghai time');
  await page.evaluate(()=>[...document.querySelectorAll('#view button')].find(b=>b.textContent.includes('添加渠道')).click());await page.waitForSelector('#source-form');await page.type('#source-form [name=name]','RSS 失败测试');await page.select('#source-form [name=type]','rss');await page.type('#source-form [name=url]','http://nas.local:9117/feed?passkey=fixture-secret');await page.click('#source-form [type=submit]');await page.waitForFunction(()=>document.querySelectorAll('.source-card').length===2);assert.equal(await page.$eval('#view',n=>n.textContent.includes('fixture-secret')),false);record('source creation masks complete RSS URLs');
  await page.evaluate(()=>[...document.querySelectorAll('.source-card')].find(n=>n.textContent.includes('RSS 失败测试')).querySelector('button').click());await page.waitForFunction(()=>[...document.querySelectorAll('.source-card')].some(n=>n.textContent.includes('连接异常')));record('source connection failures remain visible');
  await page.evaluate(()=>[...document.querySelectorAll('.source-card button')].find(b=>b.textContent==='停用').click());await page.waitForFunction(()=>document.querySelector('.source-card').textContent.includes('已停用'));assert.equal(tasks.items.length,2);record('disabling source preserves existing downloads');
  await page.evaluate(()=>[...document.querySelectorAll('.source-card')].find(n=>n.textContent.includes('RSS 失败测试')).querySelectorAll('button')[3].click());await page.waitForFunction(()=>document.querySelectorAll('.source-card').length===1);record('source deletion updates page');
  await page.evaluate(()=>{location.hash='#/notifications';});await page.waitForSelector('.notification-item time');
  assert.ok((await page.$eval('.notification-item time',n=>n.textContent)).includes('2027-01-01 00:00'));
  assert.equal(await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone),'America/Los_Angeles');
  await page.click('[aria-label="标记已读 订阅已提交"]');await pause(250);record('Shanghai display ignores browser zone and notification read succeeds');
  await page.evaluate(()=>{location.hash='#/tasks';});await page.waitForSelector('.task-select');
  await page.select('[aria-label="任务状态"]','completed');assert.equal(await page.$$('.task').then(a=>a.length),1);
  await page.select('[aria-label="任务状态"]','all');await page.click('.task-select');await page.click('[data-task-batch="pause"]');await page.waitForSelector('.batch-results');
  assert.ok((await page.$eval('.batch-results',n=>n.textContent)).includes('成功 1 / 1'));await page.click('.modal [data-close]');
  await page.click('.task-select');record('task state filters and selected batch pause');
  await page.evaluate(()=>{location.hash='#/subscribe';});await page.waitForSelector('.sub-card');
  const checkbox=await page.$eval('.sub-card__select',n=>({width:n.querySelector('input').getBoundingClientRect().width,background:getComputedStyle(n).backgroundColor,touch:n.getBoundingClientRect().width}));assert.equal(checkbox.width,20);assert.equal(checkbox.background,'rgba(0, 0, 0, 0)');assert.equal(checkbox.touch,44);record('subscription selection uses small checkbox with transparent touch target');
  await page.click('.sub-card__more');await page.waitForSelector('[data-action="sub-edit"]');await page.click('[data-action="sub-edit"]');await page.waitForSelector('#sub-edit-form');
  assert.equal(await page.$eval('#sub-edit-form [name=enabled]',n=>n.getAttribute('role')),'switch');assert.equal(await page.$eval('#sub-edit-form [name=enabled]',n=>getComputedStyle(n).width),'36px');await pause(180);await page.screenshot({path:path.join(out,'subscription-editor-desktop.png')});await page.click('.modal [data-close]');record('subscription auto-check uses compact accessible switch');
  await page.click('.sub-card__select input');await page.click('[data-sub-batch="auto-off"]');await page.waitForSelector('.batch-results');await page.click('.modal [data-close]');record('subscription batch explicit selection');
  await page.click('.sub-tabs a[href$="type=tv"]');await page.waitForSelector('[data-action="sub-episodes"]');
  await page.click('[data-action="sub-episodes"]');await page.waitForSelector('.episode-row');
  assert.equal(await page.$$('.episode-row').then(a=>a.length),50);
  assert.equal(await page.$eval('.episode-row input',n=>n.disabled),true);
  await page.click('.episode-row:nth-child(2) input');assert.ok((await page.$eval('.episode-manager',n=>n.textContent)).includes('已选 1 集'));
  await page.screenshot({path:path.join(out,'episode-manager-desktop.png')});
  await page.evaluate(()=>[...document.querySelectorAll('.episode-manager button')].find(n=>n.textContent.includes('下一页')).click());
  assert.equal(await page.$$('.episode-row').then(a=>a.length),15);
  await page.click('.modal [data-close]');record('episode manager paginates and protects active downloads');
  await page.evaluate(() => { location.hash = '#/calendar'; }); await page.waitForSelector('.cal__grid');
  assert.equal(await page.$eval('.cal-metric:nth-child(3) strong',n=>n.textContent),'17');
  await page.click('.cal-metric:nth-child(3)');await page.waitForSelector('.cal-agenda__day[data-date="2025-10-01"]');
  assert.ok((await page.$eval('#calendar-count',n=>n.textContent)).includes('17 集'));
  assert.equal(await page.$eval('.cal-month-view',n=>getComputedStyle(n).display),'none');
  await page.screenshot({path:path.join(out,'calendar-all-missing.png')});record('calendar missing metric includes prior months and opens full backlog');
  await page.select('#calendar-status','all');
  const daySelector = '.cal__cell[data-date$="-12"]';
  assert.equal(await page.$$eval(daySelector + ' .cal__item', nodes => nodes.length), 3); record('calendar collapses busy dates');
  await page.click(daySelector + ' .cal__more');
  assert.equal(await page.$$eval(daySelector + ' .cal__item', nodes => nodes.length), 6); record('calendar expands busy dates');
  assert.ok((await page.$eval(daySelector, node => node.textContent)).includes('1/2 已完成')); record('calendar same-day episode grouping');
  await page.click(daySelector + ' .cal__date'); await page.waitForSelector('.cal-day-detail');
  assert.equal(await page.$$eval('.cal-day-detail__episodes > div', nodes => nodes.length), 7); record('calendar day details');
  const resourceLink = await page.$eval('.cal-day-detail__group > a.btn', node => node.getAttribute('href'));
  assert.ok(resourceLink.includes('&season=1&episode=1')); record('calendar resource link preserves season and episode');
  await pause(250); await page.evaluate(() => document.querySelector('#toasts').replaceChildren()); await page.screenshot({ path: path.join(out, 'calendar-day-detail.png') }); await page.click('.modal [data-close]');
  await page.select('#calendar-status', 'upcoming');
  assert.equal(await page.$$eval('.cal-month-view .cal__item', nodes => nodes.length), 5); record('calendar future status filter');
  await page.select('#calendar-series', 'calendar-sub-0');
  assert.equal(await page.$$eval('.cal-month-view .cal__item', nodes => nodes.length), 2); record('calendar combined series filter');
  await page.select('#calendar-status', 'all'); await page.select('#calendar-series', 'all');
  await page.click('[data-layout="agenda"]'); await checkLayout(page, 'calendar timeline desktop');
  await page.screenshot({ path: path.join(out, 'calendar-timeline-desktop.png') });
  await page.click('[data-layout="month"]');
  await page.$eval('input[type=month]', input => { input.value = '2026-10'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('input[type=month]', input => { input.value = '2026-11'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForSelector('.cal__grid'); await pause(1100);
  assert.equal(await page.$eval('.cal__cell[data-date]', node => node.dataset.date), '2026-11-01'); record('calendar ignores late old-month responses');
  await page.screenshot({ path: path.join(out, 'calendar-desktop.png'), fullPage: true });
  const mobile = await context.newPage(); await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await install(mobile);
  await mobile.goto(base + '/#/home', { waitUntil: 'domcontentloaded' }); await mobile.waitForSelector('.feature'); await pause(800);
  await checkLayout(mobile, 'home mobile');
  const navRect = await mobile.$eval('.nav', n => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom }));
  assert.ok(navRect.top > 700, 'mobile navigation must stay at viewport bottom'); record('mobile bottom navigation', navRect);
  await mobile.screenshot({ path: path.join(out, 'home-mobile.png') });
  for (const [name, hash, selector] of [...routes, ['settings', '#/settings?tab=qb', '#settings-form']]) {
    await mobile.evaluate(hash => { location.hash = hash; }, hash); await mobile.waitForSelector(selector); await checkLayout(mobile, name + ' mobile'); await mobile.screenshot({ path: path.join(out, name + '-mobile.png'), fullPage: name === 'calendar' });
  }
  await mobile.evaluate(() => { location.hash = '#/calendar'; }); await mobile.waitForSelector('.cal-agenda');
  assert.equal(await mobile.$eval('.cal-agenda-view', node => getComputedStyle(node).display), 'block'); record('mobile calendar uses timeline');
  await mobile.select('#calendar-status', 'upcoming'); await checkLayout(mobile, 'calendar mobile filtered');
  assert.equal(await mobile.$$eval('.cal-agenda .cal__item', nodes => nodes.length), 5);
  await mobile.select('#calendar-status', 'all');
  await mobile.$eval('.cal-agenda', node => node.scrollIntoView({ block: 'start' })); await pause(180);
  await mobile.screenshot({ path: path.join(out, 'calendar-timeline-mobile.png') });
  await mobile.evaluate(() => scrollTo(0, 0));
  await mobile.click('[data-action="theme-toggle"]'); await checkLayout(mobile, 'calendar mobile light');
  await mobile.screenshot({ path: path.join(out, 'calendar-light-mobile.png'), fullPage: true });
  await mobile.click('[data-action="theme-toggle"]');
  await mobile.click('[data-action="theme-toggle"]'); await mobile.evaluate(() => { location.hash = '#/home'; }); await mobile.waitForSelector('.feature'); await checkLayout(mobile, 'home mobile light');
  assert.equal(await mobile.$eval('html', n => n.dataset.theme), 'light');assert.equal(await mobile.$eval('.btn',n=>getComputedStyle(n).borderRadius),'8px');record('light theme shares eight-pixel control radius'); await mobile.screenshot({ path: path.join(out, 'home-light-mobile.png') });
  if (process.env.WP_MOBILE_MATRIX) {
    const audit = [];
    const matrixRoutes = [['home', '#/home', '.feature'], ...routes, ...['tmdb','qb','filter','files','diag'].map(tab => ['settings-' + tab, '#/settings?tab=' + tab, '#settings-section'])];
    for (const theme of ['light','dark']) {
    await mobile.evaluate(theme => {document.documentElement.dataset.theme=theme;},theme);
    for (const [width, height] of [[320,740],[360,780],[390,844],[430,932],[768,1024],[844,390],[1024,768]]) {
      await mobile.bringToFront(); await mobile.setViewport({ width, height, isMobile: true, hasTouch: true });
      for (const [name, hash, selector] of matrixRoutes) {
        await mobile.evaluate(hash => { location.hash = hash; }, hash); await mobile.waitForSelector(selector);
        await pause(90);
        const row = await mobile.evaluate(() => {
          const rect = selector => { const node = document.querySelector(selector); const r = node?.getBoundingClientRect(); return r ? { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height } : null; };
          const nav = rect('.nav');
          const clipped = Array.from(document.querySelectorAll('#view input:not([type=checkbox]),#view select,#view textarea')).filter(node => {
            const r=node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > innerWidth + 1);
          }).map(node => node.name || node.id);
          const controls = Array.from(document.querySelectorAll('.topbar__tools > *')).filter(node => node.getBoundingClientRect().width);
          const overlap = controls.some((node,index) => index && controls[index-1].getBoundingClientRect().right > node.getBoundingClientRect().left + 1);
          return { overflow:document.documentElement.scrollWidth > innerWidth+1, clipped, nav, overlap, firstCard:rect('#search-results .card, #resource-results .res'), save:rect('.settings__savebar') };
        });
        if (width<=860 && name.startsWith('settings-') && name!=='settings-diag') {
          row.saveReachable=await mobile.evaluate(()=>{
            scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});
            const r=document.querySelector('.settings__savebar').getBoundingClientRect();
            return r.top>=60 && r.bottom<=document.querySelector('.nav').getBoundingClientRect().top;
          });
          await mobile.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
        }
        audit.push({ theme,width,height,name,...row });
        if ((width === 390 || width === 768) && theme==='light') await mobile.screenshot({path:path.join(out, 'matrix-' + width + '-' + name + '.png')});
      }
    }
    }
    fs.writeFileSync(path.join(out,'mobile-matrix.json'), JSON.stringify(audit,null,2));
    const problems = audit.filter(row => row.overflow || row.clipped.length || row.overlap || row.saveReachable===false || (row.width<=860 && Math.abs(row.nav.bottom-row.height)>2));
    console.log('MOBILE_MATRIX_PROBLEMS', JSON.stringify(problems));
    assert.deepEqual(problems, []); record('mobile viewport matrix', { pages:audit.length });
    await mobile.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await mobile.evaluate(() => {location.hash='#/search';}); await mobile.waitForSelector('.filter-panel');
    assert.equal(await mobile.$eval('.filter-panel',n=>n.open),false);
    await mobile.click('.filter-panel > summary');
    assert.equal(await mobile.$eval('.filter-panel',n=>n.open),true);
    await mobile.click('.filter-panel > summary');
    await mobile.setViewport({width:1024,height:768,isMobile:true,hasTouch:true}); await pause(180);
    assert.equal(await mobile.$eval('.filter-panel',n=>n.open),true); record('filters expand when crossing desktop breakpoint');
    await mobile.setViewport({width:390,height:844,isMobile:true,hasTouch:true}); await pause(180);
    assert.equal(await mobile.$eval('.filter-panel',n=>n.open),false); record('mobile filters expand and collapse');
    await mobile.evaluate(()=>{location.hash='#/settings?tab=qb';}); await mobile.waitForSelector('#settings-section');
    await mobile.$eval('[name=qbUsername]',n=>{n.value='MOBILE-DRAFT';n.dispatchEvent(new Event('input',{bubbles:true}));});
    await mobile.select('#settings-section','tmdb'); await mobile.select('#settings-section','qb');
    assert.equal(await mobile.$eval('[name=qbUsername]',n=>n.value),'MOBILE-DRAFT');record('mobile section picker preserves form drafts');
    await mobile.$eval('.settings__savebar',n=>n.scrollIntoView({block:'center'}));await pause(800);
    await mobile.screenshot({path:path.join(out,'settings-save-mobile.png')});
    const saveFits=await mobile.$eval('.settings__savebar',n=>{const r=n.getBoundingClientRect();return r.top>=60&&r.bottom<=document.querySelector('.nav').getBoundingClientRect().top;});
    assert.equal(saveFits,true);record('mobile save controls remain above navigation');
    await mobile.evaluate(() => {location.hash='#/calendar';}); await mobile.waitForSelector('.cal-agenda');
    await mobile.click('.cal-agenda__head .btn'); await mobile.waitForSelector('.modal'); await pause(220);
    assert.equal(await mobile.$eval('.nav',node=>getComputedStyle(node).visibility),'hidden');
    assert.equal(await mobile.$eval('main',node=>node.inert),true);
    const modal = await mobile.$eval('.modal',node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}));
    assert.ok(modal.top>=0 && modal.bottom<=844); record('mobile modal fits and isolates navigation',modal);
    await mobile.screenshot({path:path.join(out,'modal-mobile.png')});
    await mobile.setViewport({width:390,height:430,isMobile:true,hasTouch:true}); await pause(200);
    const shortModal = await mobile.$eval('.modal',node=>node.getBoundingClientRect().bottom); assert.ok(shortModal<=430);
    await mobile.keyboard.press('Tab');
    assert.equal(await mobile.$eval('.modal',n=>n.contains(document.activeElement)),true);
    await mobile.keyboard.down('Shift'); await mobile.keyboard.press('Tab'); await mobile.keyboard.up('Shift');
    assert.equal(await mobile.$eval('.modal',n=>n.contains(document.activeElement)),true);
    record('mobile modal traps keyboard focus');
    record('mobile modal short viewport'); await mobile.click('.modal [data-close]');
    assert.equal(await mobile.$eval('main',node=>node.inert),false);
    await mobile.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  }
  await mobile.evaluate(()=>{location.hash='#/tasks';}); await mobile.waitForSelector('.task [role="progressbar"]');
  assert.ok(await mobile.$eval('.task [role="progressbar"]',n=>n.getBoundingClientRect().width>=100));
  await mobile.screenshot({path:path.join(out,'tasks-mobile-final.png')});
  record('mobile task progress remains visible');
  await mobile.evaluate(()=>{location.hash='#/subscribe?type=tv';});await mobile.waitForSelector('.sub-card [data-action="sub-activity"]');
  await mobile.click('.sub-card [data-action="sub-activity"]');await mobile.waitForSelector('.subscription-activity-detail');
  await checkLayout(mobile,'subscription activity mobile');await mobile.screenshot({path:path.join(out,'subscription-activity-mobile.png')});await mobile.click('.modal [data-close]');
  await page.bringToFront();
  console.log('CHECK organizer preview');
  await page.evaluate(() => { location.hash = '#/settings?tab=files'; }); await page.waitForSelector('[data-action="organize-preview"]');
  await page.click('[data-action="organize-preview"]'); await page.waitForSelector('.modal'); record('organizer preview dialog'); await page.click('.modal [data-close]');
  await page.click('#logout-button'); await page.waitForSelector('#access-form'); record('logout returns to access screen');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await checkLayout(page, 'login mobile');
  const loginGeometry=await page.$eval('#access-form',n=>{const r=n.getBoundingClientRect(),b=n.querySelector('[type=submit]').getBoundingClientRect(),fields=n.querySelector('.access__fields').getBoundingClientRect();return {center:(r.left+r.right)/2,width:fields.width,buttonWidth:b.width,gap:b.top-fields.bottom};});
  assert.ok(Math.abs(loginGeometry.center-195)<2);assert.ok(loginGeometry.buttonWidth>=loginGeometry.width-2);assert.ok(loginGeometry.gap>=20);
  record('login centers form and provides full width separated submit',loginGeometry);
  await page.screenshot({ path: path.join(out, 'login-mobile.png') });
  await page.setViewport({ width: 320, height: 740 }); await checkLayout(page, 'login narrow mobile');
  await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await checkLayout(page, 'login light mobile');
  await page.screenshot({ path: path.join(out, 'login-light-mobile.png') });
  for(const [width,height] of [[768,1024],[844,390],[1024,768],[390,430]]) {
    await page.setViewport({width,height});await checkLayout(page,'login '+width+'x'+height);
    await page.$eval('#access-form [type=submit]',n=>n.scrollIntoView({block:'center',behavior:'instant'}));
    const visible=await page.$eval('#access-form [type=submit]',n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});assert.equal(visible,true);
    if(width===844)await page.screenshot({path:path.join(out,'login-landscape.png')});
  }
  assert.deepEqual(errors, []); record('no browser JavaScript exceptions');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: results.length, fixtures: true, realArtSource: Boolean(process.env.WP_IMAGE_SOURCE), checks: results, errors }, null, 2));
  console.log('Browser acceptance complete:', results.length, 'checks');
} finally {
  await browser?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
  fs.rmSync(dir, { recursive: true, force: true });
}
