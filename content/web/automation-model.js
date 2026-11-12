/** Small pure selectors shared by browser acceptance and the live UI. */
export function filterTasks(items, {q='',status='all',sort='added'}={}) {
  const query=q.trim().toLowerCase();
  const matches={active:t=>['queued','fetching-metadata','downloading','seeding'].includes(t.state),downloading:t=>['queued','fetching-metadata','downloading'].includes(t.state)&&Number(t.progress)<1,paused:t=>t.state==='paused',completed:t=>Number(t.progress)>=1&&t.state!=='error',error:t=>t.state==='error'};
  return items.filter(t=>(!query||String(t.name || '').toLowerCase().includes(query))&&(!matches[status]||matches[status](t))).slice().sort((a,b)=>sort==='name'?String(a.name).localeCompare(String(b.name),'zh-CN'):sort==='progress'?Number(b.progress || 0)-Number(a.progress || 0):sort==='speed'?Number(b.rateDown || 0)-Number(a.rateDown || 0):String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}
export function filterSubscriptions(items,{q='',status='all',sort='next'}={}) {
  const query=q.trim().toLowerCase();
  const matches={enabled:i=>i.enabled!==false,paused:i=>i.enabled===false,checking:i=>i.isChecking,error:i=>i.state==='error',pending:i=>i.pendingKeys?.length>0};
  return items.filter(i=>(!query||String(i.title || '').toLowerCase().includes(query)||String(i.originalTitle || '').toLowerCase().includes(query))&&(!matches[status]||matches[status](i))).slice().sort((a,b)=>sort==='title'?String(a.title).localeCompare(String(b.title),'zh-CN'):sort==='created'?String(b.createdAt || '').localeCompare(String(a.createdAt || '')):String(a.nextCheckAt || '9999').localeCompare(String(b.nextCheckAt || '9999')));
}
