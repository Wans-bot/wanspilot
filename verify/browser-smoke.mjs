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
const task = { id: 'a'.repeat(40), infoHash: 'a'.repeat(40), name: 'Example.Movie.2026.1080p.WEB-DL', sizeBytes: 8 * 1024 ** 3, downloadedBytes: 3.2 * 1024 ** 3, progress: .4, state: 'downloading', rateDown: 6.5 * 1024 ** 2, rateUp: 512000, peers: 18, etaSeconds: 780, addedAt: new Date().toISOString(), savePath: '/downloads', files: [] };
const tasks = { items: [task, { ...task, id: 'b'.repeat(40), name: 'Example.Series.S01E01.2160p', state: 'seeding', progress: 1, rateDown: 0 }], stats: { active: 2, completed: 1, rateDown: task.rateDown, rateUp: task.rateUp, totalSizeBytes: task.sizeBytes * 2 } };
const status = { tmdbOk: true, tmdbKeySet: true, tmdbImageOk: true, tmdbMessage: 'TMDB 连接正常', tmdbImageMessage: '海报源连接正常', downloadDirOk: true, downloadDirMessage: '未挂载下载目录', engineReady: false, sources: [{ id: 'fixture', name: '示例索引源', ok: true, latencyMs: 128 }] };
const imageCache = new Map();
const placeholder = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="460"><rect width="780" height="460" fill="#26394b"/><circle cx="600" cy="150" r="90" fill="#485f73"/></svg>');
async function install(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.evaluateOnNewDocument(() => { sessionStorage.setItem('wanspilot.openingSeen', '1'); localStorage.setItem('wanspilot.theme', 'dark'); });
  await page.setRequestInterception(true);
  page.on('request', async req => {
    try {
      const url = new URL(req.url());
      if (url.origin !== base) return req.continue();
      const json = body => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/settings' && req.method() === 'PUT' && JSON.parse(req.postData()).qbUsername === 'SAVE-FAILURE') return req.respond({ status: 507, contentType: 'application/json', body: '{"error":"测试：磁盘不可写"}' });
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
        return json({ month, today: month + '-12', total: 14, missing: 6, days });
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
  const routes = [['search', '#/search', '.grid .card'], ['detail', '#/detail/movie/' + cards[0].id, '.hero__title'], ['resources', '#/resources/movie/1?title=Example', '.res'], ['tasks', '#/tasks', '.task'], ['subscribe', '#/subscribe', '.sub-card'], ['calendar', '#/calendar', '.cal__grid'], ['health', '#/health', '.grid--cards .panel']];
  for (const [name, hash, selector] of routes) {
    await page.evaluate(hash => { location.hash = hash; }, hash); await page.waitForSelector(selector); await checkLayout(page, name + ' desktop'); await page.screenshot({ path: path.join(out, name + '-desktop.png') });
  }
  await page.evaluate(() => { location.hash = '#/calendar'; }); await page.waitForSelector('.cal__grid');
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
  assert.equal(await mobile.$eval('html', n => n.dataset.theme), 'light'); await mobile.screenshot({ path: path.join(out, 'home-light-mobile.png') });
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
  await page.bringToFront();
  console.log('CHECK organizer preview');
  await page.evaluate(() => { location.hash = '#/settings?tab=files'; }); await page.waitForSelector('[data-action="organize-preview"]');
  await page.click('[data-action="organize-preview"]'); await page.waitForSelector('.modal'); record('organizer preview dialog'); await page.click('.modal [data-close]');
  await page.click('#logout-button'); await page.waitForSelector('#access-form'); record('logout returns to access screen');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await checkLayout(page, 'login mobile');
  await page.screenshot({ path: path.join(out, 'login-mobile.png') });
  await page.setViewport({ width: 320, height: 740 }); await checkLayout(page, 'login narrow mobile');
  await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await checkLayout(page, 'login light mobile');
  await page.screenshot({ path: path.join(out, 'login-light-mobile.png') });
  assert.deepEqual(errors, []); record('no browser JavaScript exceptions');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: results.length, fixtures: true, realArtSource: Boolean(process.env.WP_IMAGE_SOURCE), checks: results, errors }, null, 2));
  console.log('Browser acceptance complete:', results.length, 'checks');
} finally {
  await browser?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
  fs.rmSync(dir, { recursive: true, force: true });
}
