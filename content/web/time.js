/** Shared fixed-zone presentation. Storage timestamps stay ISO instants. */
export const TIME_ZONE='Asia/Shanghai';
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(value=new Date()) {
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  return Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
export function shanghaiDate(value=new Date()){const p=parts(value);return p?`${p.year}-${p.month}-${p.day}`:'';}
export function shanghaiTime(value=new Date()){const p=parts(value);return p?`${p.hour}:${p.minute}:${p.second}`:'';}
export function shanghaiDateTime(value=new Date()){const p=parts(value);return p?`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`:'';}
export function shanghaiTimestamp(value=new Date()){const p=parts(value);return p?`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`:'';}
