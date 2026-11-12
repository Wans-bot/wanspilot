import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wp-indexers-'));
process.env.WP_DATA_DIR=dir;process.env.WP_DOWNLOAD_DIR=path.join(dir,'downloads');process.env.WP_CACHE_DIR=path.join(dir,'cache');
fs.mkdirSync(process.env.WP_DOWNLOAD_DIR,{recursive:true});
const settings=await import('../../content/server/settings.mjs');settings.initSettings();
const ix=await import('../../content/server/indexers.mjs');ix.initIndexers(dir);
const engine=await import('../../content/server/engine.mjs');
const sources=await import('../../content/server/sources.mjs');
const hash='a'.repeat(40),info=Buffer.from('d6:lengthi1e4:name4:test12:piece lengthi16384e6:pieces20:abcdefghijklmnopqrste');
// Assemble the announce string with its real byte length.
const announce='http://tracker.test/secret-pass';
const validTorrent=Buffer.concat([Buffer.from('d8:announce'+Buffer.byteLength(announce)+':'+announce+'4:info'),info,Buffer.from('e')]);
const actualHash=crypto.createHash('sha1').update(info).digest('hex');
let lastRequest=null,uploads=[],feedReads=0;
const xml=(link,extra='')=>`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title><![CDATA[Example & Series S01E01 1080p]]></title><enclosure url="${link.replaceAll('&','&amp;')}" type="application/x-bittorrent" length="12345"/>${extra}</item></channel></rss>`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');lastRequest=url;
 if(url.pathname==='/feed'){feedReads++;res.end(xml(base+'/torrent?passkey=feed-secret'));return;}
 if(url.pathname==='/api'){
  if(url.searchParams.get('apikey')!=='test-secret'){res.statusCode=403;res.end('secret');return;}
  res.end(url.searchParams.get('t')==='caps'?'<caps><searching><search available="yes"/></searching></caps>':xml(base+'/torrent?passkey=feed-secret',`<torznab:attr name="seeders" value="8"/><torznab:attr name="infohash" value="${actualHash}"/>`));return;
 }
 if(url.pathname==='/torrent'){res.end(validTorrent);return;}
 if(url.pathname==='/redirect'){res.writeHead(302,{location:'magnet:?xt=urn:btih:'+hash+'&tr=http%3A%2F%2Ftracker%2Fsecret-pass'});res.end();return;}
 if(url.pathname==='/bad'){res.end('<html>access denied</html>');return;}
 if(url.pathname==='/dtd'){res.end('<!DOCTYPE rss [<!ENTITY e "secret">]><rss><channel/></rss>');return;}
 if(url.pathname==='/large'){res.writeHead(200,{'content-length':3*1024**2});res.end('x');return;}
 if(url.pathname==='/error'){res.end('<error code="100" description="test-secret"/>');return;}
 if(url.pathname==='/api/v2/app/version'){res.end('v4.6.7');return;}
 if(url.pathname==='/api/v2/sync/maindata'){res.end('{"server_state":{"free_space_on_disk":999999999999}}');return;}
 if(['/api/v2/torrents/info','/api/v2/torrents/files'].includes(url.pathname)){res.end('[]');return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 if(url.pathname==='/api/v2/torrents/add')uploads.push(Buffer.concat(chunks));res.end('Ok.');
});
await new Promise(r=>server.listen(0,'0.0.0.0',r));const base='http://127.0.0.1:'+server.address().port;
after(async()=>{engine.shutdownEngine();ix.flushIndexers();settings.flushSettings();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
const create=(extra={})=>ix.saveIndexer({name:'家庭索引',type:'torznab',url:base+'/api?apikey=test-secret&t=search&q=old',...extra}).item;
test('channel configuration masks credentials, preserves blanks and persists with 0600 permissions',()=>{
 const item=create();assert.equal(item.apiKeySet,true);assert.equal(item.host,new URL(base).host);assert.doesNotMatch(JSON.stringify(ix.listIndexers()),/test-secret|apikey|\/api\?/);
 let stored=JSON.parse(fs.readFileSync(path.join(dir,'indexers.json'))).items[0];assert.equal(stored.url,base+'/api');assert.equal(stored.apiKey,'test-secret');assert.equal(fs.statSync(path.join(dir,'indexers.json')).mode&0o777,0o600);
 ix.saveIndexer({name:'新名称',url:'',apiKey:''},item.id);stored=JSON.parse(fs.readFileSync(path.join(dir,'indexers.json'))).items[0];assert.equal(stored.url,base+'/api');assert.equal(stored.apiKey,'test-secret');
 ix.saveIndexer({clearApiKey:true},item.id);assert.equal(ix.listIndexers().items[0].apiKeySet,false);ix.deleteIndexer(item.id);
});
test('invalid URLs, missing names and unsupported types are rejected',()=>{
 for(const url of ['file:///tmp/a','javascript:alert(1)','http://user:secret@localhost'])assert.throws(()=>create({url}));
 assert.throws(()=>ix.saveIndexer(null));assert.throws(()=>create({url:'http://localhost/'+ 'a'.repeat(8193)}));
 assert.throws(()=>create({name:''}));assert.throws(()=>create({type:'newznab'}));
});
test('Torznab capabilities, parameter encoding and secret-free search results',async()=>{
 const item=create();assert.equal((await ix.testIndexer(item.id)).ok,true);
 const rows=await ix.configuredSources()[0].run('Example & Series');assert.equal(lastRequest.searchParams.get('q'),'Example & Series');assert.equal(lastRequest.searchParams.get('apikey'),'test-secret');assert.equal(rows[0].title,'Example & Series S01E01 1080p');assert.equal(rows[0].seeders,8);assert.equal(rows[0].infoHash,actualHash);assert.doesNotMatch(JSON.stringify(rows),/feed-secret|passkey|test-secret/);
 assert.deepEqual(Buffer.from((await ix.resolveRelease(rows[0].releaseId)).torrentBase64,'base64'),validTorrent);ix.deleteIndexer(item.id);
});
test('RSS caches its feed, keeps hashless releases and follows magnet redirects privately',async()=>{
 const item=create({type:'rss',url:base+'/feed'});const source=ix.configuredSources()[0],before=feedReads;const rows=await source.run('Example');await source.run('Different');assert.equal(feedReads,before+1);assert.equal(rows[0].infoHash,'');assert.ok(rows[0].releaseId);
 const redirect=ix.parseFeed({rss:{channel:{item:{title:'Redirect',link:base+'/redirect'}}}},JSON.parse(fs.readFileSync(path.join(dir,'indexers.json'))).items[0])[0];const resolved=await ix.resolveRelease(redirect.releaseId);assert.match(resolved.magnet,/secret-pass/);assert.doesNotMatch(JSON.stringify(redirect),/secret-pass/);ix.deleteIndexer(item.id);
});
test('RSS channels support {query} placeholders for search-style feeds',async()=>{
 const item=create({type:'rss',url:base+'/feed?searchstr={query}'});
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'indexers.json'))).items[0].url,base+'/feed?searchstr={query}');
 const rows=await ix.configuredSources()[0].run('流浪地球');
 assert.equal(lastRequest.searchParams.get('searchstr'),'流浪地球');
 assert.ok(rows[0].releaseId);
 ix.deleteIndexer(item.id);
});
test('built-in releases resolve torrents without a saved channel record',async()=>{
 const id=ix.registerRelease({key:'mikan',url:base+'/torrent'});
 assert.deepEqual(Buffer.from((await ix.resolveRelease(id)).torrentBase64,'base64'),validTorrent);
 assert.equal(ix.registerRelease({key:'mikan',url:base+'/torrent'}),id);
 await assert.rejects(ix.resolveRelease('missing-builtin'),e=>e.statusCode===410);
});
test('XML failures and oversized responses are contained without returning upstream secrets',async()=>{
 for(const endpoint of ['bad','dtd','large','error']){const item=create({url:base+'/'+endpoint});const result=await ix.testIndexer(item.id);assert.equal(result.ok,false);assert.doesNotMatch(result.message,/test-secret/);ix.deleteIndexer(item.id);}
});
test('malformed RSS entries are skipped, entities and magnet hashes are recognized',()=>{
 const item=create({type:'rss',url:base+'/feed'}),privateItem=JSON.parse(fs.readFileSync(path.join(dir,'indexers.json'))).items[0];
 const rows=ix.parseFeed({rss:{channel:{item:[null,'',{}, {title:'Example &amp; Series',link:'magnet:?xt=urn:btih:'+hash,'torznab:attr':[null,{'@_name':'seeders','@_value':'4'}]}]}}},privateItem);
 assert.equal(rows.length,1);assert.equal(rows[0].title,'Example & Series');assert.equal(rows[0].infoHash,hash);assert.equal(rows[0].seeders,4);ix.deleteIndexer(item.id);
});
test('stale release references reject configuration changes, disabled sources and deletion',async()=>{
 const item=create(),rows=await ix.configuredSources()[0].run('Example'),ref=rows[0].releaseId;
 ix.saveIndexer({enabled:false},item.id);await assert.rejects(ix.resolveRelease(ref),e=>e.statusCode===409);ix.saveIndexer({enabled:true},item.id);await assert.rejects(ix.resolveRelease(ref),e=>e.statusCode===409);ix.deleteIndexer(item.id);await assert.rejects(ix.resolveRelease(ref),e=>e.statusCode===410);await assert.rejects(ix.resolveRelease('missing'),e=>e.statusCode===410);
});
test('configured channels participate in normalized source queries',async()=>{
 const item=create(),source=sources.activeSources().find(s=>s.id===item.id),rows=await sources.querySource(source,'Example');assert.ok(rows[0].releaseId);assert.equal(rows[0].magnet,'');assert.equal(rows[0].indexerName,item.name);assert.equal(rows[0].resolution,'1080p');ix.deleteIndexer(item.id);
});
test('qB receives original torrent bytes; release identity overrides injected client magnets',async()=>{
 const localIp=Object.values(os.networkInterfaces()).flat().find(ip=>ip.family==='IPv4'&&!ip.internal)?.address;assert.ok(localIp);
 settings.updateSettings({qbUrl:`http://${localIp}:${server.address().port}`,quotaGB:0});engine.initEngine(dir);await new Promise(r=>setTimeout(r,50));
 const item=create(),rows=await ix.configuredSources()[0].run('Example');const task=await engine.addTask({releaseId:rows[0].releaseId,magnet:'magnet:?xt=urn:btih:'+hash});assert.equal(task.id,actualHash);assert.ok(uploads.at(-1).includes(validTorrent));assert.doesNotMatch(JSON.stringify(task),/feed-secret|secret-pass/);
 await assert.rejects(engine.addTask({releaseId:rows[0].releaseId}),e=>e.statusCode===409&&e.taskId===actualHash);ix.deleteIndexer(item.id);
});
test('source limit, explicit key removal and persistence reload',()=>{
 for(let i=0;i<12;i++)create({name:'Source '+i});assert.throws(()=>create(),/12/);ix.initIndexers(dir);assert.equal(ix.listIndexers().items.length,12);for(const item of ix.listIndexers().items)ix.deleteIndexer(item.id);assert.equal(ix.listIndexers().items.length,0);
});

test('channel API enforces authentication and same origin; audits exclude credentials',async()=>{
 const apiDir=fs.mkdtempSync(path.join(os.tmpdir(),'wp-indexer-api-')),reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const apiBase='http://127.0.0.1:'+port,child=spawn(process.execPath,['content/server/index.mjs'],{cwd:new URL('../..',import.meta.url),env:{...process.env,WP_PORT:String(port),WP_DATA_DIR:apiDir,WP_CACHE_DIR:path.join(apiDir,'cache'),WP_DOWNLOAD_DIR:path.join(apiDir,'downloads'),WP_USERNAME:'fixture-admin',WP_PASSWORD:'fixture-password',WP_ACCESS_TOKEN:''},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 try{
  for(let n=0;n<100;n++){try{if((await fetch(apiBase+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal((await fetch(apiBase+'/api/indexers')).status,401);
  const login=await fetch(apiBase+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'fixture-admin',password:'fixture-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie,'content-type':'application/json'};
  const body={name:'Integration',type:'rss',url:base+'/feed?passkey=api-private-secret',apiKey:'api-private-key'};
  assert.equal((await fetch(apiBase+'/api/indexers',{method:'POST',headers:{...headers,origin:'https://unrelated.invalid'},body:JSON.stringify(body)})).status,403);
  const saved=await fetch(apiBase+'/api/indexers',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(saved.status,201);const {item}=await saved.json();assert.doesNotMatch(JSON.stringify(item),/api-private/);
  assert.equal((await fetch(apiBase+'/api/indexers/'+item.id+'/test',{method:'POST',headers})).status,200);
  assert.equal((await fetch(apiBase+'/api/indexers/'+item.id,{method:'PATCH',headers,body:'{"enabled":false}'})).status,200);
  assert.equal((await fetch(apiBase+'/api/indexers/'+item.id,{method:'DELETE',headers})).status,200);
  const logs=await (await fetch(apiBase+'/api/logs',{headers})).text();assert.match(logs,/添加资源渠道/);assert.match(logs,/测试资源渠道/);assert.match(logs,/移除资源渠道/);assert.doesNotMatch(logs+output,/api-private-secret|api-private-key/);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.rmSync(apiDir,{recursive:true,force:true});}
});
