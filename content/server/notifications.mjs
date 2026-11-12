import path from 'node:path';
import crypto from 'node:crypto';
import { JsonStore } from './store.mjs';
import { redact } from './log.mjs';
let store;
export function initNotifications(dataDir){store=new JsonStore(path.join(dataDir,'notifications.json'),{items:[]});return listNotifications();}
export function notify({kind='info',title,message,subscriptionId=''}) {
  if(!store)return null;
  const clean=redact(String(message || '')).slice(0,1500),subject=redact(String(title || 'WansPilot')).slice(0,160);
  const duplicate=store.data.items.find(item=>item.kind===kind&&item.subscriptionId===subscriptionId&&item.message===clean&&Date.now()-Date.parse(item.at)<10*60*1000);
  if(duplicate)return duplicate;
  const item={id:crypto.randomUUID(),kind,title:subject,message:clean,subscriptionId,at:new Date().toISOString(),read:false};
  store.data.items.unshift(item);store.data.items=store.data.items.slice(0,300);store.save();return item;
}
export function listNotifications(){const items=store?.data.items || [];return {items,unread:items.filter(item=>!item.read).length};}
export function readNotifications(ids){if(!store)return;const selected=ids===null?null:new Set(ids);for(const item of store.data.items)if(!selected || selected.has(item.id))item.read=true;store.save();return listNotifications();}
export function flushNotifications(){if(store?.pending)store.flush();}
