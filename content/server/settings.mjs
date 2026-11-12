/**
 * 设置项：读写、校验、路径解析与自检。
 * 设置保存在 /data/settings.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JsonStore } from './store.mjs';
import { log } from './log.mjs';
import { normalizeBaseUrl, isLoopbackUrl } from './qbittorrent.mjs';

export const DATA_DIR = process.env.WP_DATA_DIR || '/data';
export const DOWNLOAD_ROOT = process.env.WP_DOWNLOAD_DIR || '/downloads';
export const CACHE_DIR = process.env.WP_CACHE_DIR || '/cache/wanspilot';

/**
 * 默认值说明：
 * - tmdbApiBase 用 api.tmdb.org：实测 api.themoviedb.org 在受限网络下不可达，
 *   api.tmdb.org 可达且返回真实 TMDB 响应。
 * - tmdbImageBase 用 Bunny CDN 直连域名：实测 image.tmdb.org 的 TLS 被重置，
 *   而它背后的 tmdb-image-prod.b-cdn.net 可达。
 * 两者都可在设置页改，用户也可以指向商店的「TMDB Proxy」应用。
 */
export const DEFAULT_SETTINGS = {
  tmdbApiKey: process.env.WP_TMDB_API_KEY || '',
  tmdbApiBase: 'https://api.tmdb.org/3',
  tmdbImageBase: 'https://tmdb-image-prod.b-cdn.net/t/p',
  proxy: '',
  // 留空 = 文件直接落在 $WP_DOWNLOAD_DIR 下（Docker 版默认）；填写则当作其下的子目录。
  downloadDir: '',
  // qBittorrent：wanspilot 自己不下载，任务全部交给用户已有的 qB。
  // 部署时不预置任何 qB 参数，全部由用户在设置页填写后落在这里。
  // 地址留空 = 下载功能关闭；用户名留空 = 免认证直连（qB 开了「本地主机跳过认证」时）。
  // 地址必须填 NAS 的局域网 IP，127.0.0.1 / localhost 会被拒绝（那是容器自己）。
  qbUrl: '',
  qbUsername: '',
  qbPassword: '',
  // 传给 torrents/add 的 savepath（qB 视角），留空表示用 qB 自己的默认保存目录
  qbSavePath: '',
  // 与 qbSavePath 等价的容器内路径，整理功能靠它读文件；留空表示没挂载下载目录
  qbLocalPath: '',
  qbCategory: 'wanspilot',
  qualityPreference: '1080p',
  minSeeders: 5,
  maxSizeGB: 30,
  checkIntervalMinutes: 60,
  autoDownload: true,
  theme: 'dark',
  // 下载与整理
  quotaGB: 0,
  autoOrganize: false,
  writeNfo: false,
  deleteSamples: true,
};

const QUALITY_VALUES = new Set(['any', '720p', '1080p', '2160p']);

let store = null;

export function initSettings() {
  store = new JsonStore(path.join(DATA_DIR, 'settings.json'), DEFAULT_SETTINGS, {
    debounceMs: 100,
  });

  // 老版本可能通过环境变量写进过 127.0.0.1 / localhost：容器里的回环地址指向自己，
  // 连不到 NAS 上的 qB。这里直接清空，让用户到设置页重新填局域网 IP。
  const savedQbUrl = String(store.data.qbUrl || '').trim();
  if (savedQbUrl && isLoopbackUrl(savedQbUrl)) {
    store.data = { ...store.data, qbUrl: '' };
    store.save();
    log.warn(`[settings] 已清空配置里无效的 qB 地址「${savedQbUrl}」：容器内的 127.0.0.1/localhost 指向 wanspilot 自己，请到设置页填 NAS 的局域网 IP`);
  }
  // 保证下载目录存在，否则下载引擎第一次抓取元数据就会失败。
  try {
    // qB 模式下本地目录可能没挂载，只有解析出具体路径才建
    const dir = resolveDownloadDir();
    if (dir) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    log.error(`[settings] 创建下载目录失败: ${err.message}`);
  }
  return getSettings();
}

/** 返回设置的副本，调用方改它不会影响存储。 */
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.data };
}

export function publicSettings() {
  const { tmdbApiKey, qbPassword, ...safe } = getSettings();
  return { ...safe, tmdbApiKeySet: Boolean(tmdbApiKey), qbPasswordSet: Boolean(qbPassword) };
}

export function flushSettings() { if (store?.pending) store.flush(); }

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** qB 与容器视角的目录都必须是以 / 开头的绝对路径，不接受 .. 跳出去。 */
function absolutePath(value, label) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const segments = raw.split('/').filter((seg) => seg && seg !== '.');
  if (!raw.startsWith('/') || segments.includes('..')) {
    const err = new Error(`${label}必须是以 / 开头的容器内绝对路径`);
    err.statusCode = 400;
    throw err;
  }
  return `/${segments.join('/')}`;
}

/**
 * 只接受已知字段，并对每个字段做类型与范围校验。
 * 未出现的字段保持原值；显式传空字符串表示清空该字段。
 */
export function updateSettings(patch) {
  if (!patch || typeof patch !== 'object') return getSettings();
  const next = { ...store.data };

  if ('tmdbApiKey' in patch) {
    next.tmdbApiKey = String(patch.tmdbApiKey ?? '').trim();
  }
  if ('tmdbApiBase' in patch) {
    const v = String(patch.tmdbApiBase ?? '').trim().replace(/\/+$/, '');
    next.tmdbApiBase = v || DEFAULT_SETTINGS.tmdbApiBase;
  }
  if ('tmdbImageBase' in patch) {
    const v = String(patch.tmdbImageBase ?? '').trim().replace(/\/+$/, '');
    next.tmdbImageBase = v || DEFAULT_SETTINGS.tmdbImageBase;
  }
  if ('proxy' in patch) {
    const v = String(patch.proxy ?? '').trim();
    if (v && !/^(https?|socks[45]?):\/\/[^\s]+$/i.test(v)) {
      const err = new Error('代理地址格式不正确，应形如 http://127.0.0.1:7890');
      err.statusCode = 400;
      throw err;
    }
    next.proxy = v;
  }
  if ('downloadDir' in patch) {
    let v = String(patch.downloadDir ?? '').trim().replace(/^\/+/, '');
    // 去掉可能的盘符式前缀与 .. ，保证始终落在 /downloads 之下。
    v = v.split('/').filter((seg) => seg && seg !== '.' && seg !== '..').join('/');
    next.downloadDir = v;
  }
  if ('qualityPreference' in patch) {
    const v = String(patch.qualityPreference ?? '').trim();
    if (!QUALITY_VALUES.has(v)) {
      const err = new Error('画质偏好取值不合法');
      err.statusCode = 400;
      throw err;
    }
    next.qualityPreference = v;
  }
  if ('minSeeders' in patch) {
    next.minSeeders = clampInt(patch.minSeeders, 0, 100000, DEFAULT_SETTINGS.minSeeders);
  }
  if ('maxSizeGB' in patch) {
    next.maxSizeGB = clampInt(patch.maxSizeGB, 1, 500, DEFAULT_SETTINGS.maxSizeGB);
  }
  if ('checkIntervalMinutes' in patch) {
    next.checkIntervalMinutes = clampInt(patch.checkIntervalMinutes, 5, 1440, DEFAULT_SETTINGS.checkIntervalMinutes);
  }
  if ('autoDownload' in patch) {
    next.autoDownload = Boolean(patch.autoDownload);
  }
  if ('qbUrl' in patch) {
    // normalizeBaseUrl 会补全 http://，并拒绝 127.0.0.1 / localhost —— 容器内的回环地址
    // 指向 wanspilot 自己，永远连不到 NAS 上的 qB。校验失败抛的是带 400 的 QBError。
    next.qbUrl = normalizeBaseUrl(patch.qbUrl);
  }
  if ('qbUsername' in patch) next.qbUsername = String(patch.qbUsername ?? '').trim();
  // 密码允许包含空格，只去首尾不可见字符
  if ('qbPassword' in patch) next.qbPassword = String(patch.qbPassword ?? '');
  if ('qbSavePath' in patch) next.qbSavePath = absolutePath(patch.qbSavePath, 'qB 保存目录');
  if ('qbLocalPath' in patch) next.qbLocalPath = absolutePath(patch.qbLocalPath, '本地挂载路径');
  if ('qbCategory' in patch) {
    const v = String(patch.qbCategory ?? '').trim().replace(/[\\/\s]+/g, '-').slice(0, 64);
    next.qbCategory = v || DEFAULT_SETTINGS.qbCategory;
  }
  if ('quotaGB' in patch) {
    next.quotaGB = clampInt(patch.quotaGB, 0, 100000, DEFAULT_SETTINGS.quotaGB);
  }
  if ('autoOrganize' in patch) {
    next.autoOrganize = Boolean(patch.autoOrganize);
  }
  if ('writeNfo' in patch) {
    next.writeNfo = Boolean(patch.writeNfo);
  }
  if ('deleteSamples' in patch) {
    next.deleteSamples = Boolean(patch.deleteSamples);
  }
  if ('theme' in patch) {
    // 只有白天与夜间两态；历史值 auto 落到夜间，前端会在首屏把它落成确定值
    const v = String(patch.theme ?? '').trim();
    next.theme = v === 'light' || v === 'dark' ? v : 'dark';
  }

  if ('downloadDir' in patch) {
    try {
      const dir = resolveDownloadDir({ ...DEFAULT_SETTINGS, ...next });
      if (dir) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      log.error(`[settings] 创建下载目录失败: ${err.message}`);
      const wrapped = new Error(`下载目录不可用: ${err.message}`);
      wrapped.statusCode = 400;
      throw wrapped;
    }
  }
  const previous = store.data;
  store.data = next;
  try { store.flush(); } catch (err) {
    store.data = previous;
    const wrapped = new Error(`保存失败，请检查数据目录权限或磁盘空间：${err.message}`);
    wrapped.statusCode = 507;
    throw wrapped;
  }
  return getSettings();
}

/** 把设置里的相对目录解析成容器内的绝对路径。 */
/**
 * 下载目录解析。
 * - qB 模式且配置了 qbLocalPath：返回该绝对路径（= qB 的 savepath 在本容器的挂载点）
 * - qB 模式但没挂本地目录：返回空串，表示「只管任务，不碰文件」，调用方必须判空
 * - 没有配 qB（历史行为）：/downloads + 相对目录
 */
export function resolveDownloadDir(settings = getSettings()) {
  if (String(settings.qbUrl || '').trim()) {
    return String(settings.qbLocalPath || '').trim();
  }
  const rel = String(settings.downloadDir || '')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
  return path.join(DOWNLOAD_ROOT, rel);
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.wm-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function downloadDirStatus() {
  const settings = getSettings();
  const dir = resolveDownloadDir(settings);
  if (String(settings.qbUrl || '').trim()) {
    if (!dir) {
      return { ok: true, dir: '', message: '下载交给 qBittorrent；未挂载下载目录，自动整理不可用' };
    }
    const ok = isWritable(dir);
    return {
      ok,
      dir,
      message: ok
        ? `${dir} 可写（整理与配额检查用）`
        : `${dir} 不可写：容器没有挂到该路径，自动整理会跳过`,
    };
  }
  const ok = isWritable(dir);
  return {
    ok,
    dir,
    message: ok ? `${dir} 可写` : `${dir} 不可写，请检查下载目录设置`,
  };
}

export function cacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // 缓存目录不可用时后端会退化为不缓存
  }
  return CACHE_DIR;
}
