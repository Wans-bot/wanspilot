/** Subscription air-date calendar. TMDB supplies dates, not guaranteed airtimes. */
import * as tmdb from './tmdb.mjs';
import { listSubscriptions } from './subscriptions.mjs';
import { log } from './log.mjs';
import { localDateKey, validMonthKey } from '../web/calendar-model.js';

const CACHE_TTL_MS = 6 * 3600 * 1000;
const epKey = (season, episode) => `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

export function calendarEpisodeStatus(episodeKey, airDate, today, downloaded, pending) {
  if (downloaded.has(episodeKey)) return 'downloaded';
  if (pending.has(episodeKey)) return 'downloading';
  return airDate > today ? 'upcoming' : 'missing';
}

/** Dependencies keep calendar tests isolated from the NAS and TMDB. */
export function createCalendarService({ getSubscriptions = listSubscriptions, season = tmdb.season, detail = tmdb.detail, now = () => new Date() } = {}) {
  const cache = new Map(), inflight = new Map();
  async function cached(key, fetcher) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const request = Promise.resolve().then(fetcher).then(value => {
      if (cache.size >= 400) cache.delete(cache.keys().next().value);
      cache.set(key, { value, at: Date.now() }); return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, request); return request;
  }
  async function seasonsFor(sub) {
    if (Array.isArray(sub.seasons) && sub.seasons.length) return [...new Set(sub.seasons.map(Number))].filter(n => Number.isInteger(n) && n > 0);
    const data = await cached('detail:' + sub.tmdbId, () => detail({ type: 'tv', id: sub.tmdbId }));
    const all = ((data && data.seasons) || []).filter(item => Number(item.seasonNumber) > 0).sort((a, b) => a.seasonNumber - b.seasonNumber);
    return [...new Set(all.map(item => Number(item.seasonNumber)))];
  }
  return async function month(monthKey) {
    const today = localDateKey(now());
    const key = String(monthKey || today.slice(0, 7));
    if (!validMonthKey(key)) throw Object.assign(new Error('月份格式应为 YYYY-MM，月份范围为 01–12'), { statusCode: 400 });
    const subs = (getSubscriptions().items || []).filter(item => item.type !== 'movie');
    const warnings = [], results = [], backlog = [];
    let cursor = 0;
    // Bound concurrent subscriptions; a large watchlist must not flood TMDB.
    await Promise.all(Array.from({ length: Math.min(4, subs.length) }, async () => {
      while (cursor < subs.length) {
        const sub = subs[cursor++];
        let seasons;
        try { seasons = await seasonsFor(sub); } catch (err) {
          warnings.push({ subscriptionId: sub.id, title: sub.title, reason: 'season-info-unavailable' });
          log.warn(`[calendar] ${sub.title || sub.tmdbId} 季信息获取失败：${err.message}`); continue;
        }
        const downloaded = new Set(sub.downloadedKeys || []), pending = new Set(sub.pendingKeys || []);
        for (const seasonNumber of seasons) {
          let episodes;
          try {
            const data = await cached(`${sub.tmdbId}:${seasonNumber}`, () => season({ id: sub.tmdbId, season: seasonNumber }));
            episodes = data?.episodes || [];
          } catch (err) {
            warnings.push({ subscriptionId: sub.id, title: sub.title, season: seasonNumber, reason: 'episodes-unavailable' });
            log.warn(`[calendar] ${sub.title || sub.tmdbId} 第 ${seasonNumber} 季信息获取失败：${err.message}`); continue;
          }
          const seen = new Set();
          for (const episode of episodes) {
            const airDate = String(episode.airDate || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(airDate) || !Number.isInteger(episode.episodeNumber) || episode.episodeNumber < 1) continue;
            const parsedDate = new Date(airDate + 'T00:00:00Z');
            if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== airDate) continue;
            const episodeKey = epKey(seasonNumber, episode.episodeNumber);
            if (seen.has(episodeKey)) continue; seen.add(episodeKey);
            const entry = { subscriptionId: sub.id, tmdbId: sub.tmdbId, type: 'tv', title: sub.title, posterPath: sub.posterPath || '', season: seasonNumber, episode: episode.episodeNumber, episodeName: episode.name || '', airDate,
              status: calendarEpisodeStatus(episodeKey, airDate, today, downloaded, pending) };
            if (entry.status === 'missing') backlog.push(entry);
            if (airDate.startsWith(key + '-')) results.push(entry);
          }
        }
      }
    }));
    const days = new Map();
    results.sort((a, b) => a.airDate.localeCompare(b.airDate) || String(a.title).localeCompare(String(b.title), 'zh-CN') || a.season - b.season || a.episode - b.episode);
    for (const item of results) { if (!days.has(item.airDate)) days.set(item.airDate, []); days.get(item.airDate).push(item); }
    const missingDays = new Map();
    backlog.sort((a,b) => a.airDate.localeCompare(b.airDate) || a.season-b.season || a.episode-b.episode);
    for (const item of backlog) { if (!missingDays.has(item.airDate)) missingDays.set(item.airDate, []); missingDays.get(item.airDate).push(item); }
    return { month: key, today, missingScope:'all-subscriptions', missingComplete:warnings.length === 0, missingDays:[...missingDays].map(([date,items])=>({date,items})), days: [...days.entries()].map(([date, items]) => ({ date, items })), total: results.length,
      missing: backlog.length, missingTotal:backlog.length, monthMissing:results.filter(item => item.status === 'missing').length, upcoming: results.filter(item => item.status === 'upcoming').length,
      downloading: results.filter(item => item.status === 'downloading').length, downloaded: results.filter(item => item.status === 'downloaded').length, warnings };
  };
}
export const month = createCalendarService();
