import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wanspilot-test-'));
process.env.WP_DATA_DIR = path.join(root, 'data');
process.env.WP_DOWNLOAD_DIR = path.join(root, 'downloads');
process.env.WP_CACHE_DIR = path.join(root, 'cache');
process.env.WP_QB_POLL_MS = '1000';
fs.mkdirSync(process.env.WP_DOWNLOAD_DIR, { recursive: true });
const settings = await import('../../content/server/settings.mjs');
const { JsonStore } = await import('../../content/server/store.mjs');
const { parseTitle } = await import('../../content/server/sources.mjs');
const auth = await import('../../content/server/auth.mjs');
const subs = await import('../../content/server/subscriptions.mjs');
const organizer = await import('../../content/server/organizer.mjs');
const engine = await import('../../content/server/engine.mjs');
const capacity = await import('../../content/server/capacity.mjs');
settings.initSettings();
const GB = 1024 ** 3;
const hash = 'a'.repeat(40);
const candidate = { title: 'Example.S01E01.1080p', magnet: `magnet:?xt=urn:btih:${hash}`, infoHash: hash, resolution: '1080p', seeders: 100, sizeBytes: 2 * GB, season: 1, episodeList: [1], isSeasonPack: false };
function item(type = 'tv') { return { id: 'test-' + Math.random(), type, tmdbId: 1, title: 'Example', originalTitle: 'Example', year: '2020', seasons: [1], qualityPreference: '1080p', minSeeders: 0, maxSizeGB: 30, downloadedKeys: [], autoDownload: true, enabled: true }; }
function dependencies(extra = {}) {
  return { detail: async () => ({ title: 'Example', originalTitle: 'Example', year: '2020', releaseDate: '2020-01-01', seasons: [{ seasonNumber: 1 }] }),
    season: async () => ({ episodes: [{ episodeNumber: 1, airDate: '2020-01-01' }] }),
    searchResources: async () => ({ items: [candidate] }),
    addTask: async () => ({ id: hash }), getTask: () => ({ id: hash, progress: .3, state: 'downloading' }), ...extra };
}
function initSubs(extra = {}) { return subs.initSubscriptions(process.env.WP_DATA_DIR, dependencies(extra)); }

test('episode ranges do not swallow resolution digits', () => {
  assert.deepEqual(parseTitle('Example.S01E01-E03.1080p').episodeList, [1, 2, 3]);
  assert.deepEqual(parseTitle('Example.S02E04-06.2160p').episodeList, [4, 5, 6]);
  assert.deepEqual(parseTitle('Example.S01E01E03.1080p').episodeList, [1, 3]);
  assert.deepEqual(parseTitle('Example.S01E01.1080p').episodeList, [1]);
  assert.deepEqual(parseTitle('Example.1x02.720p').episodeList, [2]);
  assert.equal(parseTitle('Example.S01.Complete').isSeasonPack, true);
});
test('store write failure throws and remains pending, then recovers', () => {
  const blocker = path.join(root, 'blocker'); fs.writeFileSync(blocker, 'file');
  const store = new JsonStore(path.join(root, 'recoverable.json'), { value: 1 });
  store.filePath = path.join(blocker, 'state.json');
  assert.throws(() => store.flush()); assert.equal(store.pending, true);
  fs.unlinkSync(blocker); store.flush(); assert.equal(store.pending, false);
  assert.equal(JSON.parse(fs.readFileSync(store.filePath)).value, 1);
  assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
});
test('malformed JSON is backed up before defaults are used', () => {
  const file = path.join(root, 'bad.json'); fs.writeFileSync(file, '{bad');
  assert.deepEqual(new JsonStore(file, { items: [] }).data, { items: [] });
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('bad.json.corrupt-')));
});
test('cache cleanup respects size budget and preserves unrelated files', async () => {
  const { pruneImageCache } = await import('../../content/server/image-cache.mjs');
  const dir = path.join(root, 'image-cache'); fs.mkdirSync(dir);
  for (const ch of ['a', 'b']) { const file = path.join(dir, ch.repeat(40) + '.img'); fs.writeFileSync(file, '1234567890'); fs.utimesSync(file, new Date(0), new Date(Date.now() - 120000)); }
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  const result = await pruneImageCache(dir, { maxBytes: 10 }); assert.equal(result.removed, 1); assert.equal(result.bytes, 10); assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'keep');
});

test('public settings never expose stored API key or qB password', () => {
  settings.updateSettings({ tmdbApiKey: 'private-key', qbPassword: 'private-password' });
  const safe = settings.publicSettings();
  assert.equal(safe.tmdbApiKeySet, true); assert.equal(safe.qbPasswordSet, true);
  assert.equal(Object.hasOwn(safe, 'tmdbApiKey'), false); assert.equal(Object.hasOwn(safe, 'qbPassword'), false);
  settings.updateSettings({ theme: 'light' }); assert.equal(settings.getSettings().qbPassword, 'private-password');
  settings.updateSettings({ qbPassword: '' }); assert.equal(settings.publicSettings().qbPasswordSet, false);
});
test('failed settings write returns 507 and restores previous settings', () => {
  const file = path.join(process.env.WP_DATA_DIR, 'settings.json.tmp'); fs.mkdirSync(file);
  const old = settings.getSettings().theme;
  assert.throws(() => settings.updateSettings({ theme: old === 'dark' ? 'light' : 'dark' }), err => err.statusCode === 507);
  assert.equal(settings.getSettings().theme, old); fs.rmdirSync(file); settings.flushSettings();
});
test('access token, signed cookie and cross-origin protection', () => {
  auth.initAuth(process.env.WP_DATA_DIR);
  const token = fs.readFileSync(path.join(process.env.WP_DATA_DIR, 'access-token'), 'utf8').trim();
  const req = { headers: { host: 'localhost:3000' }, socket: { remoteAddress: 'unit' } };
  assert.equal(auth.authenticated(req), false);
  assert.equal(auth.login(req, 'wrong').status, 401);
  const result = auth.login(req, token); assert.equal(result.status, 200); assert.match(result.cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(auth.authenticated({ ...req, headers: { cookie: result.cookie.split(';')[0] } }), true);
  assert.equal(auth.authenticated({ ...req, headers: { cookie: result.cookie.split(';')[0] + 'x' } }), false);
  assert.equal(auth.sameOrigin({ headers: { host: 'nas:3000', origin: 'https://evil.test' } }), false);
  assert.equal(auth.sameOrigin({ headers: { host: 'nas:3000', origin: 'http://nas:3000' } }), true);
  assert.equal(fs.statSync(path.join(process.env.WP_DATA_DIR, 'access-token')).mode & 0o777, 0o600);
});
test('failed access attempts are rate-limited', () => {
  const req = { headers: {}, socket: { remoteAddress: 'rate-limit-test' } };
  for (let n = 0; n < 10; n++) assert.equal(auth.login(req, 'bad').status, 401);
  assert.equal(auth.login(req, 'bad').status, 429);
});
test('quota rejects a new task when quota is already exhausted', () => {
  settings.updateSettings({ quotaGB: 1 }); assert.equal(capacity.capacityCheck(0, GB, 0).ok, false); settings.updateSettings({ quotaGB: 0 });
});
test('TV quota rejection does not mark episodes downloaded or submitted', async () => {
  settings.updateSettings({ quotaGB: 1 }); initSubs(); const sub = item();
  await subs.runCheck(sub); assert.deepEqual(sub.downloadedKeys, []); assert.deepEqual(sub.pendingTasks || {}, {});
  assert.match(sub.lastMessage, /配额/); settings.updateSettings({ quotaGB: 0 });
});
test('TV season-pack rejection also leaves episode tracking untouched', async () => {
  settings.updateSettings({ quotaGB: 1 }); initSubs({ season: async () => ({ episodes: [1, 2, 3, 4].map(episodeNumber => ({ episodeNumber, airDate: '2020-01-01' })) }), searchResources: async () => ({ items: [{ ...candidate, title: 'Example.S01.Complete.1080p', isSeasonPack: true }] }) });
  const sub = item(); await subs.runCheck(sub); assert.deepEqual(sub.downloadedKeys, []); assert.deepEqual(sub.pendingTasks || {}, {}); settings.updateSettings({ quotaGB: 0 });
});
test('qB submission rejection does not mark a movie downloaded', async () => {
  initSubs({ addTask: async () => { throw new Error('qB rejected'); } });
  const sub = item('movie'); await subs.runCheck(sub); assert.deepEqual(sub.downloadedKeys, []); assert.equal(sub.state, 'error'); assert.match(sub.lastMessage, /qB rejected/);
});
test('submitted, completed and failed downloads have separate tracking', async () => {
  let state = { id: hash, progress: .4, state: 'downloading' }; let calls = 0;
  initSubs({ addTask: async () => { calls++; return { id: hash }; }, getTask: () => state });
  const sub = item('movie'); await subs.runCheck(sub);
  assert.equal(sub.pendingTasks.movie, hash); assert.deepEqual(sub.downloadedKeys, []);
  await subs.runCheck(sub); assert.equal(calls, 1);
  state = { id: hash, progress: 1, state: 'seeding' }; await subs.runCheck(sub);
  assert.deepEqual(sub.downloadedKeys, ['movie']); assert.equal(sub.pendingTasks.movie, undefined);
  const retry = item('movie'); await subs.runCheck(retry); state = { id: hash, progress: 0, state: 'error' };
  await subs.runCheck(retry); assert.equal(calls, 3); assert.deepEqual(retry.downloadedKeys, []);
});
test('movie upgrade search runs after a fallback download', async () => {
  let searches = 0; initSubs({ searchResources: async () => { searches++; return { items: [candidate] }; } });
  const sub = item('movie'); sub.downloadedKeys = ['movie']; sub.upgrade = { pending: true };
  await subs.runCheck(sub); assert.ok(searches > 0); assert.equal(sub.upgrade.available, true);
});
test('concurrent subscription checks share the same work', async () => {
  let calls = 0; initSubs({ detail: async () => { calls++; await new Promise(r => setTimeout(r, 30)); return { title: 'Example', releaseDate: '2020-01-01', year: '2020' }; } });
  const sub = item('movie'); await Promise.all([subs.runCheck(sub), subs.runCheck(sub)]); assert.equal(calls, 1);
});
test('organizer preview is read-only and hardlinks preserve original file and inode', async () => {
  initSubs(); settings.updateSettings({ autoOrganize: false, deleteSamples: true, writeNfo: false });
  const dir = process.env.WP_DOWNLOAD_DIR; fs.mkdirSync(path.join(dir, 'original'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'original', 'Example.2020.mkv'), 'movie-content');
  fs.writeFileSync(path.join(dir, 'original', 'sample.mkv'), 'sample');
  const task = { id: hash, name: 'Example.2020.1080p', progress: 1, files: [{ path: 'original/Example.2020.mkv', sizeBytes: 13 }, { path: 'original/sample.mkv', sizeBytes: 6 }] };
  const preview = await organizer.organizeTask(task, { force: true, dryRun: true });
  assert.equal(preview.planned.length, 1); assert.equal(fs.existsSync(path.join(dir, 'Example (2020)')), false);
  const result = await organizer.organizeTask(task, { force: true }); assert.equal(result.linked, 1);
  const source = path.join(dir, 'original/Example.2020.mkv'), target = path.join(dir, 'Example (2020)/Example.2020.mkv');
  assert.equal(fs.existsSync(source), true); assert.equal(fs.statSync(source).ino, fs.statSync(target).ino);
  assert.equal(fs.existsSync(path.join(dir, 'original/sample.mkv')), true);
  const repeat = await organizer.organizeTask(task, { force: true }); assert.equal(repeat.existing, 1); assert.equal(repeat.moved, 0);
});
test('organizer rejects symlinks escaping the mounted download root', async () => {
  const outside = path.join(root, 'outside.mkv'); fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(process.env.WP_DOWNLOAD_DIR, 'escape.mkv'));
  const result = await organizer.organizeTask({ id: 'outside', name: 'Outside.2020', progress: 1, files: [{ path: 'escape.mkv' }] }, { force: true });
  assert.equal(result.errors.length, 1); assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});
test('organizer retries tasks whose file lists were not loaded yet', async () => {
  initSubs(); settings.updateSettings({ autoOrganize: true }); organizer.initOrganizer();
  // The direct operation must report a skip, rather than falsely claiming success.
  const result = await organizer.organizeTask({ id: 'no-files', progress: 1, name: 'Example' });
  assert.equal(result.skipped, '没有文件'); assert.equal(organizer.organizerStatus().processed, 0);
  settings.updateSettings({ autoOrganize: false });
});

const fake = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/v2/sync/maindata')) { res.end(JSON.stringify({ server_state: { free_space_on_disk: 100 * GB } })); return; }
  if (req.url.startsWith('/api/v2/torrents/info') || req.url.startsWith('/api/v2/torrents/files')) { res.end('[]'); return; }
  for await (const chunk of req) {} // consume multipart body
  if (req.url === '/api/v2/torrents/add') { res.statusCode = rejectQb ? 500 : 200; res.end(rejectQb ? 'rejected' : 'Ok.'); return; }
  res.end('Ok.');
});
let rejectQb = true;
await new Promise(resolve => fake.listen(0, '0.0.0.0', resolve));
const localIp = Object.values(os.networkInterfaces()).flat().find(ip => ip.family === 'IPv4' && !ip.internal)?.address;
test('download API waits for qB acceptance, keeps error visible and permits retry', async () => {
  assert.ok(localIp); settings.updateSettings({ qbUrl: `http://${localIp}:${fake.address().port}`, quotaGB: 0 }); engine.initEngine(process.env.WP_DATA_DIR);
  await new Promise(r => setTimeout(r, 40));
  await assert.rejects(engine.addTask({ infoHash: 'b'.repeat(40) }), /rejected/);
  assert.equal(engine.getTask('b'.repeat(40)).state, 'error');
  rejectQb = false; const task = await engine.addTask({ infoHash: 'b'.repeat(40), sizeBytes: GB }); assert.equal(task.id, 'b'.repeat(40));
  await assert.rejects(engine.addTask({ infoHash: 'b'.repeat(40) }), err => err.statusCode === 409);
});

after(async () => { engine.shutdownEngine(); subs.shutdownSubscriptions(); settings.flushSettings(); fake.closeAllConnections(); await new Promise(r => fake.close(r)); await new Promise(r => setTimeout(r, 550)); fs.rmSync(root, { recursive: true, force: true }); });

test('account login rejects wrong credentials, invalidates old sessions and preserves password spaces', () => {
  const req = { headers: {}, socket: { remoteAddress: 'account-test' } };
  const previous = { username: process.env.WP_USERNAME, password: process.env.WP_PASSWORD, token: process.env.WP_ACCESS_TOKEN };
  try {
    process.env.WP_USERNAME = 'admin'; process.env.WP_PASSWORD = ' long-password-123 '; delete process.env.WP_ACCESS_TOKEN;
    auth.initAuth(process.env.WP_DATA_DIR);
    assert.equal(auth.authMode(), 'password');
    assert.equal(auth.login(req, { username: 'wrong', password: process.env.WP_PASSWORD }).status, 401);
    assert.equal(auth.login(req, { username: 'admin', password: process.env.WP_PASSWORD.trim() }).status, 401);
    assert.equal(auth.login(req, { token: 'legacy-token' }).status, 401);
    const result = auth.login(req, { username: 'admin', password: process.env.WP_PASSWORD });
    assert.equal(result.status, 200);
    const session = { ...req, headers: { cookie: result.cookie.split(';')[0] } };
    assert.equal(auth.authenticated(session), true);
    assert.equal(auth.authenticated({ ...req, headers: { authorization: 'Bearer ' } }), false);
    process.env.WP_PASSWORD = 'replacement-password'; auth.initAuth(process.env.WP_DATA_DIR);
    assert.equal(auth.authenticated(session), false);
    process.env.WP_PASSWORD = 'short'; assert.throws(() => auth.initAuth(process.env.WP_DATA_DIR), /WP_PASSWORD/);
    delete process.env.WP_PASSWORD; assert.throws(() => auth.initAuth(process.env.WP_DATA_DIR), /WP_USERNAME/);
  } finally {
    for (const [name, value] of Object.entries({ WP_USERNAME: previous.username, WP_PASSWORD: previous.password, WP_ACCESS_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    auth.initAuth(process.env.WP_DATA_DIR);
  }
});
