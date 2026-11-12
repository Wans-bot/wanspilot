/** HTTP contract fixtures for the official qBittorrent old and new Web APIs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { QBClient } from '../../content/server/qbittorrent.mjs';
const hash = 'a'.repeat(40), otherHash = 'b'.repeat(40);
const ip = Object.values(os.networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;

async function fixture(config, run) {
  const calls = []; let session = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://' + req.headers.host);
    const pathname = url.pathname.replace(/^\/qb/, '');
    calls.push({ path: pathname, body, headers: req.headers, method: req.method, search: url.searchParams.toString() });
    const respond = (status, value) => { res.statusCode = status; res.end(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')); };
    const legacy = config.legacy;
    if (!req.url.startsWith('/qb/')) return respond(404, 'Wrong base path');
    if (legacy && pathname.startsWith('/api/v2/')) return respond(404, 'Not Found');
    if (pathname === (legacy ? '/login' : '/api/v2/auth/login')) {
      if (config.badLogin) return respond(200, 'Fails.');
      assert.equal(req.headers.origin, 'http://' + req.headers.host);
      assert.equal(req.headers.referer, 'http://' + req.headers.host + '/qb/');
      const form = new URLSearchParams(body); assert.equal(form.get('username'), 'admin'); assert.equal(form.get('password'), 'test-only-password');
      session++; await new Promise(resolve => setTimeout(resolve, 10));
      res.setHeader('Set-Cookie', [`other=value; Path=/`, `${config.cookie || 'SID'}=session-${session}; Path=/; HttpOnly`]);
      return respond(config.loginStatus || 200, config.loginStatus === 204 ? '' : 'Ok.');
    }
    if (config.auth !== false && req.headers.cookie !== `${config.cookie || 'SID'}=session-${session}`) return respond(config.authStatus || 403, 'Forbidden');
    if (config.forceError?.[pathname]) return respond(config.forceError[pathname], 'forced error');
    if (pathname === (legacy ? '/version/qbittorrent' : '/api/v2/app/version')) return respond(200, config.version);
    if (pathname === '/version/api') return respond(200, config.legacyApi || 17);
    if (pathname === '/api/v2/app/webapiVersion') return respond(200, '2.11.2');
    if (['/sync/maindata','/api/v2/sync/maindata'].includes(pathname)) {
      if (config.noStats) return respond(404, 'Not Found');
      return respond(200, {server_state: config.free === undefined ? {} : {free_space_on_disk: config.free}});
    }
    if (['/query/torrents','/api/v2/torrents/info'].includes(pathname)) return respond(200, [{hash, name:'Example', size:1000, progress:.25, state:config.version.startsWith('v5') ? 'stoppedDL' : 'pausedDL'}]);
    if (pathname.startsWith('/query/propertiesFiles/') || pathname === '/api/v2/torrents/files') return respond(200,[{name:'Example.mkv',size:1000,progress:.25}]);
    const toggle = pathname.split('/').pop();
    if (['stop','start','pause','resume'].includes(toggle) && !legacy) {
      const supported = config.toggle || (config.version.startsWith('v5') ? ['stop','start'] : ['pause','resume']);
      if (!supported.includes(toggle)) return respond(404,'Not Found');
    }
    return respond(200, config.addFails && ['add','download','upload'].includes(toggle) ? 'Fails.' : 'Ok.');
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const client = new QBClient({url:`http://${ip}:${server.address().port}/qb`, username:config.auth === false ? '' : 'admin', password:'test-only-password'});
  try { await run({client,calls,expire:()=>{session++;}}); }
  finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
}
for (const version of ['v4.1.9','v4.3.9','v4.6.7','v5.0.3','v5.1.2']) {
  test(`${version}: login, list/files, add, pause/resume, delete and free-space probe`, async () => {
    await fixture({version, cookie:version==='v5.1.2'?'QBT_SID_8585':'SID', loginStatus:version==='v5.1.2'?204:200, free:0}, async ({client,calls}) => {
      const probe = await client.probe(); assert.equal(probe.version,version); assert.equal(probe.apiMode,'v2'); assert.equal(probe.freeBytes,0); assert.equal(probe.apiVersion,'2.11.2');
      assert.equal((await client.torrentsInfo([hash]))[0].downloaded,250);
      assert.equal((await client.torrentsFiles(hash))[0].name,'Example.mkv');
      await client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash,savePath:'/video',paused:true});
      const add = calls.find(call=>call.path.endsWith('/add')); assert.match(add.body,/name="paused"\r\n\r\ntrue/); assert.match(add.body,/name="stopped"\r\n\r\ntrue/);
      await client.pause([hash,otherHash]); await client.resume(hash); await client.deleteTorrents(hash,false);
      assert.ok(calls.some(call=>call.path.endsWith(version.startsWith('v5')?'/stop':'/pause')));
      assert.ok(calls.some(call=>call.path.endsWith(version.startsWith('v5')?'/start':'/resume')));
      assert.match(calls.find(call=>call.path.endsWith('/delete')).body,/deleteFiles=false/);
    });
  });
}
for (const version of ['v4.0.4','v3.3.16']) {
  test(`${version}: legacy API detection and all core commands`, async () => {
    await fixture({version,legacy:true,noStats:true},async ({client,calls})=>{
      const probe=await client.probe();assert.equal(probe.apiMode,'legacy');assert.equal(probe.freeBytes,null);assert.equal(probe.warnings.length,1);
      assert.equal((await client.torrentsInfo([hash]))[0].downloaded,250);await client.torrentsFiles(hash);
      await client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash,savePath:'/video'});
      await client.addTorrent({torrent:Buffer.from('fixture-torrent'),savePath:'/video'});
      await client.pause([hash,otherHash]);await client.resume(hash);await client.deleteTorrents(hash,false);await client.deleteTorrents(hash,true);
      assert.ok(calls.some(call=>call.path==='/command/download'));assert.ok(calls.some(call=>call.path==='/command/upload'));
      assert.equal(calls.filter(call=>call.path==='/command/pause').length,2);
      assert.equal(new URLSearchParams(calls.find(call=>call.path==='/command/pause').body).get('hash'),hash);
      assert.ok(calls.some(call=>call.path==='/command/deletePerm'));assert.ok(calls.some(call=>call.path==='/query/propertiesFiles/'+hash));
    });
  });
}
test('old 3.2 API uses form-encoded magnets and rejects unsupported placement before submitting',async()=>{
  await fixture({version:'v3.2.0',legacy:true,legacyApi:2,auth:false},async({client,calls})=>{
    await client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash});
    assert.match(calls.find(call=>call.path==='/command/download').headers['content-type'],/application\/x-www-form-urlencoded/);
    await assert.rejects(client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash,savePath:'/video'}),error=>error.kind==='unsupported');
    assert.equal(calls.filter(call=>call.path==='/command/download').length,1);
  });
});
for (const api of [6,7,12]) {
  test(`legacy API${api} respects magnet encoding and paused capability boundaries`,async()=>{
    await fixture({version:'v3.3.0',legacy:true,legacyApi:api,auth:false},async({client,calls})=>{
      await client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash});
      const call=calls.find(call=>call.path==='/command/download');
      assert.match(call.headers['content-type'],api<7?/application\/x-www-form-urlencoded/:/multipart\/form-data/);
      await assert.rejects(client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash,paused:true}),error=>error.kind==='unsupported');
      await assert.rejects(client.addTorrent({torrent:Buffer.from('fixture'),paused:true}),error=>error.kind==='unsupported');
      assert.equal(calls.filter(call=>call.path.startsWith('/command/')).length,1);
    });
  });
}
test('anonymous mode works, absent space remains unknown and zero remains full',async()=>{
  await fixture({version:'v4.6.7',auth:false},async({client,calls})=>{
    assert.equal(await client.freeSpace(),null);assert.equal((await client.probe()).freeBytes,null);
    assert.equal(calls.filter(call=>call.path.includes('login')).length,0);
  });
});
test('expired cookies reauthenticate on 401 and concurrent probes share discovery/login',async()=>{
  await fixture({version:'v5.1.2',cookie:'QBT_SID_8585',loginStatus:204,authStatus:401},async({client,calls,expire})=>{
    await Promise.all([client.appVersion(),client.appVersion(),client.torrentsInfo([hash])]);
    assert.equal(calls.filter(call=>call.path.endsWith('/auth/login')).length,1);
    expire();await client.torrentsInfo([hash]);assert.equal(calls.filter(call=>call.path.endsWith('/auth/login')).length,2);
  });
});
test('endpoint fallback is cached and only uses missing endpoint errors',async()=>{
  await fixture({version:'v5.1.2',toggle:['pause','resume'],auth:false},async({client,calls})=>{
    await client.pause(hash);await client.pause(hash);
    assert.equal(calls.filter(call=>call.path.endsWith('/stop')).length,1);assert.equal(calls.filter(call=>call.path.endsWith('/pause')).length,2);
  });
  for (const status of [400,403,500]) await fixture({version:'v5.1.2',auth:false,forceError:{'/api/v2/torrents/stop':status}},async({client,calls})=>{
    await assert.rejects(client.pause(hash));assert.equal(calls.filter(call=>call.path.endsWith('/pause')).length,0);
  });
});
test('invalid credentials do not fall back to old login or replay task writes',async()=>{
  await fixture({version:'v4.6.7',badLogin:true},async({client,calls})=>{
    await assert.rejects(client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash}),error=>error.kind==='auth');
    assert.equal(calls.filter(call=>call.path==='/login'||call.path.endsWith('/add')).length,0);
  });
});
test('rejected torrent submission is never retried via alternate API',async()=>{
  await fixture({version:'v4.6.7',auth:false,addFails:true},async({client,calls})=>{
    await assert.rejects(client.addTorrent({magnet:'magnet:?xt=urn:btih:'+hash}),error=>error.kind==='input');
    assert.equal(calls.filter(call=>call.path.endsWith('/add')).length,1);assert.equal(calls.filter(call=>call.path==='/command/download').length,0);
  });
});
