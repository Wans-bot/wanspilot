import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKnaben, parseMagnetFeed, parseTorrentFeed, sizeFromText } from '../../content/server/feed.mjs';

const DMHY = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>动漫花园</title>
<item>
  <title><![CDATA[[Lilith-Raws] 药屋少女的呢喃 - 12 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]]]></title>
  <link>https://share.dmhy.org/topics/view/600000_12.html</link>
  <description><![CDATA[<p>大小: 1.2GB</p><p>做种: 42</p>]]></description>
  <pubDate>Tue, 12 Nov 2026 10:00:00 +0800</pubDate>
  <enclosure url="https://share.dmhy.org/topics/download/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.torrent" length="1288490188" type="application/x-bittorrent"/>
</item>
<item>
  <title>没有种子链接的条目</title>
  <link>https://share.dmhy.org/topics/view/600001.html</link>
</item>
</channel></rss>`;

const ACGRIP = `<rss version="2.0"><channel>
<item>
  <title>[ANi] 葬送的芙莉莲 - 03 [1080P][Baha][WEB-DL]</title>
  <link>https://acg.rip/t/123456</link>
  <description>大小: 700 MB</description>
  <pubDate>Wed, 13 Nov 2026 09:30:00 +0800</pubDate>
  <enclosure url="https://acg.rip/t/123456.torrent" type="application/x-bittorrent"/>
</item>
</channel></rss>`;

const BT4G = `<rss version="2.0"><channel>
<item>
  <title>矩阵 1999 1080p BluRay</title>
  <link>magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&amp;dn=matrix</link>
  <guid>https://bt4gprx.com/magnet/bbbb</guid>
  <description>Size: 8.5GB Seeders: 120</description>
  <pubDate>Mon, 10 Nov 2026 08:00:00 +0000</pubDate>
  <enclosure url="https://bt4gprx.com/magnet/bbbb" length="9126805504" type="application/x-bittorrent"/>
</item>
<item><title>缺少 magnet 的条目</title><link>https://bt4gprx.com/magnet/x</link></item>
</channel></rss>`;

test('parseTorrentFeed 取动漫花园的种子地址与体积', () => {
  const rows = parseTorrentFeed(DMHY);
  assert.equal(rows.length, 1, '没有种子链接的条目应被丢弃');
  assert.match(rows[0].title, /药屋少女/);
  assert.match(rows[0].torrentUrl, /\.torrent$/);
  assert.equal(rows[0].sizeBytes, 1288490188);
  assert.equal(rows[0].seeders, 42);
  assert.ok(rows[0].publishedAt > 0);
});

test('parseTorrentFeed 兼容 acg.rip，体积从描述里取', () => {
  const rows = parseTorrentFeed(ACGRIP);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].torrentUrl, 'https://acg.rip/t/123456.torrent');
  assert.equal(rows[0].sizeBytes, 700 * 1024 ** 2);
  assert.equal(rows[0].seeders, null);
});

test('parseMagnetFeed 从 BT4G 的 magnet 里取 info hash', () => {
  const rows = parseMagnetFeed(BT4G);
  assert.equal(rows.length, 1, '没有 magnet 的条目应被丢弃');
  assert.equal(rows[0].infoHash, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(rows[0].sizeBytes, 9126805504);
  assert.equal(rows[0].seeders, 120);
});

test('parseKnaben 兼容 hits 数组与秒级时间戳，丢弃坏条目', () => {
  const rows = parseKnaben({
    hits: [
      { title: 'Severance S02E01 1080p', hash: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', bytes: 2000000000, seeders: 88, peers: 5, date: 1762900000 },
      { title: '没有 hash 的条目', bytes: 100 },
      null,
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].infoHash, 'cccccccccccccccccccccccccccccccccccccccc');
  assert.equal(rows[0].sizeBytes, 2000000000);
  assert.equal(rows[0].seeders, 88);
  assert.equal(rows[0].leechers, 5);
  assert.equal(rows[0].publishedAt, 1762900000 * 1000);
});

test('parseKnaben 结构异常时返回空数组而不抛错', () => {
  assert.deepEqual(parseKnaben(null), []);
  assert.deepEqual(parseKnaben('<html>error</html>'), []);
  assert.deepEqual(parseKnaben({ hits: 'nope' }), []);
});

test('sizeFromText 认 GB/MB 与 KB', () => {
  assert.equal(sizeFromText('大小: 1.2GB'), Math.round(1.2 * 1024 ** 3));
  assert.equal(sizeFromText('Size: 700 MB'), 700 * 1024 ** 2);
  assert.equal(sizeFromText('大小：350KB'), 350 * 1024);
  assert.equal(sizeFromText('没有体积信息'), 0);
});

test('内置索引源覆盖中文站与聚合站', async () => {
  const { builtinSourceIds } = await import('../../content/server/sources.mjs');
  const ids = builtinSourceIds();
  for (const id of ['apibay', 'torrents-csv', 'mikan', 'dmhy', 'acgrip', 'bt4g', 'knaben', 'nyaa', 'yts']) {
    assert.ok(ids.includes(id), `缺少内置源 ${id}`);
  }
});
