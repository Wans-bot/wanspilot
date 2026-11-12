/**
 * 公共 BT 索引站的返回解析。
 *
 * 只做「文本 / JSON → 结构化条目」的转换，不发网络请求，方便单元测试：
 * 站点改版时先在解析层兜住，网络可达性由 sources.mjs 的每源错误分别报告。
 * 拿不到种子地址或 info hash 的条目直接丢弃——宁可少一条，也不给出打不开的结果。
 */

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unescapeXml(value) {
  return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body.charAt(0) === '#') {
      const code = body.charAt(1).toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return Object.prototype.hasOwnProperty.call(XML_ENTITIES, body) ? XML_ENTITIES[body] : all;
  });
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

/** 取标签原文：优先 CDATA，其次去掉实体转义；不做去标签，标题要原样。 */
function tagText(block, name) {
  const cdata = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`, 'i').exec(block);
  if (cdata) return cdata[1].trim();
  const plain = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return plain ? unescapeXml(plain[1]).trim() : '';
}

/** 取标签里的可读文字：描述字段常套一层 HTML。 */
function tagPlain(block, name) {
  return stripTags(tagText(block, name)).replace(/\s+/g, ' ').trim();
}

export function splitRssItems(xml) {
  return String(xml || '')
    .split(/<item[\s>]/i)
    .slice(1)
    .map((part) => part.split(/<\/item>/i)[0])
    .filter((part) => part.trim());
}

/** 从「大小: 1.2GB」「Size: 700 MB」这类描述文字里取字节数。 */
export function sizeFromText(text) {
  const match = /(?:大小|体积|size)\s*[:：]?\s*([\d.]+)\s*(bytes?|[kmgt]i?b)\b/i.exec(String(text || ''));
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toLowerCase().charAt(0);
  const power = unit === 't' ? 4 : unit === 'g' ? 3 : unit === 'm' ? 2 : unit === 'k' ? 1 : 0;
  return Math.round(value * 1024 ** power);
}

function seedersFromText(text) {
  const match = /(?:seeders?|seeds|做种)\s*[:：]?\s*(\d+)/i.exec(String(text || ''));
  return match ? Number(match[1]) : null;
}

function leechersFromText(text) {
  const match = /(?:leechers?|peers|下载)\s*[:：]?\s*(\d+)/i.exec(String(text || ''));
  return match ? Number(match[1]) : null;
}

function dateFrom(text) {
  const stamp = Date.parse(String(text || '').trim());
  return Number.isFinite(stamp) ? stamp : 0;
}

function enclosureUrl(block) {
  const match = /<enclosure[^>]*?\burl="([^"]+)"/i.exec(block);
  return match ? unescapeXml(match[1]).trim() : '';
}

function enclosureLength(block) {
  const match = /<enclosure[^>]*?\blength="(\d+)"/i.exec(block);
  return match ? Number(match[1]) : 0;
}

/**
 * 种子链接型 RSS（动漫花园、acg.rip）：条目给的是 .torrent 地址，没有 info hash，
 * 交给上层按 release 机制在真正下载时再解析。
 */
export function parseTorrentFeed(xml) {
  const rows = [];
  for (const block of splitRssItems(xml)) {
    const title = tagText(block, 'title');
    // 只认真正的种子文件地址：动漫花园的 <link> 是详情页，拿它当种子会下载到 HTML
    const torrentUrl = enclosureUrl(block) || tagText(block, 'link');
    if (!title || !/^https?:\/\/[^?]+\.torrent(\?|$)/i.test(torrentUrl)) continue;
    const description = tagPlain(block, 'description');
    rows.push({
      title,
      torrentUrl,
      sizeBytes: enclosureLength(block) || sizeFromText(description),
      seeders: seedersFromText(description),
      leechers: leechersFromText(description),
      publishedAt: dateFrom(tagText(block, 'pubDate')),
    });
  }
  return rows;
}

/** magnet 型 RSS（BT4G 等聚合站）：链接本身就是 magnet，直接拿 info hash。 */
export function parseMagnetFeed(xml) {
  const rows = [];
  for (const block of splitRssItems(xml)) {
    const title = tagText(block, 'title');
    const text = [block, tagText(block, 'link'), tagText(block, 'guid')].join(' ');
    const hash =
      (/urn:btih:([a-fA-F0-9]{40})/i.exec(text) || /btih:([a-fA-F0-9]{40})/i.exec(text) || /<torrent:infoHash>([a-fA-F0-9]{40})<\/torrent:infoHash>/i.exec(block) || [])[1] || '';
    if (!title || !hash) continue;
    const description = tagPlain(block, 'description');
    rows.push({
      title,
      infoHash: hash.toLowerCase(),
      sizeBytes: enclosureLength(block) || sizeFromText(description) || sizeFromText(tagText(block, 'link')),
      seeders: seedersFromText(description),
      leechers: leechersFromText(description),
      publishedAt: dateFrom(tagText(block, 'pubDate')),
    });
  }
  return rows;
}

/**
 * Knaben 聚合站的 JSON 返回。字段名在版本间可能变化，这里同时认几种写法；
 * 整体结构不是对象时返回空数组，让上层报「该源无结果」而不是整次搜索失败。
 */
export function parseKnaben(payload) {
  const list = Array.isArray(payload) ? payload : (payload && (payload.hits || payload.results)) || [];
  if (!Array.isArray(list)) return [];
  const rows = [];
  for (const hit of list) {
    if (!hit || typeof hit !== 'object') continue;
    const title = String(hit.title || hit.name || '').trim();
    const hash = String(hit.hash || hit.infoHash || hit.info_hash || '').toLowerCase();
    if (!title || !/^[a-f0-9]{40}$/.test(hash)) continue;
    const rawDate = hit.date || hit.published || hit.added || 0;
    // 站点有的给 ISO 字符串，有的给秒级时间戳，统一成毫秒
    let stamp = 0;
    if (typeof rawDate === 'number' && rawDate > 0) stamp = rawDate < 1e12 ? Math.round(rawDate * 1000) : rawDate;
    else if (typeof rawDate === 'string' && rawDate) stamp = Number.isFinite(Date.parse(rawDate)) ? Date.parse(rawDate) : 0;
    rows.push({
      title,
      infoHash: hash,
      sizeBytes: Number(hit.bytes || hit.size || 0) || 0,
      seeders: Number.isFinite(Number(hit.seeders)) ? Number(hit.seeders) : null,
      leechers: Number.isFinite(Number(hit.peers ?? hit.leechers)) ? Number(hit.peers ?? hit.leechers) : null,
      publishedAt: stamp,
    });
  }
  return rows;
}
