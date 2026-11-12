import { shanghaiDateTime, shanghaiTimestamp } from '../web/time.js';
import { normalizeRules, matchesRules, episodeInScope, selectedIds } from './subscription-rules.mjs';
import { notify } from './notifications.mjs';
/**
 * 订阅：记录要追的影片，定期检查更新，发现新剧集就自动搜索并交给下载引擎。
 *
 * 判断「有没有更新」完全基于 TMDB 的播出日期：某集的 airDate 已过且未下载过，
 * 就算新剧集。这样不依赖任何站点状态，也不需要用户手动标记。
 */
import path from 'node:path';
import { JsonStore } from './store.mjs';
import { log, redact } from './log.mjs';
import { localDateKey } from '../web/calendar-model.js';
import { getSettings, resolveDownloadDir } from './settings.mjs';
import * as tmdb from './tmdb.mjs';
import { searchResources } from './sources.mjs';
import { addTask, getTask, listTasks, engineReady } from './engine.mjs';
import { capacityCheck } from './capacity.mjs';

let store = null;
let timer = null;
let running = false;
const checks = new Map();
const searchRuns = new Map();
let activeChecks=0;
const checkQueue=[];
function checkSlot(){return new Promise(resolve=>{const enter=()=>{activeChecks++;resolve(()=>{activeChecks--;checkQueue.shift()?.();});};if(activeChecks<2)enter();else checkQueue.push(enter);});}

let engineAdd = null;
let resourceSearch = searchResources;
let mediaDetail = tmdb.detail;
let mediaSeason = tmdb.season;
let subscribeKeysFactory = null;

export function initSubscriptions(dataDir, deps = {}) {
  store = new JsonStore(path.join(dataDir, 'subscriptions.json'), { items: [] }, { debounceMs: 300 });
  engineAdd = deps.addTask || addTask;
  resourceSearch = deps.searchResources || searchResources;
  mediaDetail = deps.detail || tmdb.detail;
  mediaSeason = deps.season || tmdb.season;
  subscribeKeysFactory = deps.getTask || getTask;
  for (const item of store.data.items || []) {
    if (item.checkInProgress || ['checking','searching','submitting'].includes(item.activity?.stage)) {
      item.checkInProgress=false;
      item.nextCheckAt = new Date().toISOString();
      activity(item,'interrupted','服务重启，上次检查已中断，等待重新检查');
    }
  }
  return listSubscriptions();
}

function save() {
  store.save();
}

export function listSubscriptions() {
  const items = Array.isArray(store.data.items) ? store.data.items : [];
  return { items: items.map(decorate) };
}

/** Bounded per-subscription history is persisted with the subscription, never with credentials. */
function activity(item, stage, message) {
  const event = { stage, message:redact(String(message)).slice(0,1000), at:new Date().toISOString() };
  item.activity = event;
  item.history = [...(item.history || []),event].slice(-100);
  item.lastMessage = event.message;
  if(['submitted','completed','error','warning','matched'].includes(stage))notify({kind:stage==='error'||stage==='warning'?'error':stage==='completed'?'success':'info',title:item.title || '订阅',message:event.message,subscriptionId:item.id});
  log[stage === 'error' ? 'warn' : 'info'](`[subs] 《${item.title || item.tmdbId}》(${item.id}) ${event.message}`);
  save();
}
function downloadSnapshot(item) {
  const tasks = [...new Set(Object.values(item.pendingTasks || {}))].map(id => subscribeKeysFactory?.(id)).filter(Boolean);
  return { tasks:tasks.map(task=>({id:task.id,name:task.name || '',state:task.state,progress:Number(task.progress)||0})),
    downloading:tasks.filter(task=>['downloading','seeding'].includes(task.state) && Number(task.progress)<1).length,
    paused:tasks.filter(task=>task.state==='paused').length,
    queued:tasks.filter(task=>['queued','fetching-metadata'].includes(task.state)).length,
    errors:tasks.filter(task=>task.state==='error').length };
}

function decorate(item) {
  if (subscribeKeysFactory && reconcileDownloads(item)) save();
  return {
    id: item.id,
    type: item.type,
    tmdbId: item.tmdbId,
    title: item.title,
    originalTitle: item.originalTitle || '',
    posterPath: item.posterPath || '',
    year: item.year || '',
    seasons: item.seasons ?? null,
    qualityPreference: item.qualityPreference,
    minSeeders: item.minSeeders,
    maxSizeGB: item.maxSizeGB,
    autoDownload: item.autoDownload !== false,
    enabled: item.enabled !== false,
    createdAt: item.createdAt,
    lastCheckAt: item.lastCheckAt || null,
    nextCheckAt: item.nextCheckAt || null,
    lastMessage: item.lastMessage || '',
    downloadedKeys: item.downloadedKeys || [],
    pendingKeys: Object.keys(item.pendingTasks || {}),
    // 降档下载后如果发现更好的版本，这里带着候选给界面做「替换」提示
    upgrade: item.upgrade || null,
    state: item.state || 'idle',
    totalEpisodes: item.totalEpisodes || 0,
    isChecking:checks.has(item.id),
    activity:item.activity || null,
    history:(item.history || []).slice(-100),
    downloads:downloadSnapshot(item),
    ...normalizeRules({},item),
  };
}

function findItem(id) {
  const items = Array.isArray(store.data.items) ? store.data.items : [];
  return items.find((it) => it.id === id);
}

function newId() {
  return `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 订阅同一部作品的同一批季只允许一份。 */
export function createSubscription(input) {
  const type = input.type === 'movie' ? 'movie' : 'tv';
  const tmdbId = Number.parseInt(input.tmdbId, 10);
  if (!Number.isFinite(tmdbId)) {
    const err = new Error('缺少有效的 TMDB 编号');
    err.statusCode = 400;
    throw err;
  }

  const items = Array.isArray(store.data.items) ? store.data.items : [];
  const dup = items.find((it) => it.tmdbId === tmdbId && it.type === type);
  if (dup) {
    const err = new Error('已经订阅过这部作品');
    err.statusCode = 409;
    throw err;
  }

  const settings = getSettings();
  const seasons = type === 'movie' ? null : normalizeSeasons(input.seasons);

  const item = {
    id: newId(),
    ...normalizeRules(input),
    type,
    tmdbId,
    title: String(input.title || '').trim(),
    originalTitle: String(input.originalTitle || '').trim(),
    posterPath: String(input.posterPath || ''),
    year: String(input.year || ''),
    seasons,
    qualityPreference: normalizeQuality(input.qualityPreference, settings.qualityPreference),
    minSeeders: clamp(input.minSeeders, 0, 100000, settings.minSeeders),
    maxSizeGB: clamp(input.maxSizeGB, 1, 500, settings.maxSizeGB),
    autoDownload: input.autoDownload !== false,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastCheckAt: null,
    nextCheckAt: new Date().toISOString(),
    lastMessage: '已订阅，等待首次检查',
    downloadedKeys: [],
    state: 'idle',
    totalEpisodes: 0,
  };

  if(item.minSizeGB>item.maxSizeGB)throw Object.assign(new Error('最小体积不能大于最大体积'),{statusCode:400});
  items.push(item);
  store.data.items = items;
  save();

  activity(item,'queued','订阅已创建，已安排首次检查');

  // 订阅后立刻跑一次，用户不用等下一个周期
  runCheck(item).catch((err) => log.warn(`[subs] 首次检查失败 ${item.id}: ${err.message}`));
  return { item: decorate(item) };
}

function clamp(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeQuality(value, fallback) {
  const v = String(value || '').trim();
  return ['any', '720p', '1080p', '2160p'].includes(v) ? v : fallback;
}

function normalizeSeasons(value) {
  if (!Array.isArray(value)) return null;
  const list = [...new Set(value.map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0))];
  list.sort((a, b) => a - b);
  return list.length ? list : null;
}

export function updateSubscription(id, patch) {
  const item = findItem(id);
  if (!item) return null;
  const wasEnabled=item.enabled!==false,wasAutomatic=item.autoDownload!==false;
  const rules=normalizeRules(patch,item);
  if(rules.minSizeGB>clamp(patch.maxSizeGB ?? item.maxSizeGB,1,500,item.maxSizeGB))throw Object.assign(new Error('最小体积不能大于最大体积'),{statusCode:400});
  Object.assign(item,rules);
  if ('checkIntervalMinutes' in patch) item.nextCheckAt=new Date(Date.now()+(item.checkIntervalMinutes || getSettings().checkIntervalMinutes || 60)*60000).toISOString();
  if ('qualityPreference' in patch) item.qualityPreference = normalizeQuality(patch.qualityPreference, item.qualityPreference);
  if ('minSeeders' in patch) item.minSeeders = clamp(patch.minSeeders, 0, 100000, item.minSeeders);
  if ('maxSizeGB' in patch) item.maxSizeGB = clamp(patch.maxSizeGB, 1, 500, item.maxSizeGB);
  if ('autoDownload' in patch) item.autoDownload = Boolean(patch.autoDownload);
  if ('enabled' in patch) {
    item.enabled = Boolean(patch.enabled);
    item.state = item.enabled ? 'watching' : 'paused';
    if(item.enabled)item.nextCheckAt=new Date().toISOString();
  }
  if ('seasons' in patch) item.seasons = item.type === 'movie' ? null : normalizeSeasons(patch.seasons);
  // API.md 写的是「SubscriptionItem 的任意子集」，下载记录也要能重置：
  // 用户在网盘里删了文件、或改了画质想重下时需要它。
  if ('downloadedKeys' in patch && Array.isArray(patch.downloadedKeys)) {
    const keys = new Set();
    for (const raw of patch.downloadedKeys) {
      const text = String(raw || '').trim();
      if (text === 'movie' || /^S\d{2}E\d{2}$/.test(text)) keys.add(text);
    }
    item.downloadedKeys = [...keys];
    if (!item.downloadedKeys.length && item.state === 'idle') item.state = 'watching';
  }
  activity(item, item.enabled === false ? 'paused' : 'updated', '订阅设置已更新' + ('enabled' in patch ? (item.enabled ? '，已启用' : '，已暂停') : ''));
  if(item.enabled!==false && ((patch.enabled===true&&!wasEnabled)||(patch.autoDownload===true&&!wasAutomatic)))queueCheck(id);
  return { item: decorate(item) };
}

export function deleteSubscription(id) {
  const items = Array.isArray(store.data.items) ? store.data.items : [];
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  const item=items[idx]; item.cancelled=true;
  activity(item,'deleted','已取消订阅，现有下载任务保留');
  items.splice(idx, 1);
  store.data.items = items;
  save();
  return true;
}

/* --------------------------------------------------------------- 检查逻辑 */

function todayStr() {
  return localDateKey();
}

function isAired(dateStr) {
  if (!dateStr) return false;
  return dateStr <= todayStr();
}

function epKey(season, episode) {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

// 片名匹配用：这些词出现在发布名里但没有区分度。
const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'part', 'vol', 'complete', 'season', 'series', 'movie',
  'web', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdrip', 'hdtv', 'remux',
  'proper', 'repack', 'multi', 'dual', 'audio', 'x264', 'x265', 'h264', 'h265', 'hevc',
  'avc', 'aac', 'ac3', 'dts', 'ddp', 'atmos', 'hdr', 'dv', 'remastered', 'extended',
  'ita', 'eng', 'jpn', 'kor', 'chs', 'cht', 'sub', 'subs', 'internal',
]);

function normalizeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^0-9a-z\u3400-\u4dbf\u4e00-\u9fff]+/g, ' ')
    .trim();
}

function latinTokens(text) {
  return normalizeTitle(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TITLE_STOP_WORDS.has(t));
}

function cjkChars(text) {
  return String(text || '').match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || [];
}

/**
 * 候选片名是否属于所订阅的作品。
 *
 * 索引源对中文片名基本无效：实测用中文名查 apibay 会返回一份与本片无关的通用列表，
 * 而这份列表里有别的 2160p 新片，按画质偏好排序就会顶到第一。所以下发前必须过这道闸。
 * 中文名按字符命中率（≥50%）判，原名按有效词命中率（≥60%）判。
 */
export function titleMatches(candidateTitle, expectedTitles) {
  const candidate = normalizeTitle(candidateTitle);
  if (!candidate) return false;
  for (const expected of expectedTitles) {
    if (!expected) continue;
    const chars = cjkChars(expected);
    if (chars.length >= 2) {
      const hit = chars.filter((ch) => candidate.includes(ch)).length;
      if (hit >= 2 && hit / chars.length >= 0.5) return true;
      continue;
    }
    const tokens = latinTokens(expected);
    if (!tokens.length) continue;
    const hit = tokens.filter((t) => candidate.includes(t)).length;
    if (hit / tokens.length >= 0.6) return true;
  }
  return false;
}

/** 候选名里写的年份与所订阅年份相差超过一年 → 不是同一部作品。 */
function yearMismatch(title, expectedYear) {
  if (!expectedYear) return false;
  const found = String(title || '').match(/(?:19|20)\d{2}/g);
  if (!found) return false;
  return found.every((y) => Math.abs(Number(y) - Number(expectedYear)) > 1);
}

/** 画质从高到低，用于「主档缺源时逐级降档」。 */
const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'];

/** 从偏好档开始的降级顺序。 */
function qualityLadder(preference) {
  if (preference === 'any') return [''];
  const index = QUALITY_ORDER.indexOf(String(preference || '1080p'));
  return QUALITY_ORDER.slice(index >= 0 ? index : 1);
}

/** 从候选资源里按偏好挑一个可用的。expectedTitles 非空时先过片名闸。 */
export function pickBest(candidates, item, want, expectedTitles = [], options = {}) {
  const minSeeders = item.minSeeders ?? 0;
  const maxBytes = (item.maxSizeGB || 30) * 1024 ** 3;
  const expectedYear = want === 'movie' ? Number(item.year) || 0 : 0;
  const strictQuality = options.strictQuality || '';
  const filtered = candidates.filter((c) => {
    if ((!c.magnet&&!c.releaseId) || !matchesRules(c,item)) return false;
    // 站点不公布做种数（seedersUnknown）时不套用最低做种数，否则中文站资源永远进不了自动下载
    if (!c.seedersUnknown && c.seeders < minSeeders) return false;
    if (c.sizeBytes > maxBytes) return false;
    if (strictQuality && c.resolution !== strictQuality) return false;
    if (expectedTitles.length && !titleMatches(c.title, expectedTitles)) return false;
    if (expectedYear && yearMismatch(c.title, expectedYear)) return false;
    return true;
  });
  if (!filtered.length) return null;

  // 画质偏好优先级最高；同画质看做种数
  const prefer = item.qualityPreference || '1080p';
  const rank = (c) => {
    let s = c.seeders;
    if (prefer !== 'any' && c.resolution) s += c.resolution === prefer ? 1e9 : 0;
    if (want === 'pack' && c.isSeasonPack) s += 5e8;
    if (want === 'episode' && !c.isSeasonPack) s += 1e8;
    return s;
  };
  filtered.sort((a, b) => rank(b) - rank(a));
  return filtered[0];
}

/**
 * 按原名搜索，过头道闸；原名搜不到时再用 TMDB 的本地化名搜一次
 * （torrents-csv 收录部分中文内容），两次都过同一道片名闸。
 */
async function searchForTitle(item, params, localizedTitle, want, extraFilter, options = {}) {
  const titles = [item.originalTitle, localizedTitle, item.title].filter(Boolean);
  const primary = item.originalTitle || localizedTitle || item.title;
  let checked = 0;
  const attempt = async (q) => {
    const run=searchRuns.get(item.id);
    const key=JSON.stringify({...params,q});
    let res=run?.cache.get(key);
    if (!res) {
      if (run && (run.remaining<=0 || Date.now()>run.deadline)) {
        const err=new Error('本轮搜索已达到时间或查询上限，剩余缺集将在下次检查继续');err.code='SEARCH_BUDGET';throw err;
      }
      if (run) run.remaining--;
      const scope=params.episode ? epKey(params.season,params.episode) : params.season ? '第 '+params.season+' 季整季包' : '电影';
      activity(item,'searching','正在搜索 '+scope+'：'+q);
      res=await resourceSearch({ ...params, q });
      const failed=(res.sources || []).filter(source=>source.ok===false);
      if (res.sources?.length && failed.length===res.sources.length) throw new Error('全部索引源不可用：'+failed.map(source=>source.name || source.id).join('、'));
      activity(item,'searching','搜索 '+scope+' 返回 '+res.items.length+' 条候选'+(failed.length?'，'+failed.length+' 个源不可用':''));
      if (run) run.cache.set(key,res);
      const named=res.items.filter(candidate=>titleMatches(candidate.title,titles));
      const scoped=extraFilter?named.filter(extraFilter):named;
      activity(item,'searching','资源诊断：片名匹配 '+named.length+' 条，季集匹配 '+scoped.length+' 条'+(!named.length?'；当前索引源未找到该作品资源，不会提交无关影视':'') );
    }
    checked += res.items.length;
    const pool = extraFilter ? res.items.filter(extraFilter) : res.items;
    return pickBest(pool, item, want, titles, options);
  };
  let best = await attempt(primary);
  if (!best && localizedTitle && localizedTitle !== primary) best = await attempt(localizedTitle);
  return { best, checked, titles };
}

/**
 * 按偏好档找，缺源时逐级降档。
 * @returns {{best: object|null, checked: number, usedRung: string, fellBack: boolean}}
 */
async function searchWithLadder(item, params, localizedTitle, want, extraFilter) {
  const ladder = item.strictQuality ? [item.qualityPreference === 'any' ? '' : item.qualityPreference] : qualityLadder(item.qualityPreference);
  let checked = 0;
  for (const rung of ladder) {
    const found = await searchForTitle(item, params, localizedTitle, want, extraFilter, { strictQuality: rung });
    checked += found.checked;
    if (found.best) {
      return { best: found.best, checked, usedRung: rung, fellBack: rung !== ladder[0] };
    }
  }
  return { best: null, checked, usedRung: '', fellBack: false };
}

/** 交给下载引擎。候选已在下载列表里是正常情况，不能记成检查失败。 */
async function addToEngine(item, candidate) {
  if (item.cancelled || item.enabled === false) throw new Error('订阅已暂停或取消，停止提交新下载');
  activity(item,'submitting','已匹配资源，正在提交到 qBittorrent：'+candidate.title);
  // 体积已知时先看空间，避免下到一半撑爆网盘
  const cap = capacityCheck(candidate.sizeBytes, Number(((listTasks().stats) || {}).totalSizeBytes) || 0, Number(((listTasks().stats) || {}).remainingBytes) || 0);
  if (!cap.ok) {
    log.warn(`[subs] ${item.id} 空间不足，跳过《${candidate.title}》：${cap.message}`);
    return { ok: false, duplicate: false, reason: cap.message };
  }
  try {
    const task = await engineAdd({ ...(candidate.releaseId?{releaseId:candidate.releaseId}:{magnet:candidate.magnet}), sizeBytes: candidate.sizeBytes }, getSettings().qbSavePath || '');
    activity(item,'submitted','qBittorrent 已接受下载任务：'+candidate.title);
    return { ok: true, duplicate: false, taskId: task?.id || candidate.infoHash || String(candidate.magnet || '').match(/btih:([a-f0-9]{40})/i)?.[1] };
  } catch (err) {
    if (/已在下载列表/.test(err.message)) {
      log.info(`[subs] ${item.id} 候选《${candidate.title}》已在下载列表中，跳过重复添加`);
      return { ok: true, duplicate: true, taskId: err.taskId || candidate.infoHash || String(candidate.magnet || '').match(/btih:([a-f0-9]{40})/i)?.[1] };
    }
    throw err;
  }
}

async function checkMovie(item) {
  const detail = await mediaDetail({ type: 'movie', id: item.tmdbId });
  item.title = detail.title || item.title;
  item.originalTitle = detail.originalTitle || item.originalTitle || '';
  item.posterPath = detail.posterPath || item.posterPath;
  item.year = detail.year || item.year;

  if (!isAired(detail.releaseDate)) {
    item.lastMessage = `尚未上映（${detail.releaseDate || '日期待定'}）`;
    item.state = 'watching';
    return { found: 0, added: [] };
  }
  if ((item.downloadedKeys.includes('movie') || item.pendingTasks?.movie) && !(item.upgrade?.pending || item.upgrade?.available)) {
    item.lastMessage = item.pendingTasks?.movie ? '已提交到 qBittorrent，等待下载完成' : '已下载，无需重复获取';
    item.state = 'idle';
    return { found: 0, added: [] };
  }

  // 已经下过但当时是降档拿到的，之后每次检查都回头看有没有更好的版本
  if ((item.downloadedKeys.includes('movie') || item.pendingTasks?.movie) && item.upgrade && (item.upgrade.pending || item.upgrade.available)) {
    const better = await searchForTitle(
      item,
      { type: 'movie', year: detail.year, qualityPreference: item.qualityPreference },
      detail.title,
      'movie',
      null,
      { strictQuality: item.qualityPreference },
    );
    if (better.best) {
      item.upgrade = {
        available: true,
        title: better.best.title,
        magnet: better.best.magnet,
        sizeBytes: better.best.sizeBytes,
        resolution: better.best.resolution,
      };
      item.lastMessage = `发现更好的版本（${better.best.resolution || '更高画质'}）：${better.best.title}`;
      item.state = 'watching';
      return { found: better.checked, added: [] };
    }
    item.lastMessage = '仍是降档版本，暂未出现更好的资源';
    item.state = 'idle';
    return { found: 0, added: [] };
  }

  const { best, checked, usedRung, fellBack } = await searchWithLadder(
    item,
    { type: 'movie', year: detail.year, qualityPreference: item.qualityPreference },
    detail.title,
    'movie',
  );
  if (!best) {
    item.lastMessage = checked
      ? `未找到与《${item.title}》匹配的资源（已检查 ${checked} 条候选）`
      : `未找到与《${item.title}》匹配的资源`;
    item.state = 'watching';
    return { found: checked, added: [] };
  }
  if (!item.autoDownload) {
    item.lastMessage = `找到 ${checked} 条候选，自动下载已关闭`;
    return { found: checked, added: [] };
  }
  const added = await addToEngine(item, best);
  if (!added.ok) {
    item.lastMessage = added.reason || '空间不足，已跳过';
    item.state = 'error';
    return { found: checked, added: [] };
  }
  trackSubmission(item, ['movie'], added.taskId);
  item.upgrade = fellBack
    ? { pending: true, reason: `${item.qualityPreference} 暂无符合条件资源，先下 ${usedRung}` }
    : null;
  item.lastMessage = added.duplicate
    ? `已在下载列表中：${best.title}`
    : `已加入下载${fellBack ? `（${usedRung}，主档缺源）` : ''}：${best.title}`;
  item.state = 'idle';
  return { found: checked, added: ['movie'] };
}

async function checkTv(item) {
  const detail = await mediaDetail({ type:'tv', id:item.tmdbId });
  item.title=detail.title || item.title; item.originalTitle=detail.originalTitle || item.originalTitle || '';
  item.posterPath=detail.posterPath || item.posterPath; item.year=detail.year || item.year;
  const seasons=[...new Set((item.seasons?.length ? item.seasons : (detail.seasons || []).map(s=>s.seasonNumber)).map(Number))].filter(n=>Number.isInteger(n)&&n>0).sort((a,b)=>a-b);
  if (!seasons.length) throw new Error('TMDB 未返回季信息');
  const known=new Set([...item.downloadedKeys,...Object.keys(item.pendingTasks || {})]);
  const aired=[], unavailable=[];
  for (const seasonNumber of seasons) {
    activity(item,'checking','正在读取第 '+seasonNumber+' 季播出信息');
    try {
      const info=await mediaSeason({id:item.tmdbId,season:seasonNumber});
      const seen=new Set();
      for (const episode of info.episodes || []) {
        if (!Number.isInteger(episode.episodeNumber) || !episodeInScope(item,seasonNumber,episode.episodeNumber) || !isAired(episode.airDate)) continue;
        const key=epKey(seasonNumber,episode.episodeNumber);if(seen.has(key))continue;seen.add(key);
        aired.push({season:seasonNumber,episode:episode.episodeNumber,key});
      }
    } catch(err) { unavailable.push(seasonNumber); activity(item,'warning','第 '+seasonNumber+' 季信息获取失败：'+err.message); }
  }
  item.totalEpisodes=aired.length;
  const missing=aired.filter(episode=>!known.has(episode.key));
  activity(item,'checking','已播 '+aired.length+' 集，待补 '+missing.length+' 集，已提交 '+Object.keys(item.pendingTasks || {}).length+' 集');
  if (!missing.length) {
    item.lastMessage=unavailable.length ? '部分季信息获取失败，请稍后重试' : Object.keys(item.pendingTasks || {}).length ? '已播集数均已下载或提交，等待 qBittorrent 完成' : aired.length ? '已是最新，共 '+aired.length+' 集' : '暂无已播出的剧集';
    item.state=unavailable.length?'error':'watching';return {found:0,added:[]};
  }
  const sorted=missing.slice().sort((a,b)=>a.season-b.season || a.episode-b.episode);
  const after=sorted.findIndex(ep=>ep.key===item.searchAfterKey);
  const ordered=after>=0 ? [...sorted.slice(after+1),...sorted.slice(0,after+1)] : sorted;
  let checked=0, attempts=0, blocked='';const added=[],packed=new Set();
  for (const ep of ordered) {
    if (attempts>=5 || item.cancelled || item.enabled===false) break;
    if (known.has(ep.key)) continue;
    const sameSeason=sorted.filter(e=>e.season===ep.season && !known.has(e.key));
    if (sameSeason.length>=4 && Number(item.startEpisode || 1)===1 && !item.endEpisode && !packed.has(ep.season)) {
      packed.add(ep.season);
      const found=await searchWithLadder(item,{type:'tv',season:ep.season,year:item.year,qualityPreference:item.qualityPreference},detail.title,'pack',c=>c.isSeasonPack && (c.season===null || c.season===ep.season));
      checked+=found.checked;
      if(found.best && item.autoDownload) {
        const result=await addToEngine(item,found.best);
        if(!result.ok) { blocked=result.reason; break; }
        trackSubmission(item,sameSeason.map(e=>e.key),result.taskId);
        sameSeason.forEach(e=>{known.add(e.key);added.push(e.key);});
        // One pack per check keeps a first subscription from flooding the queue.
        break;
      }
    }
    attempts++; item.searchAfterKey=ep.key;
    const found=await searchWithLadder(item,{type:'tv',season:ep.season,episode:ep.episode,year:item.year,qualityPreference:item.qualityPreference},detail.title,'episode',c=>!c.isSeasonPack && c.season===ep.season && (c.episodeList || []).includes(ep.episode));
    checked+=found.checked;
    if(!found.best) { activity(item,'searching',ep.key+' 未找到符合片名、集号、画质、做种数及体积条件的资源');continue; }
    if(!item.autoDownload) { activity(item,'matched',ep.key+' 已匹配资源，自动下载已关闭');continue; }
    const result=await addToEngine(item,found.best);
    if(!result.ok) {blocked=result.reason;break;}
    trackSubmission(item,[ep.key],result.taskId);known.add(ep.key);added.push(ep.key);
  }
  const remaining=aired.filter(ep=>!known.has(ep.key)).length;
  item.lastMessage=blocked || (added.length ? '已提交 '+added.length+' 集到 qBittorrent' : item.autoDownload ? '本轮未匹配到可下载资源' : '自动下载已关闭，仅搜索不提交')+'；仍有 '+remaining+' 集待补'+(remaining ? '，后续检查继续搜索' : '')+(unavailable.length?'；部分季信息不可用':'');
  item.state=blocked || unavailable.length?'error':'watching';
  return {found:checked,added};
}

/** 执行一次检查，并更新调度字段。 */
function trackSubmission(item, keys, taskId) {
  item.pendingTasks ||= {};
  for (const key of keys) if (taskId) item.pendingTasks[key] = taskId;
}

function reconcileDownloads(item) {
  let changed = false;
  item.downloadedKeys ||= [];
  for (const [key, taskId] of Object.entries(item.pendingTasks || {})) {
    const task = subscribeKeysFactory(taskId);
    if (!task && !engineReady()) continue;
    if (task && task.state !== 'error' && Number(task.progress) >= 1) {
      if (!item.downloadedKeys.includes(key)) item.downloadedKeys.push(key);
      delete item.pendingTasks[key];
      activity(item,'completed',key+' 下载完成');
      changed = true;
    } else if (!task || task.state === 'error') {
      delete item.pendingTasks[key];
      changed = true;
      activity(item,'warning',key+' 下载任务失败或已移除，将重新搜索资源');
    }
  }
  return changed;
}

export function runCheck(item) {
  if (checks.has(item.id)) return checks.get(item.id);
  if(activeChecks>=2)activity(item,'queued','检查已排队，等待前面的订阅完成');
  const work = checkSlot().then(async release=>{try{if(item.cancelled || item.enabled===false)return {ran:false,message:'订阅已暂停或取消'};return await performCheck(item);}finally{release();}}).finally(() => checks.delete(item.id));
  checks.set(item.id, work);
  return work;
}

async function performCheck(item) {
  reconcileDownloads(item);
  const started = new Date();
  item.checkInProgress=true;
  searchRuns.set(item.id,{cache:new Map(),remaining:12,deadline:Date.now()+90000});
  activity(item,'checking','开始检查订阅，正在读取影视信息');
  let result = { found: 0, added: [] };
  try {
    result = item.type === 'movie' ? await checkMovie(item) : await checkTv(item);
  } catch (err) {
    item.lastMessage = err.code === 'SEARCH_BUDGET' ? err.message : `检查失败：${err.message}`;
    item.state = err.code === 'SEARCH_BUDGET' ? 'watching' : 'error';
  }
  item.lastCheckAt = started.toISOString();
  const interval = item.checkIntervalMinutes || getSettings().checkIntervalMinutes || 60;
  item.nextCheckAt = new Date(Date.now() + interval * 60000).toISOString();
  item.checkInProgress=false;
  searchRuns.delete(item.id);
  if (item.enabled === false) item.state='paused';
  activity(item,item.state==='error'?'error':item.enabled===false?'paused':'waiting',item.lastMessage+'；'+(item.enabled===false?'订阅已暂停':'下次检查 '+shanghaiDateTime(item.nextCheckAt)+'（上海时间）'));
  return { ran: true, found: result.found, added: result.added, message: item.lastMessage };
}

export function queueCheck(id) {
  const item=findItem(id);if(!item)return null;
  if(item.enabled===false) return {ran:false,item:decorate(item),message:'订阅已暂停，请先启用'};
  const alreadyRunning=checks.has(id);
  runCheck(item).catch(err=>log.warn('[subs] 手动检查失败：'+err.message));
  return {ran:true,started:true,alreadyRunning,item:decorate(item),message:alreadyRunning?'检查正在进行':'已开始检查，可在订阅记录中查看进度'};
}

export async function checkNow(id) {
  const item = findItem(id);
  if (!item) return null;
  return runCheck(item);
}

/** Batch operations return partial results. No batch deletion or file deletion is exposed. */
export function batchSubscriptions(input) {
  const ids=selectedIds(input.ids),action=String(input.action || '');
  if(!['check','pause','enable','auto-on','auto-off'].includes(action))throw Object.assign(new Error('不支持的批量操作'),{statusCode:400});
  const results=ids.map(id=>{
    try {
      const item=findItem(id);if(!item)throw new Error('订阅不存在');
      if(action==='check'){const result=queueCheck(id);return {id,ok:result.ran,message:result.message};}
      const patch=action==='pause'?{enabled:false}:action==='enable'?{enabled:true}:{autoDownload:action==='auto-on'};
      updateSubscription(id,patch);
      if(action==='auto-on' && item.enabled!==false){const queued=queueCheck(id);return {id,ok:true,message:'已开启自动下载；'+queued.message};}
      return {id,ok:true,message:action==='auto-on'?'已开启自动下载，订阅仍暂停，启用后开始检查':'已更新'};
    }catch(err){return {id,ok:false,message:err.message};}
  });
  log.info('[subs] 批量 '+action+'：'+results.filter(r=>r.ok).length+'/'+results.length+' 成功');
  return {results};
}
export async function subscriptionEpisodes(id,seasonNumber) {
  const item=findItem(id);if(!item)return null;
  if(item.type==='movie')throw Object.assign(new Error('电影没有分集信息'),{statusCode:400});
  const detail=await mediaDetail({type:'tv',id:item.tmdbId});
  const seasons=(detail.seasons || []).filter(s=>Number(s.seasonNumber)>0);
  const selected=Number(seasonNumber || item.seasons?.[0] || seasons.at(-1)?.seasonNumber);
  if(!Number.isInteger(selected)||selected<1||!seasons.some(s=>Number(s.seasonNumber)===selected))throw Object.assign(new Error('请选择有效的季'),{statusCode:400});
  const info=await mediaSeason({id:item.tmdbId,season:selected});
  reconcileDownloads(item);
  const episodes=(info.episodes || []).filter(e=>Number.isInteger(e.episodeNumber)&&e.episodeNumber>0).map(e=>{
    const key=epKey(selected,e.episodeNumber),taskId=item.pendingTasks?.[key],task=taskId?subscribeKeysFactory?.(taskId):null;
    return {key,episode:e.episodeNumber,name:e.name || '',airDate:e.airDate || '',inScope:episodeInScope(item,selected,e.episodeNumber),
      status:item.downloadedKeys.includes(key)?'downloaded':taskId?'downloading':!e.airDate?'unknown':isAired(e.airDate)?'missing':'upcoming',
      task:task?{id:task.id,state:task.state,progress:Number(task.progress)||0}:null};
  });
  return {id,title:item.title,season:selected,seasons,episodes};
}
export async function markSubscriptionEpisodes(id,input) {
  const item=findItem(id);if(!item)return null;
  const keys=selectedIds(input.keys);
  if(keys.some(key=>!/^S\d{2,4}E\d{2,4}$/.test(key)))throw Object.assign(new Error('无效的季集编号'),{statusCode:400});
  if(typeof input.downloaded!=='boolean')throw Object.assign(new Error('请指定已下载或待补'),{statusCode:400});
  const groups=new Map();
  for(const key of keys){const season=Number(key.match(/^S(\d+)E/)[1]);if(!groups.has(season))groups.set(season,[]);groups.get(season).push(key);}
  if(groups.size>1)throw Object.assign(new Error('请每次调整同一季的记录'),{statusCode:400});
  const data=await subscriptionEpisodes(id,[...groups.keys()][0]);
  const valid=new Map(data.episodes.map(e=>[e.key,e]));
  for(const key of keys){if(!valid.has(key))throw Object.assign(new Error('集号不在 TMDB 季信息中'),{statusCode:400});if(item.pendingTasks?.[key])throw Object.assign(new Error('包含已提交的下载任务，请先在下载器处理该任务'),{statusCode:409});}
  if(checks.has(id))throw Object.assign(new Error('正在检查订阅，请等待本轮结束后再修改记录'),{statusCode:409});
  const downloaded=new Set(item.downloadedKeys || []);for(const key of keys){if(input.downloaded)downloaded.add(key);else downloaded.delete(key);}
  item.downloadedKeys=[...downloaded];
  activity(item,'updated','手动'+(input.downloaded?'标记已下载':'恢复待补')+'：'+keys.join('、')+'（仅修改记录，不操作文件）');
  return {item:decorate(item)};
}

/** 调度循环：每 30 秒看一次有没有到期该检查的订阅。 */
/** 用户在界面上确认「替换为更好的版本」。 */
export async function promoteUpgrade(id) {
  const item = findItem(id);
  if (!item || !item.upgrade || !item.upgrade.available) {
    const err = new Error('当前没有可替换的更好版本');
    err.statusCode = 400;
    throw err;
  }
  const cap = capacityCheck(item.upgrade.sizeBytes || 0, Number(((listTasks().stats) || {}).totalSizeBytes) || 0, Number(((listTasks().stats) || {}).remainingBytes) || 0);
  if (!cap.ok) {
    const err = new Error(cap.message);
    err.statusCode = 413;
    throw err;
  }
  const added = await addToEngine(item, item.upgrade);
  if (!added.ok) throw new Error(added.reason);
  trackSubmission(item, ['movie'], added.taskId);
  const title = item.upgrade.title;
  item.upgrade = null;
  activity(item,'submitted',`已加入更好的版本：${title}`);
  return { item: decorate(item) };
}

/** 忽略这次提示，之后不再重复提醒同一档位。 */
export function dismissUpgrade(id) {
  const item = findItem(id);
  if (!item) return null;
  item.upgrade = null;
  activity(item,'updated','已忽略画质升级提示');
  return { item: decorate(item) };
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const items = Array.isArray(store.data.items) ? store.data.items : [];
      for (const item of items) {
        if (!item.enabled) continue;
        if (!getSettings().tmdbApiKey) break;
        const due = !item.nextCheckAt || item.nextCheckAt <= new Date().toISOString();
        if (!due) continue;
        await runCheck(item);
      }
    } catch (err) {
      log.error(`[subs] 调度循环异常: ${err.message}`);
    } finally {
      running = false;
    }
  }, 30000);
  if (timer.unref) timer.unref();
}

/* --------------------------------------------------------------- 导入导出 */

export function exportPayload() {
  const items = Array.isArray(store.data.items) ? store.data.items : [];
  return {
    format: 'wanspilot-subscriptions',
    version: 1,
    exportedAt: shanghaiTimestamp(),
    items: items.map(decorate),
  };
}

export function importPayload(payload) {
  const incoming = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  const items = Array.isArray(store.data.items) ? store.data.items : [];
  let imported = 0;
  let skipped = 0;

  for (const raw of incoming) {
    const tmdbId = Number.parseInt(raw?.tmdbId, 10);
    const type = raw?.type === 'movie' ? 'movie' : 'tv';
    if (!Number.isFinite(tmdbId)) {
      skipped += 1;
      continue;
    }
    if (items.some((it) => it.tmdbId === tmdbId && it.type === type)) {
      skipped += 1;
      continue;
    }
    let rules;try{rules=normalizeRules(raw);if(rules.minSizeGB>Number(raw.maxSizeGB || 30))throw new Error('size');}catch{skipped++;continue;}
    items.push({
      id: newId(),
      ...rules,
      type,
      tmdbId,
      title: String(raw.title || '').trim(),
      originalTitle: String(raw.originalTitle || ''),
      posterPath: String(raw.posterPath || ''),
      year: String(raw.year || ''),
      seasons: type === 'movie' ? null : normalizeSeasons(raw.seasons),
      qualityPreference: normalizeQuality(raw.qualityPreference, getSettings().qualityPreference),
      minSeeders: clamp(raw.minSeeders, 0, 100000, getSettings().minSeeders),
      maxSizeGB: clamp(raw.maxSizeGB, 1, 500, getSettings().maxSizeGB),
      autoDownload: raw.autoDownload !== false,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastCheckAt: null,
      nextCheckAt: new Date().toISOString(),
      lastMessage: '由导入创建，等待首次检查',
      downloadedKeys: Array.isArray(raw.downloadedKeys) ? raw.downloadedKeys : [],
      state: 'idle',
      totalEpisodes: 0,
    });
    activity(items.at(-1),'queued','由导入创建订阅，等待首次检查');
    imported += 1;
  }

  store.data.items = items;
  save();
  log.info('[subs] 导入订阅：新增 '+imported+' 条，跳过 '+skipped+' 条');
  return { imported, skipped };
}

export function shutdownSubscriptions() {
  if (timer) clearInterval(timer);
  timer = null;
  if (store?.pending) store.flush();
}
