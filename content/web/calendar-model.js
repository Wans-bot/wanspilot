import { shanghaiDate } from './time.js';
/* Pure calendar presentation helpers: no DOM, network or browser globals. */
export function localDateKey(date = new Date()) { return shanghaiDate(date); }
export function validMonthKey(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }
export function weekdayOf(date) { return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; }
export function calendarCells(monthKey, days) {
  const [year, month] = monthKey.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map((days || []).map(day => [day.date, day.items || []]));
  const cells = Array.from({ length: weekdayOf(monthKey + '-01') }, () => null);
  for (let day = 1; day <= count; day++) {
    const date = monthKey + '-' + String(day).padStart(2, '0');
    cells.push({ date, day, items: byDate.get(date) || [] });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function episodeLabel(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]; let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    const ep = n => 'E' + String(n).padStart(2, '0');
    ranges.push(ep(start) + (end === start ? '' : '–' + ep(end)));
  }
  return ranges.join(' / ');
}
export function groupCalendarItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = [item.subscriptionId || item.tmdbId, item.type || 'tv', item.season, item.airDate].join(':');
    if (!groups.has(key)) groups.set(key, { ...item, entries: [] });
    const group = groups.get(key);
    if (!group.entries.some(entry => entry.episode === item.episode)) group.entries.push(item);
  }
  return [...groups.values()].map(group => {
    group.entries.sort((a, b) => a.episode - b.episode);
    group.count = group.entries.length;
    group.downloaded = group.entries.filter(item => item.status === 'downloaded').length;
    group.episodeLabel = 'S' + String(group.season).padStart(2, '0') + ' ' + episodeLabel(group.entries.map(item => item.episode));
    const states = new Set(group.entries.map(item => item.status));
    group.status = states.size === 1 ? group.entries[0].status : (states.has('downloading') ? 'downloading' : 'partial');
    return group;
  }).sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN') || a.season - b.season);
}
export function filterCalendarDays(days, { status = 'all', series = 'all' } = {}) {
  return (days || []).map(day => ({ ...day, items: (day.items || []).filter(item =>
    (status === 'all' || item.status === status) && (series === 'all' || String(item.subscriptionId || item.tmdbId) === series)) })).filter(day => day.items.length);
}
export function calendarStats(days) {
  const items = (days || []).flatMap(day => day.items || []);
  const stats = { total: items.length, series: new Set(items.map(item => item.subscriptionId || item.tmdbId)).size, downloaded: 0, downloading: 0, missing: 0, upcoming: 0 };
  items.forEach(item => { if (Object.hasOwn(stats, item.status) && item.status !== 'total' && item.status !== 'series') stats[item.status]++; });
  return stats;
}
