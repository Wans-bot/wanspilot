import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeRules,matchesRules,episodeInScope,selectedIds} from '../../content/server/subscription-rules.mjs';
import {shanghaiDate,shanghaiDateTime,shanghaiTimestamp} from '../../content/web/time.js';
import {filterTasks,filterSubscriptions} from '../../content/web/automation-model.js';
import {initNotifications,notify,listNotifications,readNotifications,flushNotifications} from '../../content/server/notifications.mjs';
test('Shanghai date rolls over at UTC 16:00 independent of host zone',()=>{
 assert.equal(shanghaiDate('2026-12-31T15:59:59Z'),'2026-12-31');
 assert.equal(shanghaiDateTime('2026-12-31T16:00:00Z'),'2027-01-01 00:00');
 assert.equal(shanghaiTimestamp('2026-11-12T00:12:34Z'),'2026-11-12T08:12:34+08:00');
 assert.equal(shanghaiDate('invalid'),'');
});
test('rules validate ranges, sizes, intervals and literal keyword limits',()=>{
 assert.deepEqual(normalizeRules({includeKeywords:' WEB，中文\nWEB'}).includeKeywords,['WEB','中文']);
 for(const input of [{codec:'bad'},{startEpisode:0},{startEpisode:4,endEpisode:3},{minSizeGB:-1},{checkIntervalMinutes:4},{includeKeywords:Array(21).fill('x')}])assert.throws(()=>normalizeRules(input),e=>e.statusCode===400);
 assert.equal(normalizeRules({checkIntervalMinutes:0}).checkIntervalMinutes,0);
 assert.deepEqual(selectedIds(['a','a']),['a']);assert.throws(()=>selectedIds(Array(51).fill('x')));
});
test('resource rules enforce all literal keywords, exclusions, codec, size and strict quality',()=>{
 const rules={...normalizeRules({includeKeywords:['中文','WEB'],excludeKeywords:'CAM',codec:'h265',minSizeGB:1,strictQuality:true}),qualityPreference:'1080p'};
 const good={title:'中文.WEB.H265',codec:'HEVC',sizeBytes:2*1024**3,resolution:'1080p'};
 assert.equal(matchesRules(good,rules),true);
 for(const patch of [{title:'WEB.H265'},{title:'中文.WEB.CAM.H265'},{codec:'h264',title:'中文.WEB.H264'},{sizeBytes:100},{resolution:'720p'}])assert.equal(matchesRules({...good,...patch},rules),false);
 assert.equal(matchesRules(good,{includeKeywords:['.*']}),false);
});
test('episode boundaries and seasons are respected',()=>{
 const sub={seasons:[1],startEpisode:3,endEpisode:5};
 assert.equal(episodeInScope(sub,1,3),true);assert.equal(episodeInScope(sub,1,2),false);assert.equal(episodeInScope(sub,1,6),false);assert.equal(episodeInScope(sub,2,3),false);
});
test('task and subscription filters combine text, state and stable sorts',()=>{
 const items=[{id:'a',name:'Alpha',state:'paused',progress:.2},{id:'b',name:'Beta',state:'seeding',progress:1}];
 assert.equal(filterTasks(items,{status:'completed'})[0].id,'b');assert.equal(filterTasks(items,{q:'AL',status:'paused'})[0].id,'a');
 assert.deepEqual(filterSubscriptions([{id:'a',title:'Alpha',enabled:false},{id:'b',title:'Beta',enabled:true}],{status:'paused',q:'AL'}).map(i=>i.id),['a']);
});
test('notifications deduplicate, persist reads, and bound history to 300',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wp-notify-'));
 try{initNotifications(dir);const event={kind:'error',title:'异常',message:'连接失败',subscriptionId:'a'};
 notify(event);notify(event);assert.equal(listNotifications().unread,1);
 const id=listNotifications().items[0].id;readNotifications([id]);flushNotifications();initNotifications(dir);assert.equal(listNotifications().unread,0);
 for(let i=0;i<305;i++)notify({...event,message:'事件 '+i});
 assert.equal(listNotifications().items.length,300);readNotifications(null);assert.equal(listNotifications().unread,0);flushNotifications();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('resources without seeder counts ignore the minimum seeder rule',async()=>{
 const {pickBest}=await import('../../content/server/subscriptions.mjs');
 const sub={minSeeders:5,maxSizeGB:30,qualityPreference:'1080p'};
 const base={title:'进击的巨人 第01集 1080p',resolution:'1080p',sizeBytes:4*1024**3,seeders:0,magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40)};
 assert.ok(pickBest([{...base,seedersUnknown:true}],sub,'tv',['进击的巨人']));
 assert.equal(pickBest([base],sub,'tv',['进击的巨人']),null);
});
test('unrelated high-seeder resources cannot bypass query relevance',async()=>{
 const {matchesQueryTitle}=await import('../../content/server/sources.mjs');
 assert.equal(matchesQueryTitle('Its.Always.Sunny.in.Philadelphia.S01','无上神帝'),false);
 assert.equal(matchesQueryTitle('无上神帝.第001集.1080p','无上神帝'),true);
 assert.equal(matchesQueryTitle('ＥＸＡＭＰＬＥ.S01E01','Example'),true);
});
