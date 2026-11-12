import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { initLog, log, tail, redact } from '../../content/server/log.mjs';
import { operationFor,auditOperation } from '../../content/server/audit.mjs';

test('log history survives restart and secrets and newline injection are redacted',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wp-log-'));
  try {
    initLog(dir);log.info('[operation] 创建订阅 完成');
    log.warn('URL https://admin:secret-value@host/path?api_key=secret-key&token=secret-token');
    log.info({password:'private password',qbPassword:'qb-secret',tmdbApiKey:'tmdb-secret'});
    initLog(dir);const text=tail(1000);
    assert.match(text,/创建订阅 完成/);
    for(const value of ['secret-value','secret-key','secret-token','private password','qb-secret','tmdb-secret'])assert.ok(!text.includes(value),value);
    assert.ok(!redact('hello\nforged-entry').includes('\n'));
    assert.equal(fs.statSync(path.join(dir,'logs/wanspilot.log')).mode&0o777,0o600);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('business operation audit covers all mutations and manual searches without polling or request payloads',()=>{
  for(const [method,url] of [['POST','/api/subscriptions'],['PATCH','/api/subscriptions/id'],['DELETE','/api/subscriptions/id'],['POST','/api/subscriptions/id/check'],['POST','/api/tasks'],['DELETE','/api/tasks/id'],['POST','/api/tasks/id/pause'],['POST','/api/tasks/id/resume'],['PUT','/api/settings'],['POST','/api/settings/test'],['GET','/api/resources'],['POST','/api/auth/login'],['POST','/api/auth/logout']])assert.ok(operationFor(method,url),method+' '+url);
  for(const url of ['/api/subscriptions','/api/tasks','/api/tasks/events','/api/logs','/api/image'])assert.equal(operationFor('GET',url),null);
  const req={method:'POST',body:{password:'never-log-this'}};const res=new EventEmitter();res.statusCode=401;res.writableFinished=true;
  auditOperation(req,res,new URL('http://localhost/api/auth/login?token=never-log-this'));res.emit('finish');
  assert.match(tail(),/登录 失败/);assert.ok(!tail().includes('never-log-this'));
});

test('logs show Shanghai wall time without timezone suffix and normalize historical offset lines',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wp-log-time-'));
 try{fs.mkdirSync(path.join(dir,'logs'));fs.writeFileSync(path.join(dir,'logs/wanspilot.log'),'2026-11-12T19:05:44+08:00 [INFO] historical\n');
 initLog(dir);log.info('new-format');
 const text=tail();assert.match(text,/2026-11-12 19:05:44 \[INFO\] historical/);assert.ok(!text.includes('+08:00'));
 assert.match(text,/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO\] new-format/);
 assert.ok(fs.readFileSync(path.join(dir,'logs/wanspilot.log'),'utf8').includes('2026-11-12T19:05:44+08:00'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
