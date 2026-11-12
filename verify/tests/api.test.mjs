import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wanspilot-api-'));
const token = 'integration-test-access-token-only';
let child, base, cookie, upstreamBase;
const upstream = http.createServer(async (req, res) => {
  if (req.url.startsWith('/images/')) { res.setHeader('content-type', 'image/png'); res.end(Buffer.from('89504e470d0a1a0a00000000', 'hex')); return; }
  res.setHeader('content-type', 'application/json');
  if(req.url.startsWith('/3/tv/987654')) {await new Promise(r=>setTimeout(r,250));res.end(JSON.stringify({id:987654,name:'Audit Fixture',seasons:[]}));return;}
  if (req.url.startsWith('/bad/')) { res.statusCode = 401; res.end(JSON.stringify({ status_message: 'invalid draft key' })); return; }
  res.end(JSON.stringify({ images: { secure_base_url: 'https://image.example/' } }));
});
async function request(route, options = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(base + route, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
before(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
  const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['content/server/index.mjs'], { cwd: new URL('../..', import.meta.url), env: { ...process.env, WP_PORT: String(port), WP_DATA_DIR: path.join(dir, 'data'), WP_DOWNLOAD_DIR: path.join(dir, 'downloads'), WP_CACHE_DIR: path.join(dir, 'cache'), WP_ACCESS_TOKEN: token, WP_TMDB_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error('Startup failed: ' + logs);
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Startup timed out');
});
after(async () => {
  if (child?.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
  upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); fs.rmSync(dir, { recursive: true, force: true });
});
test('health and login shell are public, settings/image/tasks/logs are protected', async () => {
  assert.equal((await request('/api/health')).status, 200);
  const shell = await request('/'); assert.equal(shell.status, 200); assert.match(await shell.text(), /cinema.css/);
  for (const route of ['/api/settings', '/api/image?path=/x.jpg', '/api/tasks', '/api/subscriptions', '/api/logs', '/api/organizer/preview']) {
    const res = await request(route); assert.equal(res.status, 401); assert.equal((await res.json()).code, 'AUTH_REQUIRED');
  }
});
test('static assets revalidate and missing scripts return 404', async () => {
  const css = await request('/cinema.css'); assert.equal(css.status, 200); assert.equal(css.headers.get('cache-control'), 'no-cache');
  const cached = await request('/cinema.css', { headers: { 'if-none-match': css.headers.get('etag') } }); assert.equal(cached.status, 304);
  assert.equal((await request('/missing-script.js')).status, 404);
});

test('login rejects invalid token and creates HttpOnly session for valid token', async () => {
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { token: 'wrong' } })).status, 401);
  const result = await request('/api/auth/login', { method: 'POST', body: { token } }); assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); cookie = result.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await request('/api/auth/status')).json()).authenticated, true);
});
test('settings roundtrip preserves omitted secrets and returns only configured flags', async () => {
  let res = await request('/api/settings', { method: 'PUT', body: { tmdbApiKey: 'private-test-key', qbPassword: 'private-test-password', tmdbApiBase: upstreamBase + '/3', tmdbImageBase: upstreamBase + '/images' } });
  assert.equal(res.status, 200); const saved = await res.json();
  assert.equal(saved.tmdbApiKeySet, true); assert.equal(saved.qbPasswordSet, true);
  assert.equal(JSON.stringify(saved).includes('private-test'), false);
  res = await request('/api/settings', { method: 'PUT', body: { theme: 'light' } }); assert.equal((await res.json()).qbPasswordSet, true);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data/settings.json'))); assert.equal(disk.qbPassword, 'private-test-password');
});
test('draft TMDB probe tests unsaved values and never persists them', async () => {
  const res = await request('/api/settings/test', { method: 'POST', body: { kind: 'tmdb', tmdbApiBase: upstreamBase + '/bad', tmdbApiKey: 'draft-key', tmdbImageBase: upstreamBase + '/images' } });
  assert.equal(res.status, 200); const result = await res.json(); assert.equal(result.testedDraft, true); assert.equal(result.tmdbOk, false); assert.match(result.tmdbMessage, /invalid draft key/);
  const current = await (await request('/api/settings')).json(); assert.equal(current.tmdbApiBase, upstreamBase + '/3');
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data/settings.json'))); assert.equal(disk.tmdbApiKey, 'private-test-key');
});
test('draft qB probe rejects an empty URL rather than testing old saved URL', async () => {
  const res = await request('/api/settings/test', { method: 'POST', body: { kind: 'qb', qbUrl: '' } });
  assert.equal((await res.json()).ok, false);
});
test('authenticated mutations reject cross-origin requests', async () => {
  const res = await request('/api/settings', { method: 'PUT', headers: { origin: 'https://evil.example' }, body: { theme: 'dark' } });
  assert.equal(res.status, 403);
});
test('preview does not mutate downloads and empty organizer is safe', async () => {
  assert.deepEqual((await (await request('/api/organizer/preview')).json()).reports, []);
  assert.deepEqual((await (await request('/api/organizer/run', { method: 'POST', body: {} })).json()).reports, []);
});
test('explicit secret clearing works without affecting unrelated settings', async () => {
  const cleared = await (await request('/api/settings', { method: 'PUT', body: { qbPassword: '' } })).json();
  assert.equal(cleared.qbPasswordSet, false); assert.equal(cleared.tmdbApiKeySet, true);
});
test('subscription create and async checks expose activity and all mutation audits without secrets', async () => {
  const created=await request('/api/subscriptions',{method:'POST',body:{type:'tv',tmdbId:987654,title:'Audit Fixture'}});
  assert.equal(created.status,201);const {item}=await created.json();
  assert.equal(item.isChecking,true);assert.ok(item.history.some(event=>event.stage==='queued'));
  const check=await request('/api/subscriptions/'+item.id+'/check',{method:'POST'});
  assert.equal(check.status,202);assert.equal((await check.json()).alreadyRunning,true);
  let finished;
  for(let n=0;n<40;n++){finished=(await (await request('/api/subscriptions')).json()).items.find(sub=>sub.id===item.id);if(!finished.isChecking)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(finished.isChecking,false);assert.equal(finished.activity.stage,'error');
  assert.equal((await request('/api/subscriptions/'+item.id,{method:'DELETE'})).status,200);
  const text=await (await request('/api/logs?lines=2000')).text();
  for(const value of ['创建订阅','开始检查订阅','立即检查订阅','取消订阅','保存设置'])assert.ok(text.includes(value),value);
  for(const secret of ['private-test-key','private-test-password','draft-key',token])assert.ok(!text.includes(secret));
});

test('logout clears cookie and bearer access is supported for automation', async () => {
  const res = await request('/api/auth/logout', { method: 'POST', body: {} }); assert.match(res.headers.get('set-cookie'), /Max-Age=0/); cookie = null;
  assert.equal((await request('/api/settings')).status, 401);
  assert.equal((await request('/api/settings', { headers: { authorization: 'Bearer ' + token } })).status, 200);
});
