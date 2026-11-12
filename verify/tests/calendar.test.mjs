import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, validMonthKey, calendarCells, episodeLabel, groupCalendarItems, filterCalendarDays, calendarStats } from '../../content/web/calendar-model.js';
import { createCalendarService } from '../../content/server/calendar.mjs';
const episode = (number, date = '2026-11-12') => ({ episodeNumber: number, airDate: date, name: 'Episode ' + number });
const subscription = (overrides = {}) => ({ id: 'sub-a', tmdbId: 101, type: 'tv', title: 'Example', seasons: [1], enabled: true, downloadedKeys: ['S01E01'], pendingKeys: ['S01E02'], ...overrides });
const deps = (overrides = {}) => ({ now: () => new Date(2026, 10, 12, 0, 15), getSubscriptions: () => ({ items: [subscription()] }), season: async () => ({ episodes: [episode(1), episode(2), episode(3), episode(4, '2026-11-20')] }), ...overrides });

test('local calendar date, leap months and Monday alignment', () => {
  assert.equal(localDateKey(new Date(2026, 10, 1, 0, 1)), '2026-11-01');
  assert.equal(validMonthKey('2026-00'), false); assert.equal(validMonthKey('2026-13'), false);
  const cells = calendarCells('2024-02', []);
  assert.equal(cells.filter(Boolean).length, 29); assert.equal(cells.length % 7, 0);
  assert.equal(cells[3].date, '2024-02-01');
  assert.equal(calendarCells('2026-11', []).filter(Boolean).length, 30);
});
test('group same-day same-season episodes without swallowing gaps or mixing subscriptions', () => {
  const items = [1, 2, 4].map(episode => ({ subscriptionId: 'a', season: 1, episode, title: 'Example', airDate: '2026-11-12', status: episode === 1 ? 'downloaded' : 'missing' }));
  const groups = groupCalendarItems([...items, items[0], { ...items[0], subscriptionId: 'b' }, { ...items[0], season: 2 }]);
  assert.equal(groups.length, 3);
  const group = groups.find(item => item.subscriptionId === 'a' && item.season === 1);
  assert.equal(group.count, 3); assert.equal(group.downloaded, 1); assert.equal(group.status, 'partial');
  assert.equal(group.episodeLabel, 'S01 E01–E02 / E04');
  assert.equal(episodeLabel([10, 2, 1, 2]), 'E01–E02 / E10');
});
test('status and series filters count episodes rather than grouped cards', () => {
  const items = ['downloaded', 'missing', 'upcoming', 'downloading'].map((status, episode) => ({ status, episode, subscriptionId: episode % 2 ? 'b' : 'a' }));
  const days = [{ date: '2026-11-12', items }];
  assert.equal(filterCalendarDays(days, { status: 'missing', series: 'a' }).length, 0);
  assert.equal(filterCalendarDays(days, { series: 'b' })[0].items.length, 2);
  assert.deepEqual(calendarStats(days), { total: 4, series: 2, downloaded: 1, downloading: 1, missing: 1, upcoming: 1 });
});
test('calendar never counts future unbroadcast episodes as missing; download state takes precedence', async () => {
  const getMonth = createCalendarService(deps());
  const data = await getMonth('2026-11');
  assert.equal(data.today, '2026-11-12'); assert.equal(data.total, 4); assert.equal(data.missing, 1); assert.equal(data.upcoming, 1);
  assert.deepEqual(data.days.flatMap(day => day.items.map(item => item.status)), ['downloaded', 'downloading', 'missing', 'upcoming']);
  await assert.rejects(getMonth('2026-13'), error => error.statusCode === 400);
});
test('calendar excludes movies, disabled subscriptions, other months and duplicate TMDB episodes', async () => {
  const getMonth = createCalendarService(deps({ getSubscriptions: () => ({ items: [subscription(), subscription({ id: 'movie', type: 'movie' }), subscription({ id: 'off', enabled: false })] }), season: async () => ({ episodes: [episode(1), episode(1), episode(2, '2026-12-01'), episode(0), episode(3, ''), episode(4, '2026-11-99'), episode(5, '2026-11-31')] }) }));
  assert.equal((await getMonth('2026-11')).total, 1);
});
test('failed TMDB season loads warn and can recover immediately instead of caching an empty month', async () => {
  let calls = 0;
  const getMonth = createCalendarService(deps({ season: async () => { if (++calls === 1) throw new Error('offline'); return { episodes: [episode(1)] }; } }));
  const failed = await getMonth('2026-11'); assert.equal(failed.total, 0); assert.equal(failed.warnings.length, 1);
  const recovered = await getMonth('2026-11'); assert.equal(recovered.total, 1); assert.equal(recovered.warnings.length, 0);
});
test('concurrent month requests share TMDB requests but reflect current download status', async () => {
  let calls = 0, complete = false;
  const getMonth = createCalendarService(deps({ getSubscriptions: () => ({ items: [subscription({ downloadedKeys: complete ? ['S01E01'] : [], pendingKeys: [] })] }), season: async () => { calls++; await new Promise(r => setTimeout(r, 15)); return { episodes: [episode(1)] }; } }));
  await Promise.all([getMonth('2026-11'), getMonth('2026-11')]); assert.equal(calls, 1);
  complete = true; assert.equal((await getMonth('2026-11')).downloaded, 1); assert.equal(calls, 1);
});
