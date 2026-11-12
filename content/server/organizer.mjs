/**
 * 下载后整理：按片名 / 年份和季度归档，可选写 NFO 与海报。
 * 优先硬链接，跨文件系统时复制；始终保留原始文件与 qB 做种路径。
 * 样本只跳过；重名时不覆盖，重复执行通过 inode / 内容校验跳过。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { JsonStore } from './store.mjs';
import path from 'node:path';
import { DATA_DIR, resolveDownloadDir, getSettings } from './settings.mjs';
import { log } from './log.mjs';
import { subscribe, listTasks } from './engine.mjs';
import * as tmdb from './tmdb.mjs';
import { listSubscriptions } from './subscriptions.mjs';

const SAMPLE_PATTERN = /(^|[.\-_ ])(sample|samples|rarbg|\.url$|\.txt$|\.nfo$)/i;

let processed = new Set();
let organizerStore = null;
const queued = new Set();
const retryAfter = new Map();
let queue = Promise.resolve();
let running = false;
let lastReport = null;

/** 剧集或电影的中文名与年份：优先取订阅里已解析到的信息。 */
function describeTask(task) {
  const subs = listSubscriptions().items || [];
  const name = String(task.name || '');
  const lower = name.toLowerCase();
  const hit = subs.find((item) => {
    const candidates = [item.originalTitle, item.title].filter(Boolean).map((t) => String(t).toLowerCase());
    return candidates.some((title) => title.length >= 3 && lower.includes(title));
  });
  if (hit) {
    return {
      title: hit.title || name,
      originalTitle: hit.originalTitle || '',
      year: hit.year || '',
      tmdbId: hit.tmdbId,
      type: hit.type === 'movie' ? 'movie' : 'tv',
    };
  }
  // 没订阅记录时用种子名兜底，去掉常见的发布后缀
  const cleaned = name
    .replace(/\.(19|20)\d{2}.*$/, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const yearMatch = /(19|20)\d{2}/.exec(name);
  return {
    title: cleaned || name,
    originalTitle: '',
    year: yearMatch ? yearMatch[0] : '',
    tmdbId: 0,
    type: /\bS\d{1,2}(?:E\d+)?\b|\bseason\b|第\s*\d+\s*季/i.test(name) ? 'tv' : 'movie',
  };
}

/** 目标目录名：媒体库认「片名 (年份)」。 */
function targetFolder(info) {
  const title = String(info.title || '未命名').replace(/[\\/:*?"<>|]/g, ' ').trim();
  return info.year ? `${title} (${info.year})` : title;
}

function seasonFolderFrom(fileName) {
  const match = /[Ss](\d{1,2})[Ee]\d{1,3}/.exec(String(fileName || ''));
  return match ? `Season ${String(Number(match[1])).padStart(2, '0')}` : '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 不覆盖已有文件：重名时依次加 (2)、(3)。 */
function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 2; i < 100; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function sameFile(from, to) {
  if (!fs.existsSync(to)) return false;
  const a = fs.statSync(from), b = fs.statSync(to);
  if (a.dev === b.dev && a.ino === b.ino) return true;
  if (a.size !== b.size) return false;
  const digest = async file => {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  };
  return (await digest(from)) === (await digest(to));
}

async function linkFile(from, to) {
  try { await fs.promises.link(from, to); return 'linked'; }
  catch (err) {
    if (err.code !== 'EXDEV' && err.code !== 'EPERM' && err.code !== 'EOPNOTSUPP') throw err;
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    return 'copied';
  }
}

async function writeMetadata(dir, info) {
  if (!info.tmdbId) return { nfo: false, poster: false };
  let detail = null;
  try {
    detail = await tmdb.detail({ type: info.type === 'tv' ? 'tv' : 'movie', id: info.tmdbId });
  } catch (err) {
    log.warn(`[organize] 取 TMDB 资料失败：${err.message}`);
    return { nfo: false, poster: false };
  }

  const xml = info.type === 'tv'
    ? ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<tvshow>',
      `  <title>${escapeXml(detail.title)}</title>`,
      `  <originaltitle>${escapeXml(detail.originalTitle)}</originaltitle>`,
      `  <year>${escapeXml(detail.year)}</year>`,
      `  <plot>${escapeXml(detail.overview)}</plot>`,
      `  <rating>${detail.voteAverage}</rating>`,
      `  <premiered>${escapeXml(detail.releaseDate)}</premiered>`,
      detail.genres.map((g) => `  <genre>${escapeXml(g)}</genre>`).join('\n'),
      `  <uniqueid type="tmdb">${detail.id}</uniqueid>`,
      '</tvshow>'].filter(Boolean).join('\n')
    : ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<movie>',
      `  <title>${escapeXml(detail.title)}</title>`,
      `  <originaltitle>${escapeXml(detail.originalTitle)}</originaltitle>`,
      `  <year>${escapeXml(detail.year)}</year>`,
      `  <plot>${escapeXml(detail.overview)}</plot>`,
      `  <rating>${detail.voteAverage}</rating>`,
      `  <premiered>${escapeXml(detail.releaseDate)}</premiered>`,
      `  <runtime>${detail.runtime || 0}</runtime>`,
      detail.genres.map((g) => `  <genre>${escapeXml(g)}</genre>`).join('\n'),
      `  <uniqueid type="tmdb">${detail.id}</uniqueid>`,
      '</movie>'].filter(Boolean).join('\n');

  const nfoName = info.type === 'tv' ? 'tvshow.nfo' : 'movie.nfo';
  let nfo = false;
  try {
    const dest = path.join(dir, nfoName);
    const tmp = `${dest}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, xml, { flag: 'wx' });
    fs.renameSync(tmp, dest);
    nfo = true;
  } catch (err) {
    log.warn(`[organize] 写 ${nfoName} 失败：${err.message}`);
  }

  let poster = false;
  const posterPath = (detail.posterPath || '').replace(/^\/+/, '');
  if (posterPath) {
    try {
      const image = await tmdb.fetchImage(posterPath, 'w500');
      const dest = path.join(dir, 'poster.jpg');
      const tmp = `${dest}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, image.body, { flag: 'wx' });
      fs.renameSync(tmp, dest);
      poster = true;
    } catch (err) {
      log.warn(`[organize] 写海报失败：${err.message}`);
    }
  }
  return { nfo, poster };
}

function escapeXml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 整理一个任务。返回可写进日志与界面的报告。
 * @param {object} task 任务快照
 * @param {{force?: boolean}} [options]
 */
export async function organizeTask(task, options = {}) {
  const settings = getSettings();
  const root = resolveDownloadDir();
  let sourceRoot = root;
  if (root && settings.qbSavePath && task.savePath) {
    const rel = path.relative(settings.qbSavePath, task.savePath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) sourceRoot = path.join(root, rel);
  }
  const files = Array.isArray(task.files) ? task.files : [];
  const report = { taskId: task.id, name: task.name, moved: 0, samples: 0, folder: '', nfo: false, poster: false, skipped: '', linked: 0, copied: 0, existing: 0, errors: [], planned: [] };
  if (!root) {
    report.skipped = '未挂载下载目录';
    return report;
  }

  if (!files.length) {
    report.skipped = '没有文件';
    return report;
  }
  if (Number(task.progress || 0) < 1) {
    report.skipped = '还没下完';
    return report;
  }
  if (!options.force && !settings.autoOrganize) {
    report.skipped = '未打开自动整理';
    return report;
  }

  const info = describeTask(task);
  const folder = targetFolder(info);
  report.folder = folder;

  for (const file of files) {
    const relative = String(file.path || '').split('/').filter((seg) => seg && seg !== '.' && seg !== '..').join('/');
    const source = path.resolve(sourceRoot, relative);
    if (!source.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(source)) { report.errors.push(`${relative}：文件暂不可读，请检查路径映射`); continue; }

    const realRoot = fs.realpathSync(root);
    const realSource = fs.realpathSync(source);
    if (!realSource.startsWith(realRoot + path.sep)) { report.errors.push('文件路径超出挂载目录'); continue; }
    const baseName = path.basename(relative);
    if (settings.deleteSamples && SAMPLE_PATTERN.test(baseName) && Number(file.sizeBytes || 0) < 50 * 1024 * 1024) {
      report.samples += 1;
      continue;
    }

    const season = info.type === 'tv' ? seasonFolderFrom(baseName) : '';
    const targetDir = season ? path.join(root, folder, season) : path.join(root, folder);
    const intended = path.join(targetDir, baseName);
    let ancestor = targetDir;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const realAncestor = fs.realpathSync(ancestor);
    if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) {
      report.errors.push('目标目录超出挂载目录'); continue;
    }
    if (fs.existsSync(intended) && (fs.lstatSync(intended).isSymbolicLink() || await sameFile(source, intended))) {
      if (fs.lstatSync(intended).isSymbolicLink()) report.errors.push('目标文件是符号链接，已跳过');
      else report.existing += 1;
      continue;
    }
    const target = uniquePath(intended);
    report.planned.push({ source: relative, target: path.relative(root, target), action: '硬链接（跨盘保留原件复制）' });
    if (options.dryRun) continue;
    try {
      ensureDir(targetDir);
      const method = await linkFile(source, target);
      report[method] += 1;
      report.moved += 1;
    } catch (err) { report.errors.push(`${baseName}：${err.message}`); }
  }

  if (settings.writeNfo && !options.dryRun && (report.moved || report.existing)) {
    const meta = await writeMetadata(path.join(root, folder), info);
    report.nfo = meta.nfo;
    report.poster = meta.poster;
  }

  // 清掉整理后留下的空目录（只删下载目录内的）
  // qB 原文件及目录完整保留，整理不会中断做种。
  log.info(`[organize] ${report.name} → ${folder}：硬链接 ${report.linked} 个，复制 ${report.copied} 个，跳过样本 ${report.samples} 个`);
  return report;
}

function pruneEmptyDirs(root) {
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
    }
    if (dir === path.resolve(root)) return;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (err) {
      // 删不掉就算了，不影响结果
    }
  };
  walk(root, 0);
}

/** 任务下完就自动整理；已经在队列里的不重复处理。 */
export function initOrganizer() {
  organizerStore = new JsonStore(path.join(DATA_DIR, 'organizer.json'), { processed: [] });
  processed = new Set(organizerStore.data.processed || []);
  subscribe((snapshot) => {
    if (!getSettings().autoOrganize) return;
    for (const task of snapshot?.items || []) {
      if (Number(task.progress || 0) < 1 || !['completed', 'seeding'].includes(task.state)) continue;
      if (processed.has(task.id) || queued.has(task.id) || (retryAfter.get(task.id) || 0) > Date.now()) continue;
      if (!task.files?.length) continue;
      queued.add(task.id);
      queue = queue.then(async () => {
        const report = await organizeTask(task);
        if (!report.skipped && !report.errors.length && (report.moved || report.existing)) {
          processed.add(task.id);
          organizerStore.data.processed = [...processed];
          organizerStore.flush();
        } else retryAfter.set(task.id, Date.now() + 60_000);
      }).catch(err => {
        retryAfter.set(task.id, Date.now() + 60_000);
        log.warn(`[organize] 自动整理失败，将重试：${err.message}`);
      }).finally(() => queued.delete(task.id));
    }
  });
}

/** 手动整理所有已完成的任务。 */
export async function organizeAll(options = {}) {
  await queue;
  if (running) return { running: true, reports: [] };
  running = true;
  try {
    const tasks = (listTasks().items || []).filter((task) => Number(task.progress || 0) >= 1);
    const reports = [];
    for (const task of tasks) {
      reports.push(await organizeTask(Object.assign({}, task, { files: task.files || [] }), { force: true, dryRun: Boolean(options.dryRun) }));
    }
    if (!options.dryRun) lastReport = { at: new Date().toISOString(), reports };
    return { running: false, reports };
  } finally {
    running = false;
  }
}

export function organizerStatus() {
  const settings = getSettings();
  return {
    mode: 'hardlink-or-copy',
    autoOrganize: Boolean(settings.autoOrganize),
    writeNfo: Boolean(settings.writeNfo),
    deleteSamples: Boolean(settings.deleteSamples),
    processed: processed.size,
    last: lastReport,
  };
}
