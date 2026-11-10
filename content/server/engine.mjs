/**
 * 下载层：把任务交给用户自己的 qBittorrent，wanspilot 只做影视墙 + 订阅 + 整理。
 *
 * 为什么不是「每次请求都现问 qB」：
 * 前端任务页用 SSE 每 2 秒拿一次快照，订阅调度与整理又都是同步调用列表，
 * 所以这里维护一份内存快照，由后台轮询（默认 2 秒）从 qB 拉取后统一更新。
 * 对外导出的函数全部保持同步，index.mjs / subscriptions.mjs / organizer.mjs 不用改。
 *
 * 状态映射的坑：qB 的 uploading 既可能是刚下完做种，也可能是还没下完在传出。
 * 判断顺序固定为 错误 → 元数据 → 暂停 → 做种 → 排队 → 下载中，
 * 「暂停」优先于「已完成」，避免暂停后界面还显示绿色的已完成（上一版踩过）。
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonStore } from './store.mjs';
import { log } from './log.mjs';
import { getSettings } from './settings.mjs';
import { clientFromSettings } from './qbittorrent.mjs';

const POLL_MS = Math.max(1000, Number.parseInt(process.env.WP_QB_POLL_MS || '2000', 10));
/** 刚添加、qB 还没列出来的宽限期 */
const PENDING_GRACE_MS = 60_000;
/** 文件清单变化不频繁，按任务缓存一分钟，避免每轮都打 qB */
const FILES_TTL_MS = 60_000;
/** 剩余空间变化慢，30 秒问一次就够 */
const FREE_SPACE_TTL_MS = 30_000;

let qb = null;
let taskStore = null;
let pollTimer = null;
let polling = false;
let lastPollOk = false;
let lastError = '';
let freeBytes = null;
let freeBytesAt = 0;
let filesCursor = 0;

/** hash(lowercase) -> record，落盘在 /data/torrents.json */
const records = new Map();
/** hash -> TaskItem，前端读的就是这份快照 */
let items = new Map();
/** hash -> { at, files } */
const filesCache = new Map();
const listeners = new Set();

/* --------------------------------------------------------------- 生命周期 */

export function initEngine(dataDir) {
  taskStore = new JsonStore(path.join(dataDir, 'torrents.json'), { items: [] }, { debounceMs: 500 });
  const saved = Array.isArray(taskStore.data.items) ? taskStore.data.items : [];
  for (const raw of saved) {
    const record = normalizeRecord(raw);
    if (record) records.set(record.hash, record);
  }
  log.info(`[engine] 载入 ${records.size} 条历史任务记录，下载由 qBittorrent 负责`);
  reconfigure();
  return qb;
}

/**
 * 设置改动后重建客户端。设置页保存时调用，避免必须重启容器。
 * 地址/账号变化才清缓存，否则只重建对象。
 */
export function reconfigure() {
  const settings = getSettings();
  const next = clientFromSettings(settings);
  const fingerprint = (client) => (client ? `${client.baseUrl}|${client.username}|${client.password}` : '');
  const changed = fingerprint(next) !== fingerprint(qb);
  qb = next;
  if (!changed) {
    ensurePolling();
    return qb;
  }
  filesCache.clear();
  freeBytes = null;
  freeBytesAt = 0;
  lastPollOk = false;
  lastError = '';
  if (!qb) {
    log.info('[engine] 未配置 qBittorrent，下载功能不可用');
    items.clear();
    broadcast();
    return qb;
  }
  log.info(`[engine] qBittorrent ${qb.baseUrl}（${qb.authMode === 'password' ? '账号登录' : '免认证直连'}）`);
  ensurePolling();
  void pollOnce();
  return qb;
}

export function shutdownEngine() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  try {
    if (taskStore) taskStore.flush();
  } catch (err) {
    log.warn(`[engine] 退出前保存任务记录失败：${err.message}`);
  }
}

function ensurePolling() {
  if (pollTimer || !qb?.configured) return;
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
  if (pollTimer.unref) pollTimer.unref();
}

/** 兼容旧入口：index.mjs 启动时调一次。 */
export function startTicker() {
  ensurePolling();
}

/* ------------------------------------------------------------------ 轮询 */

async function pollOnce() {
  if (polling || !qb?.configured) return;
  polling = true;
  try {
    const hashes = [...records.keys()];
    if (!hashes.length) {
      if (items.size) items.clear();
      lastPollOk = true;
      lastError = '';
      await refreshFreeSpace();
      return;
    }
    const list = await qb.torrentsInfo(hashes);
    const byHash = new Map();
    for (const raw of list) {
      const hash = String(raw.hash || '').toLowerCase();
      if (hash) byHash.set(hash, raw);
    }

    const next = new Map();
    const now = Date.now();
    for (const [hash, record] of [...records]) {
      const raw = byHash.get(hash);
      if (!raw) {
        // qB 里已经没有这个任务：宽限期内保留乐观项，否则认为用户在 qB 里删掉了
        if (now - record.addedOnMs < PENDING_GRACE_MS) {
          next.set(hash, items.get(hash) || optimistic(record));
          continue;
        }
        records.delete(hash);
        filesCache.delete(hash);
        continue;
      }
      record.pending = false;
      record.error = '';
      const item = mapTask(raw, record);
      if (item.name) record.name = item.name;
      if (item.savePath) record.savePath = item.savePath;
      next.set(hash, item);
    }
    items = next;

    lastPollOk = true;
    lastError = '';
    // 恢复成功就把「失败已记录」标记清掉，下次再挂还能记一条
    if (qb) qb._lastFailureLogged = false;
    await refreshFreeSpace();
    await refreshNextFiles();
    saveRecords();
    broadcast();
  } catch (err) {
    lastPollOk = false;
    lastError = err?.message || String(err);
    // 每轮都刷屏没意义，只在状态翻转时记一条
    if (!qb?._lastFailureLogged) {
      log.warn(`[engine] 同步 qBittorrent 失败：${lastError}`);
      if (qb) qb._lastFailureLogged = true;
    }
    broadcast();
  } finally {
    polling = false;
  }
}

async function refreshFreeSpace() {
  if (Date.now() - freeBytesAt < FREE_SPACE_TTL_MS) return;
  const value = await qb.freeSpace();
  freeBytesAt = Date.now();
  if (value !== null) freeBytes = value;
}

/**
 * 文件清单只对「还没缓存」或「已过期」的任务拉，每轮最多一个，
 * 轮转着补齐，避免一次性把 qB 打满。
 */
async function refreshNextFiles() {
  const candidates = [...items.entries()].filter(([hash, item]) => {
    const cached = filesCache.get(hash);
    if (cached && Date.now() - cached.at < FILES_TTL_MS) return false;
    return item.state !== 'queued' && item.state !== 'error';
  });
  if (!candidates.length) return;
  filesCursor %= candidates.length;
  const [hash, item] = candidates[filesCursor];
  filesCursor += 1;
  try {
    const files = await qb.torrentsFiles(hash);
    filesCache.set(hash, {
      at: Date.now(),
      files: files.slice(0, 200).map((f) => ({
        path: String(f.name || ''),
        sizeBytes: Number(f.size || 0),
        progress: round3(f.progress),
      })),
    });
    // 只更新文件部分，其余字段保持上一轮 qB 的权威值
    items.set(hash, { ...item, files: filesCache.get(hash).files });
  } catch (err) {
    log.warn(`[engine] 读取任务文件清单失败 ${hash}：${err.message}`);
  }
}

/* ------------------------------------------------------------------ 添加 */

/**
 * @param {{magnet?: string, infoHash?: string, torrentBase64?: string}} input
 * @param {string} [savePath] qB 视角的保存目录
 */
export function addTask(input, savePath) {
  const parsed = parseInput(input);
  if (!qb?.configured) {
    const err = new Error('还没有配置 qBittorrent。请先在设置页填写 qB 的地址，再添加下载。');
    err.statusCode = 503;
    throw err;
  }
  if (records.has(parsed.hash)) {
    const err = new Error('该任务已在下载列表中');
    err.statusCode = 409;
    throw err;
  }

  const record = {
    id: parsed.hash,
    hash: parsed.hash,
    magnet: parsed.magnet,
    name: '',
    savePath: String(savePath || ''),
    addedAt: new Date().toISOString(),
    addedOnMs: Date.now(),
    pending: true,
    error: '',
  };
  records.set(parsed.hash, record);
  items.set(parsed.hash, optimistic(record));
  saveRecords();
  broadcast();

  void submit(record, parsed);
  return items.get(parsed.hash);
}

async function submit(record, parsed) {
  const settings = getSettings();
  try {
    await qb.addTorrent({
      magnet: parsed.magnet,
      torrent: parsed.torrent,
      savePath: String(settings.qbSavePath || '').trim() || undefined,
      category: String(settings.qbCategory || '').trim() || undefined,
    });
    log.info(`[engine] 已提交到 qBittorrent：${record.hash}`);
    record.pending = false;
    saveRecords();
    await pollOnce();
  } catch (err) {
    record.pending = false;
    record.error = err.message;
    const current = items.get(record.hash) || optimistic(record);
    items.set(record.hash, { ...current, state: 'error', error: err.message, rateDown: 0, rateUp: 0 });
    log.error(`[engine] 提交到 qBittorrent 失败：${err.message}`);
    saveRecords();
    broadcast();
  }
}

/* ------------------------------------------------------------- 操作与查询 */

export function listTasks() {
  const list = [...items.values()];
  list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  const stats = {
    active: list.filter((t) => ['downloading', 'fetching-metadata', 'queued', 'seeding'].includes(t.state)).length,
    completed: list.filter((t) => Number(t.progress || 0) >= 1 && t.state !== 'error').length,
    rateDown: list.reduce((sum, t) => sum + Number(t.rateDown || 0), 0),
    rateUp: list.reduce((sum, t) => sum + Number(t.rateUp || 0), 0),
    totalSizeBytes: list.reduce((sum, t) => sum + Number(t.sizeBytes || 0), 0),
  };
  return { items: list, stats };
}

export function getTask(id) {
  return items.get(String(id || '').toLowerCase()) || null;
}

export function pauseTask(id) {
  return mutate(id, (item) => ({ ...item, state: 'paused', rateDown: 0, rateUp: 0 }), (hash) => qb.pause(hash));
}

export function resumeTask(id) {
  return mutate(id, (item) => ({ ...item, state: 'downloading' }), (hash) => qb.resume(hash));
}

/** 删除任务；deleteFiles 为真时同时删除 qB 那边磁盘上的文件。 */
export function removeTask(id, deleteFiles = false) {
  const hash = String(id || '').toLowerCase();
  const item = items.get(hash);
  if (!item) return false;
  const record = records.get(hash);
  items.delete(hash);
  records.delete(hash);
  filesCache.delete(hash);
  saveRecords();
  broadcast();
  if (!qb?.configured) return true;
  void qb.deleteTorrents(hash, deleteFiles).then(() => pollOnce()).catch((err) => {
    log.error(`[engine] 删除 qBittorrent 任务失败：${err.message}`);
    if (record) {
      record.error = err.message;
      records.set(hash, record);
      items.set(hash, { ...item, state: 'error', error: `删除失败：${err.message}` });
      saveRecords();
      broadcast();
    }
  });
  return true;
}

/** 乐观更新 + 异步下发；失败回滚成 error 状态，不让界面假装成功。 */
function mutate(id, apply, call) {
  const hash = String(id || '').toLowerCase();
  const item = items.get(hash);
  if (!item) return null;
  const next = apply(item);
  items.set(hash, next);
  broadcast();
  if (!qb?.configured) return next;
  void call(hash).then(() => pollOnce()).catch((err) => {
    const current = items.get(hash) || item;
    items.set(hash, { ...current, state: 'error', error: err.message });
    log.error(`[engine] 操作 qBittorrent 失败：${err.message}`);
    broadcast();
  });
  return next;
}

export function engineReady() {
  return Boolean(qb?.configured) && lastPollOk;
}

export function engineStats() {
  return {
    ready: engineReady(),
    tasks: items.size,
    downloadDir: qb?.baseUrl || null,
    lastError,
  };
}

/** capacity.mjs 用：qB 所在磁盘的剩余空间（未知时 null）。 */
export function cachedFreeBytes() {
  return freeBytes;
}

/* ------------------------------------------------------------- 事件广播 */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function broadcast() {
  if (!listeners.size) return;
  const payload = listTasks();
  for (const fn of [...listeners]) {
    try {
      fn(payload);
    } catch {
      listeners.delete(fn);
    }
  }
}

/* --------------------------------------------------------------- 内部工具 */

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hash = String(raw.hash || raw.infoHash || raw.id || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) {
    // 早期记录可能是随机 id，没有 hash 就无法与 qB 对齐，直接丢弃
    return null;
  }
  return {
    id: hash,
    hash,
    magnet: String(raw.magnet || ''),
    name: String(raw.name || ''),
    savePath: String(raw.savePath || ''),
    addedAt: String(raw.addedAt || new Date().toISOString()),
    addedOnMs: Number(raw.addedOnMs) || Date.now(),
    pending: false,
    error: '',
  };
}

function saveRecords() {
  if (!taskStore) return;
  taskStore.data.items = [...records.values()].map((record) => ({
    hash: record.hash,
    magnet: record.magnet,
    name: record.name,
    savePath: record.savePath,
    addedAt: record.addedAt,
    addedOnMs: record.addedOnMs,
  }));
  taskStore.save();
}

/** 乐观快照：刚提交、qB 还没回话时先让界面有东西。 */
function optimistic(record) {
  return {
    id: record.hash,
    infoHash: record.hash,
    name: record.name || '正在提交到 qBittorrent…',
    magnet: record.magnet,
    sizeBytes: 0,
    downloadedBytes: 0,
    progress: 0,
    state: record.error ? 'error' : 'queued',
    rateDown: 0,
    rateUp: 0,
    peers: 0,
    etaSeconds: null,
    addedAt: record.addedAt,
    completedAt: null,
    savePath: record.savePath,
    error: record.error || '',
    files: filesCache.get(record.hash)?.files || [],
  };
}

/** qB 的 state 字符串 → 前端认识的七种状态。顺序不能换。 */
function mapState(raw, progress) {
  const state = String(raw.state || '');
  if (state === 'error' || state === 'missingFiles') return 'error';
  if (state === 'metaDL' || state === 'forcedMetaDL') return 'fetching-metadata';
  if (state.startsWith('paused') || state.startsWith('stopped')) return 'paused';
  if (state.startsWith('uploading') || state === 'stalledUP' || state === 'queuedUP' || state === 'forcedUP') return 'seeding';
  if (state.startsWith('queued') || state === 'allocating' || state === 'checkingResumeData') return 'queued';
  if (state.startsWith('downloading') || state.startsWith('forcedDL') || state.startsWith('stalledDL')
    || state.startsWith('checking') || state === 'moving') return 'downloading';
  return progress >= 1 ? 'seeding' : 'downloading';
}

function mapTask(raw, record) {
  const hash = String(raw.hash || record.hash).toLowerCase();
  const progress = round3(raw.progress);
  const eta = Number(raw.eta);
  const cachedFiles = filesCache.get(hash);
  return {
    id: hash,
    infoHash: hash,
    name: String(raw.name || record.name || '正在获取元数据…'),
    magnet: record.magnet || '',
    sizeBytes: Number(raw.size || raw.total_size || 0),
    downloadedBytes: Number(raw.downloaded || 0),
    progress,
    state: mapState(raw, progress),
    rateDown: Number(raw.dlspeed || 0),
    rateUp: Number(raw.upspeed || 0),
    peers: Number(raw.num_leechs ?? raw.num_complete ?? 0) || 0,
    etaSeconds: Number.isFinite(eta) && eta > 0 && eta < 8640000 ? Math.round(eta) : null,
    addedAt: isoFromSeconds(raw.added_on, record.addedAt),
    completedAt: isoFromSeconds(raw.completion_on, null),
    savePath: String(raw.content_path || raw.save_path || record.savePath || ''),
    error: raw.state === 'missingFiles'
      ? '文件已不在磁盘上（可能被移动或删除）'
      : (raw.state === 'error' ? (record.error || 'qBittorrent 报错') : ''),
    files: (cachedFiles?.files || []).slice(),
  };
}


function isoFromSeconds(value, fallback) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  return fallback || null;
}

function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, 0), 1) * 1000) / 1000;
}

/* ---------------------------------------------------------- 输入解析 */

/** @returns {{hash: string, magnet: string, torrent?: Buffer}} */
function parseInput(input) {
  const magnet = String(input?.magnet || '').trim();
  const base64 = String(input?.torrentBase64 || '').trim();
  let infoHash = String(input?.infoHash || '').trim().toLowerCase();

  if (magnet) {
    const match = /xt=urn:btih:([a-z0-9]{32,40})/i.exec(magnet);
    if (match) infoHash = normalizeInfoHash(match[1]);
    if (!/^[a-f0-9]{40}$/.test(infoHash)) {
      throw badRequest('磁力链接里没有可识别的 info hash');
    }
    return { hash: infoHash, magnet };
  }

  if (base64) {
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      throw badRequest('种子文件内容不是合法的 base64');
    }
    const parsedHash = infoHashFromTorrent(buffer);
    if (!parsedHash) throw badRequest('种子文件无法解析出 info hash');
    return { hash: parsedHash, magnet: `magnet:?xt=urn:btih:${parsedHash}`, torrent: buffer };
  }

  const hash = normalizeInfoHash(infoHash);
  if (/^[a-f0-9]{40}$/.test(hash)) {
    return { hash, magnet: `magnet:?xt=urn:btih:${hash}` };
  }
  throw badRequest('请提供磁力链接、信息哈希或种子文件');
}

/** base32 的 btih 也转成 hex，否则去重对不上。 */
function normalizeInfoHash(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(raw)) return raw;
  if (/^[a-z2-7]{32}$/.test(raw)) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = '';
    for (const ch of raw) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex.slice(0, 40);
  }
  return raw;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * 从 .torrent 里算 info hash：只需要定位顶层 "info" 字典的原始字节区间，
 * 所以写一个最小的 bencode 跳读器，不引第三方库。
 */
function infoHashFromTorrent(buffer) {
  try {
    if (buffer[0] !== 0x64) return '';
    let p = 1;
    while (p < buffer.length && buffer[p] !== 0x65) {
      const key = readBencodeString(buffer, p);
      if (!key) return '';
      const valueStart = key.next;
      const valueEnd = skipBencodeValue(buffer, valueStart);
      if (valueEnd < 0) return '';
      if (key.value === 'info') {
        return crypto.createHash('sha1').update(buffer.subarray(valueStart, valueEnd)).digest('hex');
      }
      p = valueEnd;
    }
    return '';
  } catch {
    return '';
  }
}

function readBencodeString(buffer, start) {
  let p = start;
  let len = 0;
  while (p < buffer.length && buffer[p] >= 0x30 && buffer[p] <= 0x39) {
    len = len * 10 + (buffer[p] - 0x30);
    p += 1;
  }
  if (buffer[p] !== 0x3a) return null;
  p += 1;
  return { value: buffer.subarray(p, p + len).toString('latin1'), next: p + len };
}

function skipBencodeValue(buffer, start) {
  const ch = buffer[start];
  if (ch === 0x69) { // i<int>e
    const end = buffer.indexOf(0x65, start);
    return end < 0 ? -1 : end + 1;
  }
  if (ch === 0x6c || ch === 0x64) { // l...e / d...e
    let p = start + 1;
    while (p < buffer.length && buffer[p] !== 0x65) {
      p = skipBencodeValue(buffer, p);
      if (p < 0) return -1;
    }
    return p + 1;
  }
  const str = readBencodeString(buffer, start);
  return str ? str.next : -1;
}
