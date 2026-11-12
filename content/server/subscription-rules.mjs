/** Literal matching only: subscription rules never execute user-provided regular expressions. */
const bad = message => { throw Object.assign(new Error(message), { statusCode:400 }); };
export function normalizeRules(input = {}, previous = {}) {
  const out={};
  for(const key of ['includeKeywords','excludeKeywords']) {
    const value=Object.hasOwn(input,key)?input[key]:previous[key] || [];
    if(typeof value!=='string' && !Array.isArray(value))bad('关键词必须是文本或数组');
    const terms=(Array.isArray(value)?value:String(value).split(/[,，\n]/)).map(word=>String(word).trim()).filter(Boolean);
    if(terms.length>20 || terms.some(word=>word.length>80))bad('每组最多 20 个关键词，每个不超过 80 字符');
    out[key]=[...new Set(terms)];
  }
  out.codec=Object.hasOwn(input,'codec')?String(input.codec):previous.codec || 'any';
  if(!['any','h264','h265','av1'].includes(out.codec))bad('编码只支持不限、H.264、H.265 或 AV1');
  out.strictQuality=Object.hasOwn(input,'strictQuality')?input.strictQuality===true:previous.strictQuality===true;
  for(const [key,min,max,def] of [['startEpisode',1,9999,1],['endEpisode',0,9999,0],['checkIntervalMinutes',0,1440,0]]) {
    const value=Object.hasOwn(input,key)?Number(input[key]):Number(previous[key] ?? def);
    if(!Number.isInteger(value)||value<min||value>max)bad(key+' 超出允许范围');
    if(key==='checkIntervalMinutes' && value!==0 && value<5)bad('检查间隔至少 5 分钟，0 表示跟随全局');
    out[key]=value;
  }
  if(out.endEpisode && out.endEpisode<out.startEpisode)bad('结束集号不能小于开始集号');
  out.minSizeGB=Object.hasOwn(input,'minSizeGB')?Number(input.minSizeGB):Number(previous.minSizeGB || 0);
  if(!Number.isFinite(out.minSizeGB)||out.minSizeGB<0||out.minSizeGB>500)bad('最小体积必须在 0–500 GB 之间');
  return out;
}
export function episodeInScope(sub, season, episode) {
  return Number(season)>0 && Number(episode)>0 && (!sub.seasons?.length || sub.seasons.map(Number).includes(Number(season))) && Number(episode)>=Number(sub.startEpisode || 1) && (!sub.endEpisode || Number(episode)<=Number(sub.endEpisode));
}
export function matchesRules(candidate, sub) {
  const title=String(candidate.title || '').normalize('NFKC').toLowerCase();
  if((sub.includeKeywords || []).some(word=>!title.includes(String(word).normalize('NFKC').toLowerCase())))return false;
  if((sub.excludeKeywords || []).some(word=>title.includes(String(word).normalize('NFKC').toLowerCase())))return false;
  if(Number(sub.minSizeGB)>0 && Number(candidate.sizeBytes || 0)<Number(sub.minSizeGB)*1024**3)return false;
  const text=(String(candidate.codec || '')+' '+title).toLowerCase();
  if(sub.codec==='h264' && !/(?:[hx][ ._-]?264|avc)/i.test(text))return false;
  if(sub.codec==='h265' && !/(?:[hx][ ._-]?265|hevc)/i.test(text))return false;
  if(sub.codec==='av1' && !/\bav1\b/i.test(text))return false;
  // No quality downgrade, even when the search source ignores quality parameters.
  if(sub.strictQuality && sub.qualityPreference!=='any' && candidate.resolution!==sub.qualityPreference)return false;
  return true;
}
export function selectedIds(value) {
  if(!Array.isArray(value) || value.length<1 || value.length>50 || value.some(id=>typeof id!=='string'||!id||id.length>100))bad('请选择 1–50 个有效条目');
  return [...new Set(value)];
}
