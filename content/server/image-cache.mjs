import fs from 'node:fs/promises';
import path from 'node:path';

/** Bound only our .img files; leave user files and active temporary files alone. */
export async function pruneImageCache(dir, options = {}) {
  const maxBytes = options.maxBytes ?? 512 * 1024 ** 2;
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 3600_000;
  const now = Date.now();
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return { removed: 0, bytes: 0 }; }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{40}\.img$/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    try { const stat = await fs.stat(file); files.push({ file, size: stat.size, at: stat.mtimeMs }); } catch {}
  }
  files.sort((a, b) => a.at - b.at);
  let bytes = files.reduce((sum, file) => sum + file.size, 0), removed = 0;
  for (const file of files) {
    if (now - file.at < maxAgeMs && bytes <= maxBytes) continue;
    // Do not unlink a file currently being fetched / rewritten.
    if (now - file.at < 60_000) continue;
    try { await fs.unlink(file.file); bytes -= file.size; removed++; } catch {}
  }
  return { removed, bytes };
}
