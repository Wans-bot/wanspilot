/**
 * 磁盘配额守卫。
 *
 * 两份约束：设置里的「配额上限」（0 表示不限）与真实剩余空间。
 * qB 模式下磁盘在 qB 那台机器上，本容器看不到，用 qB 上报的剩余空间；
 * 还没轮询到（未知）时不做空间判断，只按配额算。
 */
import fs from 'node:fs';
import { resolveDownloadDir, getSettings } from './settings.mjs';
import { cachedFreeBytes } from './engine.mjs';

/** @returns {number} 剩余字节；-1 表示未知 */
function freeBytes(settings = getSettings()) {
  if (String(settings.qbUrl || '').trim()) {
    const bytes = cachedFreeBytes();
    return bytes !== null && Number.isFinite(bytes) && bytes >= 0 ? bytes : -1;
  }
  const dir = resolveDownloadDir(settings);
  if (!dir) return -1;
  try {
    const stat = fs.statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return -1;
  }
}

const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);

/**
 * @param {number} sizeBytes 本次要下载的体积；未知时传 0，只做空间检查
 * @param {number} activeBytes 已在下载中的体积合计
 * @returns {{ok: boolean, freeBytes: number, quotaBytes: number, message: string}}
 */
export function capacityCheck(sizeBytes = 0, activeBytes = 0, remainingBytes = activeBytes) {
  const settings = getSettings();
  const free = freeBytes(settings);
  const quotaBytes = Number(settings.quotaGB) > 0 ? Number(settings.quotaGB) * 1024 ** 3 : 0;
  const need = Math.max(0, Number(sizeBytes) || 0);
  const used = Math.max(0, Number(activeBytes) || 0);
  const reserved = Math.max(0, Number(remainingBytes) || 0);

  if (quotaBytes > 0 && (used >= quotaBytes || need > quotaBytes - used)) {
    return {
      ok: false,
      freeBytes: free,
      quotaBytes,
      message: `配额不够：这个任务约 ${gb(need)} GB，`
        + `配额还剩 ${gb(Math.max(0, quotaBytes - used))} GB（上限 ${settings.quotaGB} GB）。`
        + '可以在设置里调大配额或清理已下载的内容。',
    };
  }
  if (free >= 0 && (free === 0 || need > free - reserved)) {
    return {
      ok: false,
      freeBytes: free,
      quotaBytes,
      message: `空间不够：这个任务约 ${gb(need)} GB，`
        + `可用 ${gb(Math.max(0, free - reserved))} GB。`
        + '可以清理已下载的内容，或到 qBittorrent 里换一个更大的保存目录。',
    };
  }
  return {
    ok: true,
    freeBytes: free,
    quotaBytes,
    message: free >= 0 ? `可用 ${gb(Math.max(0, free - reserved))} GB` : '剩余空间未知（等 qBittorrent 上报）',
  };
}

/** 供健康度看板显示。freeBytes 为 -1 表示未知，0 表示磁盘已满。 */
export function capacityStatus() {
  const settings = getSettings();
  const free = freeBytes(settings);
  return {
    freeBytes: free,
    known: free >= 0,
    quotaGB: Number(settings.quotaGB) || 0,
    downloadDir: resolveDownloadDir(settings),
    source: String(settings.qbUrl || '').trim() ? 'qbittorrent' : 'local',
  };
}
