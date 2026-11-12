/** User-configured Torznab/RSS sources. Credentials and download URLs stay server-side. */
import path from 'node:path';
import crypto from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {JsonStore} from './store.mjs';
import {httpFetch} from './tmdb.mjs';
import {getSettings} from './settings.mjs';
const MAX_INDEXERS=12,MAX_XML=2*1024**2,MAX_TORRENT=8*1024**2;
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,processEntities:false,trimValues:true});
let store=null;
const releases=new Map(),rssCache=new Map();
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const str=value=>String(value?.['#text'] ?? value ?? '');
function decode(value){return str(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(whole,key)=>{const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(key[0]!=='#')return named[key.toLowerCase()] || whole;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):whole;});}
function validUrl(value,base){let url;try{url=new URL(value,base);}catch{throw fail('地址格式不正确');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('地址只支持 HTTP/HTTPS，账号请通过索引服务配置');return url;}
function normalize(input,previous={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('渠道配置格式不正确');
 const type=String(input.type ?? previous.type ?? 'torznab');if(!['torznab','rss'].includes(type))throw fail('仅支持 Torznab 或 RSS');
 const name=String(input.name ?? previous.name ?? '').trim();if(!name||name.length>60)throw fail('名称需为 1–60 个字符');
 const rawUrl=String(input.url || previous.url || '').trim();if(rawUrl.length>8192)throw fail('地址过长');
 const templated=rawUrl.includes('{query}');const url=validUrl(templated?rawUrl.replaceAll('{query}','wp-query-token'):rawUrl);url.hash='';
 let apiKey=input.clearApiKey?'':String(input.apiKey || previous.apiKey || '').trim();
 if(type==='torznab'){
  if(!input.clearApiKey&&url.searchParams.has('apikey'))apiKey=url.searchParams.get('apikey');
  for(const key of ['apikey','t','q','offset','limit'])url.searchParams.delete(key);
 }
 if(apiKey.length>512)throw fail('API Key 过长');
 return {id:previous.id || 'custom_'+crypto.randomUUID(),name,type,url:templated?url.href.replaceAll('wp-query-token','{query}'):url.href,apiKey,enabled:input.enabled===undefined?previous.enabled!==false:input.enabled===true,revision:crypto.randomUUID(),createdAt:previous.createdAt || new Date().toISOString(),lastTest:previous.lastTest || null};
}
function publicItem(item){return {id:item.id,name:item.name,type:item.type,host:new URL(item.url).host,enabled:item.enabled,apiKeySet:Boolean(item.apiKey),urlSet:true,lastTest:item.lastTest};}
export function initIndexers(dir){store=new JsonStore(path.join(dir,'indexers.json'),{items:[]});releases.clear();rssCache.clear();return listIndexers();}
export function listIndexers(){return {items:(store?.data.items || []).map(publicItem),limit:MAX_INDEXERS};}
export function saveIndexer(input,id){
 if(!store)throw fail('资源渠道尚未初始化',503);
 const previous=id?store.data.items.find(item=>item.id===id):undefined;
 if(id&&!previous)throw fail('资源渠道不存在',404);
 if(!id&&store.data.items.length>=MAX_INDEXERS)throw fail('最多配置 '+MAX_INDEXERS+' 个渠道');
 const item=normalize(input,previous);item.lastTest=null;
 const old=store.data.items;store.data.items=previous?old.map(value=>value.id===id?item:value):[...old,item];
 try{store.flush();}catch{store.data.items=old;throw fail('渠道配置未保存，请检查数据目录',507);}
 return {item:publicItem(item)};
}
export function deleteIndexer(id){if(!store)return false;const old=store.data.items,found=old.some(item=>item.id===id);if(!found)return false;store.data.items=old.filter(item=>item.id!==id);try{store.flush();}catch{store.data.items=old;throw fail('删除未保存，请检查数据目录',507);}rssCache.delete(id);for(const [key,item]of releases)if(item.indexerId===id)releases.delete(key);return true;}
export function flushIndexers(){if(store?.pending)store.flush();}
async function readBounded(response,limit){
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw fail('响应过大，已停止读取',502);}
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);let total=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw fail('响应过大，已停止读取',502);chunks.push(Buffer.from(value));}}catch(error){await reader.cancel().catch(()=>{});throw error.statusCode?error:fail('读取响应失败或超时，请重试',502);}
 return Buffer.concat(chunks,total);
}
function parseXml(xml){if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw fail('不支持包含 DTD 或实体声明的 XML',502);if(XMLValidator.validate(xml)!==true)throw fail('返回内容不是有效的 RSS/Torznab XML',502);let data;try{data=parser.parse(xml);}catch{throw fail('XML 解析失败',502);}if(data.error)throw fail('索引服务返回错误（代码 '+String(data.error['@_code'] || '未知').replace(/[^\d]/g,'').slice(0,8)+'），请检查 API Key 和访问权限',502);return data;}
async function fetchXml(item,query,caps=false){
 const templated=item.url.includes('{query}');const url=validUrl(templated?item.url.replaceAll('{query}','wp-query-token'):item.url);if(item.type==='torznab'){url.searchParams.set('t',caps?'caps':'search');if(!caps){url.searchParams.set('q',query || '');url.searchParams.set('limit','100');}if(item.apiKey)url.searchParams.set('apikey',item.apiKey);}
 const target=templated&&!caps?url.href.replaceAll('wp-query-token',encodeURIComponent(query||'')):url.href;
 let response;try{response=await httpFetch(target,{timeoutMs:9000,attempts:1,headers:{accept:'application/rss+xml, application/xml, text/xml'},settings:{...getSettings(),proxy:''}});}catch{throw fail('无法连接或请求超时，请检查 NAS 地址和端口',502);}
 if(!response.ok){await response.body?.cancel();throw fail('索引源 HTTP '+response.status+(response.status===401||response.status===403?'，请检查 API Key 或权限':''),502);}
 const xml=(await readBounded(response,MAX_XML)).toString('utf8');return parseXml(xml);
}
export function registerRelease({key,url,infoHash=''}){
 const hash=crypto.createHash('sha256').update('builtin\0'+key+'\0'+url).digest('hex');
 const previous=releases.get(hash);if(previous&&previous.until>Date.now())return previous.id;
 if(releases.size>=2000)releases.delete(releases.keys().next().value);
 const entry={id:crypto.randomUUID(),indexerId:'builtin',revision:key,url,infoHash:String(infoHash||'').toLowerCase(),builtin:true,until:Date.now()+30*60000};
 releases.set(hash,entry);return entry.id;
}
function releaseFor(item,url,infoHash){
 const hash=crypto.createHash('sha256').update(item.id+'\0'+item.revision+'\0'+url).digest('hex');
 const previous=releases.get(hash);if(previous&&previous.until>Date.now())return {releaseId:previous.id,releaseKey:hash};
 if(releases.size>=2000)releases.delete(releases.keys().next().value);
 const entry={id:crypto.randomUUID(),indexerId:item.id,revision:item.revision,url,infoHash,until:Date.now()+30*60000};releases.set(hash,entry);return {releaseId:entry.id,releaseKey:hash};
}
export function parseFeed(data,item){
 const channel=data.rss?.channel;if(!channel)throw fail('没有找到 RSS channel，请填写 Torznab API 或 RSS 地址，而非网页地址',502);
 return array(channel.item).slice(0,200).flatMap(entry=>{
  if(!entry||typeof entry!=='object')return [];

  const attrs=Object.fromEntries([...array(entry['torznab:attr']),...array(entry['newznab:attr'])].filter(attr=>attr&&typeof attr==='object').map(attr=>[attr['@_name'],decode(attr['@_value'])]));
  const enclosure=array(entry.enclosure).filter(value=>value&&typeof value==='object').find(value=>/bittorrent|octet-stream/i.test(str(value['@_type']))) || array(entry.enclosure)[0];
  const rawLink=decode(attrs.magneturl || entry['torrent:magnetURI'] || entry['nyaa:magnetURI'] || enclosure?.['@_url'] || entry.link);
  if(!rawLink)return [];
  let target;try{target=rawLink.startsWith('magnet:')?rawLink:validUrl(rawLink,item.url).href;}catch{return [];}
  const infoHash=decode(attrs.infohash || entry['torrent:infoHash'] || entry['nyaa:infoHash'] || /[?&]xt=urn:btih:([a-f\d]{40})(?:&|$)/i.exec(target)?.[1] || '').toLowerCase();
  if(target.startsWith('magnet:')&&!/[?&]xt=urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})(?:&|$)/i.test(target))return [];
  const title=decode(entry.title).slice(0,500);if(!title)return [];
  const date=Date.parse(str(entry.pubDate));
  return [{title,infoHash:/^[a-f\d]{40}$/.test(infoHash)?infoHash:'',sizeBytes:Math.max(0,Number(attrs.size || enclosure?.['@_length'] || entry.size)||0),seeders:Math.max(0,Number(attrs.seeders || entry['torrent:seeds'] || entry['nyaa:seeders'])||0),leechers:Math.max(0,Number(attrs.peers || entry['nyaa:leechers'])||0),publishedAt:Number.isFinite(date)?date:0,...releaseFor(item,target,infoHash)}];
 });
}
async function searchIndexer(item,q){
 let data;const cached=rssCache.get(item.id);
 if(item.type==='rss'&&cached?.revision===item.revision&&Date.now()<cached.until)data=cached.data;
 else {data=await fetchXml(item,q);if(item.type==='rss')rssCache.set(item.id,{data,revision:item.revision,until:Date.now()+60000});}
 return parseFeed(data,item);
}
export function configuredSources(){return (store?.data.items || []).filter(item=>item.enabled).map(item=>({id:item.id,name:item.name,revision:item.revision,custom:true,run:q=>searchIndexer(item,q)}));}
export async function testIndexer(id){
 const item=store?.data.items.find(value=>value.id===id);if(!item)throw fail('资源渠道不存在',404);const start=Date.now();let status;
 try{const data=await fetchXml(item,'',item.type==='torznab');if(item.type==='torznab'&&!data.caps)throw fail('未返回 Torznab 能力声明，请检查 API 地址',502);if(item.type==='rss')parseFeed(data,item);status={ok:true,message:item.type==='torznab'?'Torznab 连接和认证通过':'RSS 读取通过'};}
 catch(error){status={ok:false,message:error.statusCode?error.message:'读取索引响应失败，请检查服务返回内容'};}
 status={...status,latencyMs:Date.now()-start,at:new Date().toISOString()};
 const current=store?.data.items.find(value=>value.id===id);if(current?.revision===item.revision){current.lastTest=status;store.save();}return status;
}
export async function resolveRelease(id){
 const entry=[...releases.values()].find(value=>value.id===id&&value.until>Date.now());if(!entry)throw fail('资源链接已过期，请重新搜索后下载',410);
 const source=entry.builtin?{id:'builtin'}:store?.data.items.find(item=>item.id===entry.indexerId&&item.enabled&&item.revision===entry.revision);if(!source)throw fail('该资源渠道已停用、移除或修改，请重新搜索',409);
 let url=entry.url;
 for(let redirects=0;redirects<5;redirects++){
  if(url.startsWith('magnet:'))return {magnet:url,expectedInfoHash:entry.infoHash};
  const safe=validUrl(url);let response;
  try{response=await httpFetch(safe.href,{timeoutMs:18000,attempts:1,redirect:'manual',settings:{...getSettings(),proxy:''}});}catch{throw fail('种子文件下载失败或超时，请重试',502);}
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw fail('种子下载重定向缺少地址',502);url=location.startsWith('magnet:')?location:validUrl(location,url).href;continue;}
  if(!response.ok){await response.body?.cancel();throw fail('种子下载 HTTP '+response.status,502);}
  const body=await readBounded(response,MAX_TORRENT);return {torrentBase64:body.toString('base64'),expectedInfoHash:entry.infoHash};
 }
 throw fail('种子下载重定向次数过多',502);
}
