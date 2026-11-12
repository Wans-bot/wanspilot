import { selectFeatured } from './featured-model.js';
import { filterTasks, filterSubscriptions } from './automation-model.js';
import { shanghaiDate, shanghaiTime, shanghaiDateTime } from './time.js';
/* WansPilot 前端入口。
 * 无构建步骤：浏览器把它当 ES 模块直接加载，接口契约见仓库根目录 API.md。
 */
import { LUCIDE_ICONS } from './vendor/lucide-icons.js';
import { localDateKey, validMonthKey, weekdayOf, calendarCells, groupCalendarItems, filterCalendarDays, calendarStats } from './calendar-model.js';

const API_ROOT = '/api';

/* 官方网盘选择器把选中项放在 /files/home 下；桥接前缀取自 lzc-manifest.yml。 */
const BRIDGE_ROOT = '/__lazycat_file_bridge';
const HOME_PREFIXES = ['/_lzc/files/home/', '/files/home/', '/_lzc/home/'];

const ACTIVE_TASK_STATES = ['queued', 'fetching-metadata', 'downloading', 'seeding'];

/* 挑选可用值时的字段优先级：路径优先，name 只是最后兜底。 */
const PICKED_VALUE_KEYS = [
  'path', 'filename', 'webkitRelativePath', 'url', 'fileUrl', 'fullPath',
  'filePath', 'savePath', 'relativePath', 'name', 'fileName'
];

const QUALITY_OPTIONS = ['2160p', '1080p', '720p', '480p'];

const TYPE_LABELS = { movie: '电影', tv: '剧集', anime: '动漫', multi: '全部' };

const TASK_STATES = {
  queued: { label: '排队中', kind: 'info' },
  'fetching-metadata': { label: '获取元数据', kind: 'info' },
  downloading: { label: '下载中', kind: 'info' },
  seeding: { label: '做种中', kind: 'ok' },
  paused: { label: '已暂停', kind: 'warn' },
  completed: { label: '已完成', kind: 'ok' },
  error: { label: '出错', kind: 'err' }
};

const SUB_STATES = {
  watching: { label: '跟踪中', kind: 'ok' },
  idle: { label: '无更新', kind: 'info' },
  paused: { label: '已暂停', kind: 'warn' },
  error: { label: '出错', kind: 'err' }
};


const PAGE_TITLES = {
  home: '影视墙', search: '搜索', subscribe: '订阅', calendar: '更新日历',
  sources:'资源渠道',overview:'运行总览', notifications:'通知中心', tasks: '下载任务', settings: '设置', detail: '影视详情', resources: '资源'
};

/* ---------- 图标（全部内联 SVG，不依赖任何外域资源） ---------- */

/* 图标统一来自内置的 Lucide 子集（ISC 许可，原文见 vendor/LICENSE-lucide.txt）。
 * 键名沿用原手写版本的命名，icon('search') 这类调用处都不用改。 */
const ICON = LUCIDE_ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';
const iconBodies = new Map();

/** 图标体只在第一次用到时解析成节点，之后克隆；图标素材来自仓库自带的 Lucide 子集。 */
function iconBodyNodes(name) {
  if (!iconBodies.has(name)) {
    let list = [];
    try {
      const doc = new DOMParser().parseFromString('<svg xmlns="' + SVG_NS + '">' + (ICON[name] || '') + '</svg>', 'image/svg+xml');
      list = Array.prototype.slice.call(doc.documentElement.childNodes)
        .map(function (node) { return document.importNode(node, true); });
    } catch {
      list = [];
    }
    iconBodies.set(name, list);
  }
  return iconBodies.get(name).map(function (node) { return node.cloneNode(true); });
}

function iconNode(name, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  iconBodyNodes(name).forEach(function (node) { svg.append(node); });
  return svg;
}

/* ---------- 工具函数 ---------- */

/** 建一个元素。props 认 class / text / dataset / attrs / on 以及其它属性；children 收节点或字符串。 */
function el(tag, props, children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  return appendAll(node, children);
}

function applyProps(node, props) {
  if (!props) return node;
  Object.keys(props).forEach(function (key) {
    const value = props[key];
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') {
      Object.keys(value).forEach(function (name) { node.dataset[name] = String(value[name]); });
    } else if (key === 'attrs') {
      Object.keys(value).forEach(function (name) { node.setAttribute(name, String(value[name])); });
    } else if (key === 'on') {
      Object.keys(value).forEach(function (name) { node.addEventListener(name, value[name]); });
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  });
  return node;
}

function appendAll(node, children) {
  if (children === undefined || children === null || children === false) return node;
  (Array.isArray(children) ? children : [children]).forEach(function (child) {
    if (child === undefined || child === null || child === false) return;
    // 允许直接塞一层数组（例如 children.map(...)），省掉到处 flat
    if (Array.isArray(child)) { appendAll(node, child); return; }
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function frag(children) { return appendAll(document.createDocumentFragment(), children); }

/** 换掉节点的全部子节点，用在原来写 innerHTML 的地方。 */
function fill(node, children) { node.replaceChildren(); return appendAll(node, children); }

/** 图标 + 文字的按钮 / 链接，界面上大半按钮都是这个形状。 */
function buttonEl(props, iconName, label) {
  const node = el('button', Object.assign({ type: 'button' }, props));
  if (iconName) node.append(iconNode(iconName));
  if (label !== undefined && label !== null) node.append(el('span', { text: label }));
  return node;
}

function linkEl(props, iconName, label) {
  const node = el('a', props);
  if (iconName) node.append(iconNode(iconName));
  if (label !== undefined && label !== null) node.append(el('span', { text: label }));
  return node;
}

/** 一组属性：class 按条件拼，省掉一堆三元表达式。 */
function classNames() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
}

/* 页面上反复出现的几种容器 */
function pageEl(children) { return el('div', { class: 'page' }, children); }
/* 横向滑动条：鼠标移上去出现左右按钮，两端渐隐；
   按钮的可用状态按滚动位置更新，节点已被换掉时就把自己从登记表里摘掉。 */
const railUpdaters = new Set();

window.addEventListener('resize', function () {
  railUpdaters.forEach(function (update) { update(); });
});

function railEl(children) {
  const track = el('div', { class: 'rail' }, children);
  const prev = buttonEl({ class: 'rail__nav rail__nav--prev', 'aria-label': '向左翻' }, 'chevron-left');
  const next = buttonEl({ class: 'rail__nav rail__nav--next', 'aria-label': '向右翻' }, 'chevron-right');
  const wrap = el('div', { class: 'rail-wrap' }, [track, prev, next]);

  const update = function () {
    if (!wrap.isConnected) { railUpdaters.delete(update); return; }
    const max = track.scrollWidth - track.clientWidth;
    wrap.classList.toggle('is-start', track.scrollLeft <= 2);
    wrap.classList.toggle('is-end', track.scrollLeft >= max - 2);
  };
  const step = function (direction) {
    track.scrollBy({ left: direction * Math.max(240, track.clientWidth * 0.8), behavior: 'smooth' });
  };
  prev.addEventListener('click', function () { step(-1); });
  next.addEventListener('click', function () { step(1); });
  track.addEventListener('scroll', update, { passive: true });
  railUpdaters.add(update);
  requestAnimationFrame(update);
  // 图是懒加载的，图到了宽度才准，过一会儿再校准一次
  setTimeout(update, 800);
  return wrap;
}

function gridEl(children, extraClass) { return el('div', { class: classNames('grid', extraClass) }, children); }

/** 首页与详情页里的「区块」：标题 + 右侧「查看全部」+ 内容。 */
function blockEl(title, body, more) {
  return el('section', { class: 'block' }, [
    el('header', { class: 'block__head' }, [
      el('h2', { class: 'block__title', text: title }),
      more || null,
    ]),
    body,
  ]);
}

function blockMoreEl(href, label) {
  return el('a', { class: 'block__more', href: href, text: label });
}

/** 键值行，运行状况与设置的自检都用它。 */
function kvRowEl(key, value) {
  return el('div', { class: 'kv__row' }, [
    el('span', { class: 'kv__key', text: key }),
    el('span', { class: 'kv__value', text: value }),
  ]);
}

function $$(selector, root) { return [...(root || document).querySelectorAll(selector)]; }
function $(selector, root) { return (root || document).querySelector(selector); }

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return (value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
}

function fmtRate(bytesPerSecond) {
  const n = Number(bytesPerSecond);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return fmtBytes(n) + '/s';
}

function fmtSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const hours = Math.floor(n / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  const rest = Math.floor(n % 60);
  if (hours > 0) return hours + ' 小时 ' + minutes + ' 分';
  if (minutes > 0) return minutes + ' 分 ' + rest + ' 秒';
  return rest + ' 秒';
}

/* 片长/集长用分钟展示：139 -> 2 小时 19 分，50 -> 50 分钟。 */
function fmtMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const hours = Math.floor(n / 60);
  const rest = Math.round(n % 60);
  return hours > 0 ? hours + ' 小时 ' + rest + ' 分' : rest + ' 分钟';
}

function fmtUptime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const days = Math.floor(n / 86400);
  const hours = Math.floor((n % 86400) / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  if (days > 0) return days + ' 天 ' + hours + ' 小时';
  if (hours > 0) return hours + ' 小时 ' + minutes + ' 分';
  return Math.max(1, minutes) + ' 分钟';
}

function pad2(value) { return String(value).padStart(2, '0'); }

function fmtDateTime(iso) { return iso ? shanghaiDateTime(iso) || String(iso) : '—'; }
function fmtDate(iso) { return iso ? shanghaiDate(iso) || String(iso) : '—'; }

/* 所有海报、剧照、背景图都经后端图片接口，前端不直连图片站点。 */
function imageUrl(path, size) {
  if (!path) return '';
  return API_ROOT + '/image?path=' + encodeURIComponent(path)
    + '&size=' + encodeURIComponent(size || 'w342');
}

function posterFallback(alt) {
  return el('span', { class: 'poster__empty', role: 'img', 'aria-label': alt || '暂无海报' }, [iconNode('film'), el('span', { text: '暂无海报' })]);
}
function posterEl(path, alt, size) {
  if (!path) return posterFallback(alt);
  const image = el('img', {
    src: imageUrl(path, size || 'w342'), alt: alt, loading: 'lazy', decoding: 'async', width: '342', height: '513',
    on: { error: function (event) { event.currentTarget.replaceWith(posterFallback(alt)); } },
  });
  return image;
}
function backdropAttributes(path) {
  return { src: imageUrl(path, 'w780'),
    srcset: imageUrl(path, 'w780') + ' 780w, ' + imageUrl(path, 'w1280') + ' 1280w',
    sizes: '(max-width: 860px) 100vw, (max-width: 1440px) calc(100vw - 80px), 1360px',
    decoding: 'async', on: { error: function (event) { event.currentTarget.hidden = true; } } };
}
function backdropEl(path, alt) {
  return path ? el('img', Object.assign(backdropAttributes(path), { alt: alt || '' })) : null;
}

function typeLabel(type) { return TYPE_LABELS[type] || '影视'; }

/* ---------- 内存缓存 ---------- */

/* 切页不再重新打接口：同一份数据在 5 分钟内直接用内存里的结果，
   影视墙与搜索结果因此回到页面时立刻出图，不再闪一遍骨架屏。 */
const VIEW_CACHE_MS = 30 * 60 * 1000;
const viewCache = new Map();

function cachedPayload(path, ttlMs) {
  const hit = viewCache.get(path);
  const ttl = ttlMs === undefined ? VIEW_CACHE_MS : ttlMs;
  if (!hit || (ttl > 0 && Date.now() - hit.at >= ttl)) return null;
  return hit.payload;
}

async function cachedApi(path, ttlMs) {
  const hit = cachedPayload(path, ttlMs);
  if (hit) return hit;
  const payload = await api(path);
  if (viewCache.size >= 80) viewCache.delete(viewCache.keys().next().value);
  viewCache.set(path, { at: Date.now(), payload: payload });
  return payload;
}

/* 订阅状态：影视墙、搜索与详情页都要知道哪些作品已订阅，统一放在这里，
   卡片上的收藏图标才能一次渲染成实心或空心。 */
const SUB_CACHE_MS = 30 * 1000;
const subState = { items: [], at: 0, pending: null, pendingAt: 0 };

function normalizeType(type) { return type === 'movie' ? 'movie' : 'tv'; }

function subscribedFor(type, id) {
  const want = normalizeType(type);
  return subState.items.filter(function (item) {
    return String(item.tmdbId) === String(id) && normalizeType(item.type) === want;
  })[0] || null;
}

async function loadSubscriptionsCached(force) {
  const fresh = subState.at > 0 && Date.now() - subState.at < SUB_CACHE_MS;
  if (!force && fresh) return subState.items;
  const inFlightFresh = subState.pending && Date.now() - subState.pendingAt < SUB_CACHE_MS;
  if (!force && inFlightFresh) return subState.pending;
  subState.pendingAt = Date.now();
  subState.pending = api('/subscriptions').then(function (data) {
    subState.items = (data && data.items) || [];
    subState.at = Date.now();
    subState.pending = null;
    return subState.items;
  }, function (error) {
    subState.pending = null;
    throw error;
  });
  return subState.pending;
}

function rememberSubscription(item) {
  if (!item) return;
  subState.items = subState.items.filter(function (entry) { return entry.id !== item.id; });
  subState.items.push(item);
  subState.at = Date.now();
}

/* 卡片上的按钮要拿完整条目才能订阅，渲染时顺手登记，点击时按 key 取回。 */
const cardIndex = new Map();

function cardKey(type, id) { return normalizeType(type) + ':' + id; }

/** 取消订阅：海报卡与详情页共用，先确认再删；返回是否真的删掉了。 */
/* 取消订阅只删订阅记录：已下载的文件与正在下载的任务都不动。
   直接生效，不再弹确认框（点实心收藏图标 = 取消，用户要求行为直白）。 */
async function removeSubscription(id, _label) {
  if (!id) return false;
  try {
    await api('/subscriptions/' + encodeURIComponent(id), { method: 'DELETE' });
    subState.items = subState.items.filter(function (entry) { return entry.id !== id; });
    subState.at = Date.now();
    dropStash('subscribe');
    dropStash('calendar');
    toast('已取消订阅（已下载的文件与正在下载的任务都不动）', 'ok');
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
}

/** 海报上点订阅：电影按设置里的默认条件直接订阅；剧集与动漫先弹窗选季，再按弹窗里的条件订阅。 */
async function cardSubscribe(button) {
  const item = cardIndex.get(button.getAttribute('data-key'));
  if (!item) return;
  // 剧集与动漫往往有多季（第一季、第二季…）：先取详情，弹窗里让用户选季，再按选中的季订阅
  if (normalizeType(item.type) === 'tv') {
    button.disabled = true;
    let detail = null;
    try {
      detail = await cachedApi('/tmdb/detail?type=tv&id=' + encodeURIComponent(item.tmdbId));
    } catch (error) {
      toast(error.message, 'error');
    }
    button.disabled = false;
    openSubscribeDialog(Object.assign({}, item, detail || {}), {
      onDone: function () { paintSubButton(button, item, true); },
    });
    return;
  }
  button.disabled = true;
  try {
    const result = await api('/subscriptions', {
      method: 'POST',
      body: {
        type: item.type,
        tmdbId: item.tmdbId,
        title: item.title,
        originalTitle: item.originalTitle,
        year: item.year,
        posterPath: item.posterPath,
        seasons: null,
      },
    });
    rememberSubscription(result && result.item);
    dropStash('subscribe');
    dropStash('calendar');
    paintSubButton(button, item, true);
    toast('已订阅「' + item.title + '」，可到订阅页查看搜索与下载进度', 'ok');
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

/** 海报上点已订阅的实心图标：确认后取消订阅。 */
async function cardUnsubscribe(button) {
  const item = cardIndex.get(button.getAttribute('data-key'));
  const record = item ? subscribedFor(item.type, item.tmdbId) : null;
  if (!item || !record) return;
  const removed = await removeSubscription(record.id, item.title);
  if (!removed) return;
  paintSubButton(button, item, false);
}

/** 订阅状态变了就地把按钮改成另一种样子：不重排整张卡，也不重建 DOM 片段。 */
function paintSubButton(button, item, subscribed) {
  // 订阅请求期间按钮是禁用的，落定后要放开，否则这颗图标以后再点不动
  button.disabled = false;
  const acts = button.closest('.card__acts');
  if (acts) acts.classList.toggle('is-pinned', subscribed);
  button.classList.toggle('is-on', subscribed);
  button.setAttribute('data-action', subscribed ? 'card-unsubscribe' : 'card-subscribe');
  button.setAttribute('title', subscribed ? '已订阅，点击取消订阅' : '订阅');
  button.setAttribute('aria-label', (subscribed ? '取消订阅' : '订阅') + (item.title || ''));
  const svg = button.querySelector('svg');
  if (svg) svg.classList.toggle('icon--solid', subscribed);
}

/** 海报上的订阅按钮：已订阅是实心收藏，未订阅是空心收藏。 */
function subButtonEl(type, id, title, subscribed) {
  return el('button', {
    type: 'button',
    class: classNames('card__act', 'card__act--sub', subscribed && 'is-on'),
    'data-action': subscribed ? 'card-unsubscribe' : 'card-subscribe',
    'data-key': cardKey(type, id),
    title: subscribed ? '已订阅，点击取消订阅' : '订阅',
    'aria-label': (subscribed ? '取消订阅' : '订阅') + (title || ''),
  }, iconNode('bookmark', subscribed ? 'icon--solid' : ''));
}

/* ---------- 接口层 ---------- */

/* 请求都要有超时：没有超时的话，一次被网关丢掉响应的请求会让「在飞的 Promise」
   永远悬着（例如 subState.pending），详情页就会一直停在骨架屏、订阅也点不动。
   自检与资源搜索本来就要打外网，单独给更长预算。 */
const API_TIMEOUT_MS = 20000;
const API_SLOW_RULES = [
  { pattern: /^\/settings\//, ms: 60000 },
  { pattern: /^\/resources\b/, ms: 60000 },
  { pattern: /^\/health\/report\b/, ms: 60000 },
  { pattern: /^\/organizer\/run\b/, ms: 180000 }
];

function apiTimeoutMs(path, options) {
  const asked = Number((options || {}).timeoutMs);
  if (asked > 0) return asked;
  for (let i = 0; i < API_SLOW_RULES.length; i += 1) {
    if (API_SLOW_RULES[i].pattern.test(path)) return API_SLOW_RULES[i].ms;
  }
  return API_TIMEOUT_MS;
}

function api(path, options) {
  const opts = options || {};
  const timeoutMs = apiTimeoutMs(path, opts);
  const init = {
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  if (controller) init.signal = controller.signal;
  const timer = setTimeout(function () {
    if (controller) controller.abort();
  }, timeoutMs);
  const finish = function () { clearTimeout(timer); };
  return fetch(API_ROOT + path, init).then(function (response) {
    return response.text().then(function (text) {
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!response.ok) {
        const message = (data && typeof data === 'object' && data.error)
          || (typeof data === 'string' && data.trim())
          || ('请求失败（HTTP ' + response.status + '）');
        if (data && data.code === 'AUTH_REQUIRED') { accessReady = false; stopLive(); showLogin(); }
        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    });
  }, function (_error) {
    if (controller && controller.signal.aborted) {
      throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒没等到后端回应），请重试');
    }
    throw new Error('无法连接后端服务，请确认应用已启动');
  }).then(function (value) { finish(); return value; }, function (error) { finish(); throw error; });
}

function apiText(path, options) {
  const opts = options || {};
  return fetch(API_ROOT + path, { method: opts.method || 'GET', credentials: 'same-origin' })
    .then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error('请求失败（HTTP ' + response.status + '）');
        return text;
      });
    }, function () {
      throw new Error('无法连接后端服务，请确认应用已启动');
    });
}

/* ---------- 提示、空态与错误态 ---------- */

function toast(message, kind) {
  const host = $('#toasts');
  if (!host) return;
  const tone = kind || 'info';
  const mark = tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'info';
  const node = el('div', { class: 'toast toast--' + tone, role: tone === 'error' ? 'alert' : 'status' }, [
    el('span', { class: 'toast__icon' }, iconNode(mark)),
    el('span', { class: 'toast__text', text: String(message || '') }),
  ]);
  host.append(node);
  const life = kind === 'error' ? 6500 : 3400;
  setTimeout(function () {
    node.classList.add('toast--out');
    setTimeout(function () { node.remove(); }, 320);
  }, life);
}

/** 数据还在读时的中性占位：别把「正在读」画成「请求失败」。 */
function loadingEl(message) {
  return el('p', { class: 'field__hint', text: message || '读取中…' });
}

function errorEl(message) {
  return el('div', { class: 'notice notice--err' }, [
    el('p', { class: 'notice__title' }, [iconNode('alert'), el('span', { text: '请求失败' })]),
    el('p', { class: 'notice__text', text: String(message || '未知错误') }),
    buttonEl({ class: 'btn btn--sm', 'data-action': 'retry' }, null, '重试'),
  ]);
}

function emptyEl(text) {
  return el('div', { class: 'empty-state' }, [el('span', { class: 'empty-state__icon' }, iconNode('film')), el('p', { text: String(text) })]);
}

function skeletonCardsEl(count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    list.push(el('div', { class: 'card' }, [
      el('div', { class: 'card__poster sk' }),
      el('div', { class: 'sk sk-line' }),
      el('div', { class: 'sk sk-line sk-line--short' }),
    ]));
  }
  return frag(list);
}

function skeletonRowsEl(count) {
  const list = [];
  for (let i = 0; i < count; i += 1) list.push(el('div', { class: 'sk', style: 'height:86px' }));
  return frag(list);
}

/* ---------- 卡片 ---------- */

/* 资源页用片名与年份预填关键词，后端仍以 tmdbId 为准。 */
function resourceQuery(item, year) {
  const title = item.originalTitle || item.title || '';
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (year) params.set('year', String(year));
  const text = params.toString();
  return text ? '?' + text : '';
}

/* 海报上的两个按钮：找资源与订阅。已订阅的作品收藏图标实心常显，
   没订阅的只显示海报，鼠标移上来（或键盘聚焦）才出现两个图标。 */
function mediaCardEl(item, options) {
  const opts = options || {};
  const rawType = item.type || opts.type || 'tv';
  const type = normalizeType(rawType);
  const title = item.title || item.originalTitle || '未命名';
  const year = item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '');
  const vote = Number(item.voteAverage);
  const subtitle = [year, typeLabel(rawType)].filter(Boolean).join(' · ');
  const detailHref = '#/detail/' + type + '/' + item.id;
  cardIndex.set(cardKey(type, item.id), {
    type: type, tmdbId: item.id, title: title,
    originalTitle: item.originalTitle || '', year: year, posterPath: item.posterPath || '',
  });
  const subscribed = subscribedFor(type, item.id);
  const poster = el('div', { class: 'card__poster' }, [
    el('a', { class: 'card__poster-link', href: detailHref, 'aria-label': title }, [
      posterEl(item.posterPath, title + ' 海报', 'w342'),
      opts.showType ? el('span', { class: 'card__badge', text: typeLabel(rawType) }) : null,
      Number.isFinite(vote) && vote > 0
        ? el('span', { class: 'card__vote' }, [iconNode('star'), String(vote.toFixed(1))])
        : null,
    ]),
    el('div', { class: classNames('card__acts', subscribed && 'is-pinned') }, [
      el('a', {
        class: 'card__act card__act--find',
        href: '#/resources/' + type + '/' + item.id + resourceQuery(item, year),
        title: '找资源',
        'aria-label': '为' + title + '找资源',
      }, iconNode('search')),
      subButtonEl(type, item.id, title, subscribed),
    ]),
  ]);
  return el('article', { class: 'card' }, [
    poster,
    el('a', { class: 'card__link', href: detailHref }, [
      el('span', { class: 'card__title', text: title }),
      el('span', { class: 'card__sub', text: subtitle }),
    ]),
  ]);
}

function chipEl(text, kind) {
  return el('span', { class: classNames('chip', kind && 'chip--' + kind), text: String(text) });
}

/* ---------- 路由 ---------- */

function parseRoute() {
  const raw = String(location.hash || '').replace(/^#/, '');
  const parts = raw.split('?');
  const segments = String(parts[0] || '').split('/').filter(Boolean);
  return {
    name: segments[0] || 'home',
    segments: segments,
    params: new URLSearchParams(parts[1] || '')
  };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function setActiveNav(name) {
  const items = document.querySelectorAll('[data-nav]');
  for (let i = 0; i < items.length; i += 1) {
    items[i].classList.toggle('is-active', items[i].getAttribute('data-nav') === name);
  }
}

let currentActions = {};

/* 视图是异步的：切页太快时，先发起的视图可能后写入 DOM，把新页面盖掉
   （表现为地址栏是任务页、画面却是设置页）。用自增令牌 + 写入门闩，
   只允许最近一次 render 发起的视图落地。 */
let renderToken = 0;

/* 过期视图不能再往页面里写东西：删除节点的方法与写入属性的入口一起挡掉。 */
const HOST_MUTATORS = ['append', 'appendChild', 'insertBefore', 'prepend', 'replaceChildren',
  'removeChild', 'replaceWith', 'replaceChildren'];

function guardedHost(host, token) {
  const stale = function () { return token !== renderToken; };
  return new Proxy(host, {
    get: function (target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (HOST_MUTATORS.indexOf(prop) >= 0) {
        return function () {
          if (stale()) return null;
          return value.apply(target, arguments);
        };
      }
      return value.bind(target);
    },
    set: function (target, prop, value) {
      if ((prop === 'innerHTML' || prop === 'textContent') && stale()) return true;
      return Reflect.set(target, prop, value);
    }
  });
}

/* 上一次渲染好的页面连同它的处理函数、滚动位置一起留着。
   回到同一页时直接把 DOM 贴回去：不重打接口、不重建节点、图片也不用再解一遍，
   所以来回切页不再有「进去就重新缓存/重新闪一下」的感觉。 */
const viewStash = new Map();
let displayedSignature = '';
let displayedActions = null;

function routeSignature(route) {
  if (route.name === 'search') return 'search:' + String(location.hash || '');
  if (route.name === 'detail') {
    return 'detail:' + (route.segments[1] || '') + '/' + (route.segments[2] || '');
  }
  if (route.name === 'calendar') return 'calendar:' + (calendarMonth || '');
  return route.name;
}

/** 哪些页面适合留着：数据型页面留着；任务页有实时推送、设置页要现场自检，都现渲染。 */
const STASHABLE = new Set(['home', 'search', 'detail']);

function stashDisplayed(host) {
  const node = host.firstElementChild;
  if (!node || !displayedSignature) return;
  // 还在骨架屏（数据没到位）时不留：留着会把加载态还原回去
  if (node.querySelector('.sk')) return;
  if (viewStash.size >= 12) viewStash.delete(viewStash.keys().next().value);
  viewStash.set(displayedSignature, {
    at: Date.now(),
    node: node,
    actions: displayedActions || {},
    scrollY: window.scrollY,
  });
}

/** 数据变了就把相关页面作废，避免贴回旧内容。 */
function dropStash(prefix) {
  viewStash.forEach(function (_value, key) {
    if (!prefix || key.indexOf(prefix) === 0) viewStash.delete(key);
  });
}

function render() {
  if (!accessReady) { showLogin(); return; }
  const route = parseRoute();
  const host = $('#view');
  if (!host) return;
  const signature = routeSignature(route);
  const keep = STASHABLE.has(route.name) && displayedSignature !== signature;
  if (keep) stashDisplayed(host);

  const token = ++renderToken;
  const ctxHost = guardedHost(host, token);
  currentActions = { retry: function () { render(); } };
  // 海报卡上的按钮出现在每个视图里，统一在这里注册；卡片索引按次渲染重建
  currentActions['card-subscribe'] = cardSubscribe;
  currentActions['card-unsubscribe'] = cardUnsubscribe;
  cardIndex.clear();
  setActiveNav(route.name);
  document.title = (PAGE_TITLES[route.name] || '影视墙') + ' · WansPilot';

  const stashed = STASHABLE.has(route.name) ? viewStash.get(signature) : null;
  if (stashed && Date.now() - stashed.at < VIEW_CACHE_MS) {
    host.replaceChildren(stashed.node);
    Object.assign(currentActions, stashed.actions);
    displayedSignature = signature;
    displayedActions = currentActions;
    window.scrollTo(0, stashed.scrollY || 0);
    return;
  }

  const view = VIEWS[route.name] || VIEWS.home;
  const fail = function (error) {
    if (token === renderToken) host.replaceChildren(pageEl(errorEl(error && error.message)));
  };
  try {
    Promise.resolve(view({ host: ctxHost, route: route })).catch(fail);
  } catch (error) {
    fail(error);
  }
  displayedSignature = signature;
  // 视图是异步的，处理函数要等它跑完才算齐；这里只记token，取的时候按当时的值
  const actionsAtRender = currentActions;
  Promise.resolve().then(function () {
    if (displayedSignature === signature) displayedActions = currentActions || actionsAtRender;
  });
  window.scrollTo(0, 0);
}

/* 没有 TMDB Key 时不要去打 TMDB 接口：那会在浏览器控制台留下 4xx 报错，
   而这属于正常的首次使用状态，不是故障。这里统一改成先渲染引导，再让用户去设置。 */
function tmdbReady() {
  return Boolean(appState.settings && (appState.settings.tmdbApiKeySet || appState.settings.tmdbApiKey));
}

function tmdbKeyMissingEl(withRetry) {
  return pageEl(el('div', { class: 'notice notice--warn' }, [
    el('p', { class: 'notice__title' }, [iconNode('alert'), el('span', { text: '还没有填写 TMDB API Key' })]),
    el('p', {
      class: 'notice__text',
      text: '影视墙、搜索与详情页的数据都来自 TMDB。'
        + '到 TMDB 账号设置里申请 API Key（v3 auth），填进「设置」页第一项即可。',
    }),
    el('div', { class: 'row row--wrap' }, [
      linkEl({ class: 'btn btn--primary', href: '#/settings?focus=key' }, null, '去填写 Key'),
      withRetry ? buttonEl({ class: 'btn', 'data-action': 'retry' }, null, '重试') : null,
    ]),
  ]));
}

/* ---------- 视图：影视墙 ---------- */

/** 影视墙的骨架，只在真的没有缓存数据时出现。 */
function homeSkeletonEl() {
  const one = function () {
    return blockEl('正在加载影视墙', railEl(skeletonCardsEl(7)));
  };
  return pageEl([one(), one()]);
}

let featuredIndex = 0;
let featuredBlocks=[],featuredItems=[],featuredDay='',featuredBatch=0,featuredChangedAt=0;
let featuredPaused=false;
function refreshFeaturedBatch(){
 featuredBatch++;featuredIndex=0;featuredDay=shanghaiDate();
 featuredItems=selectFeatured(featuredBlocks,{date:featuredDay,batch:featuredBatch});
 const hero=document.querySelector('.feature');if(hero)hero.replaceWith(featuredEl(featuredItems));
 document.querySelector('[data-feature-refresh]')?.focus({preventScroll:true});
}
setInterval(()=>{
 const hero=document.querySelector('.feature');
 if(!hero||document.hidden||featuredPaused||matchMedia('(prefers-reduced-motion: reduce)').matches||hero.matches(':hover')||hero.contains(document.activeElement))return;
 if(shanghaiDate()!==featuredDay){featuredDay=shanghaiDate();featuredBatch=0;featuredIndex=0;featuredItems=selectFeatured(featuredBlocks,{date:featuredDay});}
 else {if(featuredItems.length<2||Date.now()-featuredChangedAt<8000)return;featuredIndex=(featuredIndex+1)%featuredItems.length;}
 hero.replaceWith(featuredEl(featuredItems));
},1000);

function featuredEl(items) {
  if (!items.length) return null;
  featuredChangedAt=Date.now();
  const item = items[featuredIndex % items.length];
  const type = normalizeType(item.type);
  const href = '#/detail/' + type + '/' + item.id;
  const image = item.backdropPath ? el('img', {
    ...backdropAttributes(item.backdropPath), class: 'feature__image', alt: '', fetchpriority: 'high',
  }) : null;
  return el('section', { class: 'feature', 'aria-label': '精选推荐' }, [
    image, el('div', { class: 'feature__veil' }),
    el('div', { class: 'feature__content' }, [
      el('div', { class: 'feature__eyebrow', text: 'WansPilot 精选' }),
      el('div', { class: 'feature__meta' }, [
        el('span', { text: typeLabel(item.type) }), el('span', { text: item.year || '' }),
        item.voteAverage > 0 ? el('span', { class: 'feature__rating' }, [iconNode('star'), item.voteAverage.toFixed(1)]) : null,
      ]),
      el('h1', { class: 'feature__title', text: item.title || item.originalTitle }),
      item.originalTitle && item.originalTitle !== item.title ? el('p', { class: 'feature__original', text: item.originalTitle }) : null,
      el('p', { class: 'feature__overview', text: item.overview || '下一段值得沉浸的故事，从这里开始。' }),
      el('div', { class: 'feature__actions' }, [
        linkEl({ class: 'btn btn--primary', href: href }, 'info', '查看详情'),
        linkEl({ class: 'btn feature__secondary', href: '#/resources/' + type + '/' + item.id + resourceQuery(item, item.year) }, 'search', '寻找资源'),
      ]),
    ]),
    el('div', { class: 'feature__bottom' }, [
      el('div',{class:'feature__controls'},[buttonEl({class:'feature__control','data-feature-refresh':true,on:{click:refreshFeaturedBatch}},'refresh','换一批'),buttonEl({class:'feature__control','data-feature-pause':true,'aria-label':featuredPaused?'继续自动轮播':'暂停自动轮播','aria-pressed':String(featuredPaused),on:{click:e=>{featuredPaused=!featuredPaused;const button=e.currentTarget;button.setAttribute('aria-pressed',String(featuredPaused));button.setAttribute('aria-label',featuredPaused?'继续自动轮播':'暂停自动轮播');button.textContent=featuredPaused?'继续轮播':'暂停轮播';}}},null,featuredPaused?'继续轮播':'暂停轮播')]),
      el('div', { class: 'feature__dots', role: 'group', 'aria-label': '切换精选作品' }, items.map(function (film, index) {
        return el('button', { type: 'button', class: classNames('feature__dot', featuredIndex % items.length === index && 'is-active'),
          'aria-label': '精选 ' + (index + 1) + '：' + film.title, 'aria-pressed': featuredIndex % items.length === index ? 'true' : 'false',
          on: { click: function () { featuredIndex = index; const hero = document.querySelector('.feature'); if(hero){const focused=hero.contains(document.activeElement);hero.replaceWith(featuredEl(items));if(focused)document.querySelector('.feature__dot.is-active')?.focus({preventScroll:true});} } },
        });
      })),
    ]),
  ]);
}

function homeBlocksEl(data) {
  const blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
  if (!blocks.length) return pageEl(emptyEl('影视墙暂时没有内容。请先在设置里填写 TMDB API Key。'));
  featuredBlocks=blocks;
  const day=shanghaiDate();if(featuredDay!==day){featuredDay=day;featuredBatch=0;featuredIndex=0;}
  featuredItems=selectFeatured(blocks,{date:featuredDay,batch:featuredBatch});
  const page = pageEl([
    featuredEl(featuredItems),
    el('div', { class: 'discovery-bar' }, [
      el('nav', { class: 'discovery-links', 'aria-label': '快速探索' }, [
        linkEl({ href: '#/search?type=movie&category=popular' }, 'film', '热门电影'),
        linkEl({ href: '#/search?type=tv&category=popular' }, 'tv', '人气剧集'),
        linkEl({ href: '#/search?type=anime' }, 'star', '动漫'),
        linkEl({ href: '#/search?type=movie&category=top_rated' }, 'bookmark', '高分佳作'),
      ]),
      linkEl({ class: 'discovery-search', href: '#/search' }, 'search', '搜索影视'),
    ]),
    blocks.map(function (block, index) {
      const type = block.type === 'movie' ? 'movie' : (block.type === 'anime' ? 'anime' : 'tv');
      const category = String(block.id || '').indexOf('top') >= 0 ? 'top_rated' : 'popular';
      const items = Array.isArray(block.items) ? block.items : [];
      const body = items.length ? railEl(items.map(function (item) { return mediaCardEl(item, { type: type }); })) : emptyEl('这个区块暂时没有内容');
      const section = blockEl(block.title || '影视区块', body,
        blockMoreEl('#/search?type=' + encodeURIComponent(type) + '&category=' + encodeURIComponent(category), '探索更多'));
      section.dataset.collection = String(index + 1).padStart(2, '0');
      return section;
    }),
    el('footer', { class: 'cinema-footer' }, [el('span', { text: 'WansPilot' }), el('span', { text: '好故事，永不落幕。' }), linkEl({ href: '#/overview' }, 'activity', '运行总览')]),
  ]);
  page.classList.add('page--home');
  return page;
}

async function viewHome(ctx) {
  if (!tmdbReady()) {
    fill(ctx.host, tmdbKeyMissingEl(false));
    return;
  }
  // 数据和订阅状态都在内存里时直接出图，不再重打接口、不再闪骨架屏
  const cached = cachedPayload('/tmdb/home');
  const instant = Boolean(cached) && subState.at > 0;
  fill(ctx.host, instant ? homeBlocksEl(cached) : homeSkeletonEl());
  try {
    const [data] = await Promise.all([cachedApi('/tmdb/home'), loadSubscriptionsCached()]);
    if (!instant) fill(ctx.host, homeBlocksEl(data));
  } catch (error) {
    if (instant) toast(error.message, 'error');
    else fill(ctx.host, pageEl(errorEl(error.message)));
  }
}

/* ---------- 视图：搜索与浏览 ---------- */

const SORT_OPTIONS = [
  ['popularity', '热度'], ['rating', '评分'], ['newest', '最新'],
  ['oldest', '最早'], ['revenue', '票房'],
];

const RATING_OPTIONS = ['6', '7', '8', '9'];

const filterOptions = { genres: {}, languages: [] };

function searchHash(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  params.set('type', state.type || 'multi');
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.genre) params.set('genre', String(state.genre));
  if (state.lang) params.set('lang', String(state.lang));
  if (state.years) params.set('years', String(state.years));
  if (state.rating) params.set('rating', String(state.rating));
  if (state.sort && state.sort !== 'popularity') params.set('sort', state.sort);
  return '#/search?' + params.toString();
}

function readFilters(params) {
  const years = String(params.get('years') || '');
  let yearFrom = '';
  let yearTo = '';
  if (years === '..1989') yearTo = '1989';
  else if (/^\d{4}-\d{4}$/.test(years)) {
    yearFrom = years.slice(0, 4);
    yearTo = years.slice(5);
  }
  return {
    genre: String(params.get('genre') || ''),
    lang: String(params.get('lang') || ''),
    years: years,
    yearFrom: yearFrom,
    yearTo: yearTo,
    rating: String(params.get('rating') || ''),
    sort: String(params.get('sort') || 'popularity'),
  };
}

function hasFilters(filters) {
  return Boolean(filters.genre || filters.lang || filters.years || filters.rating
    || (filters.sort && filters.sort !== 'popularity'));
}

const YEAR_RANGES = [
  { value: '', label: '不限' },
  { value: '2020-2029', label: '2020 年代' },
  ...Array.from({ length: Math.max(0, Number(shanghaiDate().slice(0, 4)) - 2019) }, function (_, index) {
    const year = String(2020 + index);
    return { value: year + '-' + year, label: year };
  }),
  { value: '2010-2019', label: '2010 年代' },
  { value: '2000-2009', label: '2000 年代' },
  { value: '1990-1999', label: '1990 年代' },
  { value: '..1989', label: '1989 以前' },
];

/** 风格与语种的候选值，按类型缓存，避免每次进搜索页都打接口。 */
async function loadFilterOptions(browseType) {
  const key = browseType === 'tv' ? 'tv' : 'movie';
  if (!filterOptions.genres[key]) {
    try {
      const data = await api('/tmdb/genres?type=' + key);
      filterOptions.genres[key] = data.genres || [];
    } catch {
      filterOptions.genres[key] = [];
    }
  }
  if (!filterOptions.languages.length) {
    try {
      const data = await api('/tmdb/languages');
      filterOptions.languages = data.languages || [];
    } catch {
      filterOptions.languages = [];
    }
  }
  return filterOptions.genres[key];
}

function frowEl(label, chips, extraClass) {
  return el('div', { class: classNames('frow', extraClass) }, [
    el('span', { class: 'frow__label', text: label || '' }),
    el('div', { class: 'frow__chips' }, chips),
  ]);
}

function filterRowEl(label, key, options, current) {
  const active = String(current || '');
  return frowEl(label, options.map(function (entry) {
    const value = String(entry.value);
    const on = value === active;
    return buttonEl({
      class: classNames('chip', on && 'chip--active'),
      'data-action': 'filter-set',
      'data-key': key,
      'data-value': value,
      'aria-pressed': on ? 'true' : 'false',
    }, null, String(entry.label));
  }));
}

/* 类型（电影 / 剧集 / 动漫）与风格、语种一样是筛选条件，所以并到同一组 chips 里，
   不再单独占一行。关键词搜索时多一个「全部」。 */
const TYPE_TABS = {
  browse: [['movie', '电影'], ['tv', '剧集'], ['anime', '动漫']],
  search: [['multi', '全部'], ['movie', '电影'], ['tv', '剧集'], ['anime', '动漫']],
};

function typeRowEl(state, searching) {
  const tabs = searching ? TYPE_TABS.search : TYPE_TABS.browse;
  return frowEl('类型', tabs.map(function (entry) {
    const on = entry[0] === state.type;
    return el('a', {
      class: classNames('chip', on && 'chip--accent'),
      href: searchHash(Object.assign({}, state, { type: entry[0], page: 1 })),
      'aria-current': on ? 'true' : null,
      text: entry[1],
    });
  }));
}

/** 常用条件紧凑展示，较少使用的条件放入原生折叠面板。 */
function filterBarEl(state, genres, searching) {
  const box = el('div', { class: 'filters filters--browse' }, typeRowEl(state, searching));
  if (searching) return box;
  const selectFilter = function (label, key, options, current) {
    return el('label', { class: 'filter-select' }, [el('span', { text: label }),
      el('select', { 'aria-label': label, on: { change: function (event) {
        navigate(searchHash(Object.assign({}, state, { [key]: event.target.value, page: 1 })));
      } } }, options.map(function (entry) { return el('option', { value: entry.value, selected: String(current || '') === String(entry.value), text: entry.label }); })),
    ]);
  };
  box.append(el('div', { class: 'filter-common' }, [
    selectFilter('风格', 'genre', [{ value: '', label: '全部风格' }].concat(genres.map(g => ({ value: String(g.id), label: g.name }))), state.genre),
    selectFilter('排序', 'sort', SORT_OPTIONS.map(entry => ({ value: entry[0], label: entry[1] })), state.sort || 'popularity'),
  ]));
  const advanced = el('details', { class: 'filter-advanced', open: Boolean(state.lang || state.years || state.rating) }, [
    el('summary', {}, [iconNode('filter'), el('span', { text: '更多筛选' }), iconNode('chevron-down')]),
    el('div', { class: 'filter-advanced__body' }, [
      filterRowEl('语种', 'lang', [{ value: '', label: '全部' }].concat(filterOptions.languages.map(l => ({ value: l.code, label: l.name }))), state.lang),
      filterRowEl('年份', 'years', YEAR_RANGES, state.years),
      filterRowEl('评分', 'rating', [{ value: '', label: '不限' }].concat(RATING_OPTIONS.map(r => ({ value: r, label: r + ' 分以上' }))), state.rating),
    ]),
  ]);
  box.append(advanced);
  if (hasFilters(state)) {
    const selected = [];
    const groups = { genre: genres.map(g => ({ value: String(g.id), label: g.name })), lang: filterOptions.languages.map(l => ({ value:l.code,label:l.name })), years:YEAR_RANGES, rating:RATING_OPTIONS.map(r => ({value:r,label:r+' 分以上'})), sort:SORT_OPTIONS.map(entry=>({value:entry[0],label:entry[1]})) };
    Object.keys(groups).forEach(function (key) {
      if (!state[key] || (key === 'sort' && state[key] === 'popularity')) return;
      const option = groups[key].find(entry => String(entry.value) === String(state[key]));
      if (option) selected.push(buttonEl({ class:'chip selected-filter', 'data-action':'filter-set', 'data-key':key, 'data-value':state[key], 'aria-label':'移除筛选：'+option.label },'close',option.label));
    });
    box.append(el('div', { class: 'selected-filters' }, [el('span', { text:'已选' }), ...selected, buttonEl({ class:'btn btn--ghost btn--sm', 'data-action':'filter-reset' },null,'重置')]));
  }
  return box;
}

function mobileFilterPanel(content, label) {
  return el('details', { class: 'filter-panel', open: !matchMedia('(max-width: 860px)').matches }, [
    el('summary', {}, [iconNode('filter'), el('span', { text: label || '筛选条件' }), el('span', { class: 'filter-panel__hint', text: '展开 / 收起' })]), content,
  ]);
}

async function viewSearch(ctx) {
  const params = ctx.route.params;
  const query = String(params.get('q') || '').trim();
  const searching = query.length > 0;
  let type = String(params.get('type') || '');
  if (!searching) type = type === 'movie' || type === 'tv' || type === 'anime' ? type : 'movie';
  else if (type !== 'movie' && type !== 'tv' && type !== 'anime') type = 'multi';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const browseType = type === 'multi' ? 'movie' : type;
  // 关键词搜索不做本地过滤，带过来的筛选参数直接忽略，避免地址栏里留着不起作用的条件
  const filters = searching ? readFilters(new URLSearchParams()) : readFilters(params);
  const state = Object.assign({ q: query, type: type, page: page }, filters);

  // 先出筛选区与骨架卡片，避免搜索时空白一片；类型行与其它筛选条件同处一组
  // 搜索框放在页头右上角，下面整块地方留给筛选与结果
  const form = el('form', { class: 'toolbar toolbar--head', id: 'search-form', role: 'search' }, [
    el('input', {
      type: 'search', name: 'q', value: query,
      placeholder: '片名、原名或演员', autocomplete: 'off',
    }),
    buttonEl({ type: 'submit', class: 'btn btn--primary' }, 'search', '搜索'),
  ]);
  const filterHost = el('div', { class: 'filter-content', id: 'filter-host' }, typeRowEl(state, searching));
  const hint = el('div', { class: 'loading-hint', id: 'search-hint' }, [
    iconNode('loading', 'icon--spin'),
    el('span', { text: '正在加载…' }),
  ]);
  const results = el('div', { id: 'search-results' }, gridEl(skeletonCardsEl(12)));

  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, [
      el('div', {}, [
        el('h1', { text: '搜索' }),
        el('p', {
          class: 'page__sub',
          text: searching
            ? '搜索「' + query + '」的相关作品'
            : '发现电影、剧集和动漫',
        }),
      ]),
      form,
    ]),
    mobileFilterPanel(filterHost, '类型与筛选'),
    hint,
    results,
  ]));

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const value = String(form.elements.q.value || '').trim();
    // 有关键词就是关键词搜索，不带筛选；清空关键词回到浏览模式，保留原来的筛选条件
    navigate(value
      ? searchHash({ q: value, type: type === 'multi' ? 'multi' : type })
      : searchHash(Object.assign({}, filters, { q: '', type: browseType })));
  });

  if (!tmdbReady()) {
    hint.remove();
    fill(results, tmdbKeyMissingEl(false));
    return;
  }

  const genres = await loadFilterOptions(browseType);
  fill(filterHost, filterBarEl(state, genres, searching));

  // 点一下就是一次筛选：再点同一个值等于取消
  currentActions['filter-set'] = function (button) {
    const key = button.getAttribute('data-key');
    const value = button.getAttribute('data-value');
    const next = Object.assign({}, filters);
    next[key] = String(next[key] || '') === value ? '' : value;
    navigate(searchHash(Object.assign({ q: query, type: type }, next)));
  };
  currentActions['filter-reset'] = function () {
    navigate(searchHash({ q: query, type: type }));
  };
  const endpointFor = function (target) {
    return searching
      ? '/tmdb/search?q=' + encodeURIComponent(query) + '&type=' + encodeURIComponent(type) + '&page=' + target
      : '/tmdb/discover?type=' + encodeURIComponent(browseType)
        + '&genre=' + encodeURIComponent(filters.genre)
        + '&language=' + encodeURIComponent(filters.lang)
        + '&yearFrom=' + encodeURIComponent(filters.yearFrom)
        + '&yearTo=' + encodeURIComponent(filters.yearTo)
        + '&minRating=' + encodeURIComponent(filters.rating)
        + '&sort=' + encodeURIComponent(filters.sort)
        + '&page=' + target;
  };
  const endpoint = endpointFor(page);

  let data;
  try {
    // 订阅状态与结果一起就绪，卡片上的收藏图标才能一次画对；
    // 结果走内存缓存，回到上一次的筛选条件时直接出图。
    const subs = loadSubscriptionsCached().catch(function () { return null; });
    [data] = await Promise.all([cachedApi(endpoint), subs]);
  } catch (error) {
    hint.remove();
    fill(results, errorEl(error.message));
    return;
  }
  hint.remove();

  const items = data && Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    fill(results, emptyEl(searching
      ? '没有找到与「' + query + '」匹配的影视'
      : '这组筛选条件下暂时没有内容'));
    return;
  }

  const totalPages = Number(data.totalPages) || 1;
  const pageHref = function (target) {
    return searchHash(Object.assign({}, filters, { q: query, type: type, page: target }));
  };
  // 上一页 / 页码 / 下一页 整组靠右
  const pager = el('div', { class: 'row row--wrap pager' }, [
    page > 1 ? linkEl({ class: 'btn btn--sm', href: pageHref(page - 1) }, 'chevron-left', '上一页') : null,
    el('span', { class: 'pager__count', text: '第 ' + page + ' / ' + totalPages + ' 页' }),
    page < totalPages ? linkEl({ class: 'btn btn--sm', href: pageHref(page + 1) }, null, '下一页') : null,
  ]);

  const grid = gridEl(items.map(function (item) { return mediaCardEl(item, { showType: type === 'multi' }); }));
  fill(results, [el('div', { class: 'results-heading', role: 'status' }, [el('span', { text: searching ? '搜索结果' : '为你发现' }), el('span', { text: Number.isFinite(Number(data.totalResults)) ? '共 ' + Number(data.totalResults).toLocaleString() + ' 部作品' : '第 ' + page + ' 页' })]), grid, pager]);
}

/* ---------- 视图：详情 ---------- */

async function viewDetail(ctx) {
  const type = ctx.route.segments[1] === 'movie' ? 'movie' : 'tv';
  const id = ctx.route.segments[2] || '';
  let detail = cachedPayload('/tmdb/detail?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id));
  const subsReady = subState.at > 0;
  if (!detail || !subsReady) {
    fill(ctx.host, pageEl(el('div', { class: 'hero' }, el('div', { class: 'hero__inner' }, [
      el('div', { class: 'hero__poster sk' }),
      el('div', { class: 'hero__info' }, [
        el('div', { class: 'sk sk-line', style: 'height:26px;width:60%' }),
        el('div', { class: 'sk sk-line', style: 'width:35%' }),
        el('div', { class: 'sk sk-line', style: 'width:80%' }),
        el('div', { class: 'sk sk-line', style: 'width:70%' }),
      ]),
    ]))));
  }

  if (!tmdbReady()) {
    fill(ctx.host, tmdbKeyMissingEl(false));
    return;
  }

  try {
    const loaded = await Promise.all([
      cachedApi('/tmdb/detail?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id)),
      loadSubscriptionsCached().catch(function () { return null; }),
    ]);
    detail = loaded[0];
  } catch (error) {
    fill(ctx.host, pageEl(errorEl(error.message)));
    return;
  }

  const isTv = type === 'tv';
  const title = detail.title || detail.originalTitle || '未命名';
  const year = detail.year || (detail.releaseDate ? String(detail.releaseDate).slice(0, 4) : '');
  const vote = Number(detail.voteAverage);
  const facts = [];
  if (year) facts.push(year);
  if (Number(detail.runtime) > 0) facts.push(fmtMinutes(detail.runtime));
  if (isTv && Number(detail.numberOfSeasons) > 0) facts.push(detail.numberOfSeasons + ' 季');
  if (isTv && Number(detail.numberOfEpisodes) > 0) facts.push(detail.numberOfEpisodes + ' 集');
  if (detail.status) facts.push(detail.status);

  const genres = (Array.isArray(detail.genres) ? detail.genres : []).map(function (genre) {
    return chipEl(genre);
  });

  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const lastEpisode = detail.lastEpisode || null;

  const resourceQuery = '?title=' + encodeURIComponent(detail.originalTitle || title)
    + '&year=' + encodeURIComponent(year);

  const seasonsBlock = isTv
    ? blockEl('分季剧集', [
      seasons.length
        ? el('div', { class: 'seasons', id: 'season-picker' }, seasons.map(function (season) {
          return el('button', {
            type: 'button',
            class: 'season-chip',
            'data-action': 'season',
            'data-season': season.seasonNumber,
          }, [
            season.name || ('第 ' + season.seasonNumber + ' 季'),
            el('small', {
              text: (season.episodeCount || 0) + ' 集' + (season.airDate ? ' · ' + season.airDate : ''),
            }),
          ]);
        }))
        : emptyEl('没有获取到分季信息'),
      el('div', { id: 'season-panel' }),
    ])
    : null;

  const castBlock = Array.isArray(detail.cast) && detail.cast.length
    ? blockEl('演职员', el('div', { class: 'cast' }, detail.cast.map(function (person) {
      const avatar = el('div', { class: 'cast__avatar' });
      if (person.profilePath) {
        const img = el('img', {
          src: imageUrl(person.profilePath, 'w185'),
          alt: '', loading: 'lazy', decoding: 'async',
        });
        img.addEventListener('error', function () { avatar.classList.add('is-broken'); });
        avatar.append(img);
      } else {
        avatar.append(iconNode('users'));
      }
      return el('article', { class: 'cast__item' }, [
        avatar,
        el('p', { class: 'cast__name', text: person.name }),
        person.character ? el('p', { class: 'cast__role', text: person.character }) : null,
      ]);
    })), el('span', { class: 'block__hint', text: detail.cast.length + ' 位' }))
    : null;

  const stillsBlock = Array.isArray(detail.stills) && detail.stills.length
    ? blockEl('剧照', el('div', { class: 'stills' }, detail.stills.map(function (file, index) {
      const item = el('button', {
        type: 'button',
        class: 'stills__item',
        'data-action': 'still',
        'data-index': index,
        'data-src': imageUrl(file, 'w780'),
        'aria-label': '查看第 ' + (index + 1) + ' 张剧照',
      });
      const img = el('img', { src: imageUrl(file, 'w342'), alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { item.classList.add('is-broken'); });
      item.append(img);
      return item;
    })))
    : null;

  const subscribed = subscribedFor(type, detail.id || id);

  const relatedBlock = Array.isArray(detail.related) && detail.related.length
    ? blockEl('相关推荐', railEl(detail.related.map(function (item) { return mediaCardEl(item); })),
      el('span', { class: 'block__hint', text: '按 TMDB 推荐与相似度' }))
    : null;

  const hero = el('article', { class: 'hero' }, [
    el('div', { class: 'hero__bg' }, backdropEl(detail.backdropPath, title + ' 背景图')),
    el('div', { class: 'hero__inner' }, [
      el('div', { class: 'hero__poster' }, [
        posterEl(detail.posterPath, title + ' 海报', 'w500'),
        Number.isFinite(vote) && vote > 0
          ? el('span', { class: 'hero__badge' }, [iconNode('star'), String(vote.toFixed(1))])
          : null,
      ]),
      el('div', { class: 'hero__info' }, [
        el('h1', { class: 'hero__title', text: title }),
        detail.originalTitle && detail.originalTitle !== title
          ? el('p', { class: 'hero__original', text: detail.originalTitle })
          : null,
        detail.tagline ? el('p', { class: 'hero__tagline', text: detail.tagline }) : null,
        el('div', { class: 'hero__facts' }, [
          chipEl(typeLabel(detail.type || type), 'accent'),
          Number.isFinite(vote) && vote > 0
            ? el('span', { class: 'chip' }, [
              iconNode('star'),
              String(vote.toFixed(1))
                + (Number(detail.voteCount) > 0 ? '（' + Number(detail.voteCount) + ' 票）' : ''),
            ])
            : null,
          facts.map(function (fact) { return chipEl(fact); }),
          genres,
          detail.imdbId ? el('span', { class: 'chip', text: detail.imdbId }) : null,
        ]),
        lastEpisode
          ? el('p', {
            class: 'field__hint',
            text: '最新一集：第 ' + lastEpisode.season + ' 季 第 ' + lastEpisode.episode + ' 集'
              + (lastEpisode.airDate ? '（' + lastEpisode.airDate + '）' : ''),
          })
          : null,
        el('p', { class: 'hero__overview', text: detail.overview || '暂无简介。' }),
        el('div', { class: 'hero__actions' }, [
          subscribed
            ? buttonEl({
              class: 'btn btn--danger',
              'data-action': 'unsubscribe',
              'data-id': subscribed.id,
            }, 'bookmark', '已订阅，取消订阅')
            : buttonEl({ class: 'btn btn--primary', 'data-action': 'subscribe' }, 'plus', '订阅'),
          linkEl({
            class: 'btn',
            href: '#/resources/' + type + '/' + (detail.id || id) + resourceQuery,
          }, 'search', '找资源'),
          detail.trailerKey
            ? linkEl({
              class: 'btn btn--ghost',
              href: 'https://www.youtube.com/watch?v=' + detail.trailerKey,
              target: '_blank',
              rel: 'noopener noreferrer',
            }, 'play', '预告片')
            : null,
          detail.tmdbUrl
            ? linkEl({
              class: 'btn btn--ghost',
              href: detail.tmdbUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
            }, 'link', 'TMDB 页面')
            : null,
        ]),
      ]),
    ]),
  ]);

  fill(ctx.host, pageEl([
    el('div', { class: 'crumb' }, linkEl({ href: '#/search' }, 'back', '返回列表')),
    hero,
    stillsBlock,
    castBlock,
    relatedBlock,
    seasonsBlock,
  ]));

  currentActions.subscribe = async function () {
    openSubscribeDialog(detail);
  };
  currentActions.unsubscribe = async function (button) {
    await removeSubscription(button.getAttribute('data-id'), title);
    render();
  };
  currentActions.season = function (button) { loadSeason(detail, button.getAttribute('data-season')); };
  currentActions.still = function (button) {
    const src = button.getAttribute('data-src');
    if (!src) return;
    openModal({
      title: title + ' 剧照',
      size: 'lg',
      body: el('div', { class: 'lightbox' }, el('img', { src: src, alt: title + ' 剧照' })),
    });
  };
  if (seasons.length) {
    const preferred = seasons[seasons.length - 1];
    if (preferred) loadSeason(detail, String(preferred.seasonNumber));
  }
}

async function loadSeason(detail, seasonNumber) {
  const panel = $('#season-panel');
  if (!panel) return;
  const picker = $('#season-picker');
  if (picker) {
    const chips = picker.querySelectorAll('.season-chip');
    for (let i = 0; i < chips.length; i += 1) {
      chips[i].classList.toggle('is-active', chips[i].getAttribute('data-season') === String(seasonNumber));
    }
  }
  fill(panel, el('div', { class: 'episodes' }, skeletonRowsEl(3)));
  let data;
  try {
    data = await api('/tmdb/season?type=tv&id=' + encodeURIComponent(detail.id)
      + '&season=' + encodeURIComponent(seasonNumber));
  } catch (error) {
    fill(panel, errorEl(error.message));
    return;
  }
  const episodes = data && Array.isArray(data.episodes) ? data.episodes : [];
  if (!episodes.length) {
    fill(panel, emptyEl('这一季没有剧集信息'));
    return;
  }
  const resourceQuery = '?title=' + encodeURIComponent(detail.originalTitle || detail.title || '')
    + '&year=' + encodeURIComponent(detail.year || '');
  fill(panel, el('div', { class: 'episodes' }, episodes.map(function (episode) {
    const meta = [episode.airDate || '', Number(episode.runtime) > 0 ? fmtMinutes(episode.runtime) : '']
      .filter(Boolean).join(' · ');
    return el('article', { class: 'episode' }, [
      el('div', { class: 'episode__still' },
        posterEl(episode.stillPath, '第 ' + episode.episodeNumber + ' 集剧照', 'w185')),
      el('div', { class: 'episode__body' }, [
        el('div', { class: 'episode__head' }, [
          el('span', { class: 'episode__no', text: '第 ' + episode.episodeNumber + ' 集' }),
          el('span', { class: 'episode__name', text: episode.name || '未命名' }),
        ]),
        el('p', { class: 'episode__meta', text: meta }),
        episode.overview ? el('p', { class: 'episode__text', text: episode.overview }) : null,
        el('div', {}, linkEl({
          class: 'btn btn--sm',
          href: '#/resources/tv/' + detail.id + resourceQuery
            + '&season=' + seasonNumber + '&episode=' + episode.episodeNumber,
        }, 'search', '找资源')),
      ]),
    ]);
  })));
}
/* ---------- 视图：运行状况 ---------- */

async function viewHealth(ctx) {
  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, el('div', {}, [
      el('h1', { text: '运行状况' }),
      el('p', { class: 'page__sub', text: 'TMDB、索引源、磁盘和下载任务，一目了然。' }),
    ])),
    gridEl(skeletonCardsEl(6), 'grid--cards'),
  ]));

  let report;
  try {
    report = await api('/health/report');
  } catch (error) {
    fill(ctx.host, pageEl(errorEl(error.message)));
    return;
  }

  function card(title, rows, tone) {
    return el('article', { class: classNames('panel', tone && 'panel--' + tone) }, [
      el('h2', { class: 'panel__title', text: title }),
      rows.map(function (row) { return kvRowEl(row[0], row[1]); }),
    ]);
  }

  const tmdb = report.tmdb || {};
  const cap = report.capacity || {};
  const tasks = report.tasks || {};

  const panels = [
    card('TMDB', [
      ['状态', tmdb.ok ? '连通' : (tmdb.message || '未配置')],
      ['接口', getSettingsCached() && getSettingsCached().tmdbApiBase ? String(getSettingsCached().tmdbApiBase).replace(/^https?:\/\//, '') : '—'],
    ], tmdb.ok ? 'ok' : 'warn'),
    card('索引源', (report.sources || []).map(function (source) {
      return [source.name, source.ok ? '可用 · ' + source.latencyMs + ' ms' : '不可用 · ' + (source.message || '')];
    }).concat([['代理', (getSettingsCached() && getSettingsCached().proxy) ? '已配置' : '未配置']]), (report.sources || []).every(function (s) { return s.ok; }) ? 'ok' : 'warn'),
    card('磁盘', [
      ['剩余', cap.freeBytes < 0 ? '等待上报' : fmtBytes(cap.freeBytes)],
      ['配额上限', cap.quotaGB ? cap.quotaGB + ' GB' : '不限'],
      ['下载目录', cap.downloadDir || ''],
    ]),
    card('任务', [
      ['进行中', String(tasks.active || 0)],
      ['下载速率', fmtRate(tasks.rateDown || 0)],
      ['累计大小', fmtBytes(tasks.totalSizeBytes || 0)],
    ]),
  ];

  fill(ctx.host, pageEl([
    el('div', { class: 'crumb' }, linkEl({ href: '#/settings' }, 'back', '返回设置')),
    el('header', { class: 'page__head' }, [
      el('div', {}, [
        el('h1', { text: '运行状况' }),
        el('p', {
          class: 'page__sub',
          text: '采集时间 ' + String(report.at || '').replace('T', ' ').slice(0, 19),
        }),
      ]),
      buttonEl({ class: 'btn', 'data-action': 'health-refresh' }, 'refresh', '重新采集'),
    ]),
    gridEl(panels, 'grid--cards'),
  ]));

  currentActions['health-refresh'] = function () { render(); };
}

let settingsCache = null;
function getSettingsCached() {
  return settingsCache || appState.settings || null;
}

/* ---------- 视图：资源搜索 ---------- */

/* 资源列表的排序与筛选：都在前端对已取回的结果做，不再打接口。 */
const resFilters = { sort: '', res: '', size: '', seeders: '', trust: '' };

const RES_SORTS = [
  ['', '推荐'], ['seeders', '做种最多'], ['leechers', '下载最多'],
  ['size', '体积最大'], ['resolution', '清晰度最高'], ['trust', '可信度最高'],
];
const RES_RESOLUTIONS = [['', '不限'], ['2160p', '2160p'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p']];
const RES_SIZES = [
  ['', '不限'], ['lt2', '< 2 GB'], ['2to10', '2–10 GB'], ['10to30', '10–30 GB'], ['gt30', '> 30 GB'],
];
const RES_SEEDERS = [['', '不限'], ['5', '≥ 5'], ['20', '≥ 20'], ['100', '≥ 100']];
const RES_TRUST = [['', '不限'], ['55', '≥ 55'], ['70', '≥ 70'], ['85', '≥ 85']];

/** 可信度分档：四档各自一种颜色，不再出现「有的带色有的不带色」。 */
function trustBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return '';
  if (value >= 85) return 'ok';
  if (value >= 70) return 'info';
  if (value >= 55) return 'warn';
  return 'err';
}

function trustChipEl(item) {
  const band = trustBand(item.trust);
  return el('span', {
    class: classNames('chip', band && 'chip--' + band),
    title: '可信度按发布组、命名规范度、做种数与体积合理性合成，85 分以上很可信，55 分以下谨慎',
  }, [iconNode('shield'), '可信度 ' + item.trust + '（' + (item.trustLabel || '') + '）']);
}

/** 体积筛选：四档区间，未知体积（0）只在「不限」时保留。 */
function sizeInBucket(sizeBytes, bucket) {
  if (!bucket) return true;
  const bytes = Number(sizeBytes || 0);
  const GB = 1024 * 1024 * 1024;
  if (bucket === 'lt2') return bytes > 0 && bytes < 2 * GB;
  if (bucket === '2to10') return bytes >= 2 * GB && bytes <= 10 * GB;
  if (bucket === '10to30') return bytes > 10 * GB && bytes <= 30 * GB;
  if (bucket === 'gt30') return bytes > 30 * GB;
  return true;
}

function filteredResources() {
  const minSeeders = Number(resFilters.seeders) || 0;
  const minTrust = Number(resFilters.trust) || 0;
  const rows = resourceItems.map(function (item, index) { return { item: item, index: index }; })
    .filter(function (entry) {
      const item = entry.item;
      if (resFilters.res && item.resolution !== resFilters.res) return false;
      if (!sizeInBucket(item.sizeBytes, resFilters.size)) return false;
      // 站点不公布做种数时不做种子数过滤，避免中文站结果被整段筛掉
      if (minSeeders && !item.seedersUnknown && Number(item.seeders || 0) < minSeeders) return false;
      if (minTrust && Number(item.trust || 0) < minTrust) return false;
      return true;
    });
  const sorters = {
    seeders: function (a, b) { return Number(b.item.seeders || 0) - Number(a.item.seeders || 0); },
    leechers: function (a, b) { return Number(b.item.leechers || 0) - Number(a.item.leechers || 0); },
    size: function (a, b) { return Number(b.item.sizeBytes || 0) - Number(a.item.sizeBytes || 0); },
    resolution: function (a, b) { return Number(b.item.resolutionRank || 0) - Number(a.item.resolutionRank || 0); },
    trust: function (a, b) { return Number(b.item.trust || 0) - Number(a.item.trust || 0); },
  };
  const sorter = sorters[resFilters.sort];
  return sorter ? rows.slice().sort(sorter) : rows;
}

/** 排序与筛选两组 chips；选中值再点一次等于取消。 */
function resourceFilterBarEl(state, shownCount) {
  const row = function (label, key, options, current) {
    return frowEl(label, options.map(function (entry) {
      const value = String(entry[0]);
      const on = String(current || '') === value;
      return buttonEl({
        class: classNames('chip', on && 'chip--active'),
        'data-action': 'res-set',
        'data-key': key,
        'data-value': value,
        'aria-pressed': on ? 'true' : 'false',
      }, null, entry[1]);
    }));
  };
  return [
    row('排序', 'sort', RES_SORTS, state.sort),
    row('清晰度', 'res', RES_RESOLUTIONS, state.res),
    row('体积', 'size', RES_SIZES, state.size),
    row('做种', 'seeders', RES_SEEDERS, state.seeders),
    row('可信度', 'trust', RES_TRUST, state.trust),
    el('div', { class: 'frow frow--note' }, el('span', {
      class: 'field__hint',
      text: shownCount === undefined ? '按上面的条件在已取回的结果里排序与筛选' : '符合条件 ' + shownCount + ' 条',
    })),
  ];
}

/** 一条资源：标题 + 标签（含四档可信度）+ 元信息 + 加入下载。 */
function resourceRowEl(item, index) {
  const tags = [];
  if (item.resolution) tags.push(el('span', { class: 'tag tag--accent', text: item.resolution }));
  if (item.codec) tags.push(el('span', { class: 'tag', text: item.codec }));
  if (item.sourceTag) tags.push(el('span', { class: 'tag', text: item.sourceTag }));
  if (item.isSeasonPack) tags.push(el('span', { class: 'tag tag--accent', text: '整季合集' }));
  if (!item.isSeasonPack && item.season && item.episode) {
    tags.push(el('span', { class: 'tag', text: 'S' + pad2(item.season) + 'E' + pad2(item.episode) }));
  }
  if (Number.isFinite(item.trust)) tags.push(trustChipEl(item));
  const meta = [
    el('span', {}, ['大小 ', el('strong', { text: item.sizeBytes ? fmtBytes(item.sizeBytes) : '未知' })]),
    el('span', {}, ['做种 ', el('strong', { text: item.seedersUnknown ? '未知' : String(item.seeders || 0) })]),
    el('span', {}, ['下载 ', el('strong', { text: String(item.leechers || 0) })]),
    el('span', { text: item.indexerName || item.indexer || '未知来源' }),
    el('span', { text: item.publishedAt ? fmtDate(item.publishedAt) : '发布时间未知' }),
  ];
  const disabled = !item.magnet && !item.infoHash && !item.releaseId;
  return el('article', { class: 'res' }, [
    el('div', { class: 'res__main' }, [
      el('h3', { class: 'res__title', text: item.title || '未命名资源' }),
      el('div', { class: 'res__tags' }, tags),
      el('div', { class: 'res__meta' }, meta),
    ]),
    buttonEl({
      class: 'btn btn--primary',
      disabled: disabled ? true : null,
      'data-action': 'add-resource',
      'data-index': index,
    }, 'plus', disabled ? '没有链接' : '加入下载'),
  ]);
}


let resourceItems = [];

const SOURCE_PRESETS = [
  { label: '选择常用预设…', name: '', type: 'torznab', url: '' },
  { label: 'Mikan 蜜柑计划（中文动漫，直连）', name: 'Mikan 蜜柑计划', type: 'rss', url: 'https://mikanime.tv/RSS/Search?searchstr={query}' },
  { label: '动漫花园（中文动漫，多需代理）', name: '动漫花园', type: 'rss', url: 'https://share.dmhy.org/topics/rss/rss.xml?keyword={query}' },
  { label: 'acg.rip（中文综合，多需代理）', name: 'acg.rip', type: 'rss', url: 'https://acg.rip/.xml?term={query}' },
  { label: 'Nyaa（动漫，需代理）', name: 'Nyaa', type: 'rss', url: 'https://nyaa.si/?page=rss&q={query}&c=0_0&f=0' },
  { label: 'Prowlarr（本机聚合，Torznab）', name: 'Prowlarr', type: 'torznab', url: 'http://192.168.1.10:9696/1/api' },
  { label: 'Jackett（本机聚合，Torznab）', name: 'Jackett', type: 'torznab', url: 'http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/api' },
];

async function viewResources(ctx) {
  const type = ctx.route.segments[1] === 'movie' ? 'movie' : 'tv';
  const id = ctx.route.segments[2] || '';
  const params = ctx.route.params;
  const title = String(params.get('title') || '');
  const keyword = params.has('q') ? String(params.get('q') || '') : title;
  const season = String(params.get('season') || '');
  const episode = String(params.get('episode') || '');
  const year = String(params.get('year') || '');

  const heading = (title || keyword || ('TMDB #' + id))
    + (season ? ' · 第 ' + season + ' 季' : '')
    + (episode ? ' 第 ' + episode + ' 集' : '');

  const form = el('form', { class: 'toolbar', id: 'resource-form' }, [
    el('label', { class: 'field field--grow' }, [
      el('span', { class: 'field__label', text: '关键词' }),
      el('input', {
        type: 'search', name: 'q', value: keyword,
        placeholder: '片名或发布组', autocomplete: 'off',
      }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: '季' }),
      el('input', { type: 'number', name: 'season', min: '0', step: '1', value: season }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: '集' }),
      el('input', { type: 'number', name: 'episode', min: '0', step: '1', value: episode }),
    ]),
    buttonEl({ type: 'submit', class: 'btn btn--primary' }, 'search', '搜索资源'),
  ]);
  const sourceHost = el('div', { class: 'sources', id: 'resource-sources' });
  const filterHost = el('div', { class: 'filters', id: 'resource-filters' },
    resourceFilterBarEl(resFilters));
  const list = el('div', { class: 'res-list', id: 'resource-list' }, skeletonRowsEl(4));

  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, [el('div', {}, [
      el('div', { class: 'crumb' }, linkEl({ href: '#/detail/' + type + '/' + id }, 'back', '返回详情')),
      el('h1', { text: '找资源' }),
      el('p', { class: 'page__sub', text: heading }),
    ]), linkEl({ class: 'btn', href: '#/sources' }, 'settings', '管理资源渠道')]),
    form,
    mobileFilterPanel(filterHost, '资源筛选'),
    sourceHost,
    list,
  ]));

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const next = new URLSearchParams();
    next.set('title', title);
    next.set('year', year);
    next.set('q', String(form.elements.q.value || '').trim());
    if (form.elements.season.value) next.set('season', String(form.elements.season.value));
    if (form.elements.episode.value) next.set('episode', String(form.elements.episode.value));
    navigate('#/resources/' + type + '/' + id + '?' + next.toString());
  });

  const search = new URLSearchParams();
  search.set('q', keyword);
  search.set('type', type);
  if (season) search.set('season', season);
  if (episode) search.set('episode', episode);
  if (year) search.set('year', year);
  if (id) search.set('tmdbId', id);

  let data;
  try {
    data = await api('/resources?' + search.toString());
  } catch (error) {
    fill(list, errorEl(error.message));
    return;
  }

  const sources = Array.isArray(data && data.sources) ? data.sources : [];
  fill(sourceHost, sources.map(function (source) {
    const ok = source.ok === true;
    const text = ok
      ? (source.name || source.id) + ' · ' + (source.count || 0) + ' 条 · ' + (source.latencyMs || 0) + ' ms'
      : (source.name || source.id) + ' · ' + (source.error || '不可用');
    return chipEl(text, ok ? 'ok' : 'err');
  }));

  resourceItems = data && Array.isArray(data.items) ? data.items : [];
  if (!resourceItems.length) {
    fill(list, emptyEl('没有找到可用资源。可以换个关键词，或调整季/集后重新搜索。'));
    return;
  }

  const paint = function () {
    const shown = filteredResources();
    fill(filterHost, resourceFilterBarEl(resFilters, shown.length));
    if (!shown.length) {
      fill(list, emptyEl('当前筛选条件下没有资源。放宽「清晰度 / 做种 / 可信度」再试。'));
      return;
    }
    fill(list, shown.map(function (entry) { return resourceRowEl(entry.item, entry.index); }));
  };
  currentActions['res-set'] = function (button) {
    const key = button.getAttribute('data-key');
    const value = button.getAttribute('data-value');
    resFilters[key] = String(resFilters[key] || '') === value ? '' : value;
    paint();
  };

  paint();

  currentActions['add-resource'] = async function (button) {
    const item = resourceItems[Number(button.getAttribute('data-index'))];
    if (!item) return;
    button.disabled = true;
    let body = null;
    if (item.releaseId) body = {releaseId:item.releaseId};
    else if (item.magnet) body = { magnet: item.magnet };
    else if (item.infoHash) body = { infoHash: item.infoHash };
    if (body) body.sizeBytes = Number(item.sizeBytes) || 0;
    if (!body) {
      toast('这条资源既没有磁力链接也没有 infoHash', 'error');
      button.disabled = false;
      return;
    }
    try {
      await api('/tasks', { method: 'POST', body: body });
      button.classList.add('btn--done');
      fill(button, [iconNode('check'), el('span', { text: '已加入' })]);
      toast('已加入下载队列', 'ok');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
    }
  };
}

/* ---------- 视图：下载任务 ---------- */

const live = {
  mode: 'idle',
  failures: 0,
  source: null,
  retryTimer: null,
  pollTimer: null
};

const taskState = { items: [], stats: null };
const taskNodes = new Map();
const selectedTasks=new Set();
const taskFilters={q:'',status:'all',sort:'added'};
let taskBatchBusy=false;

function activeTaskCount() {
  return taskState.items.filter(function (item) {
    return ACTIVE_TASK_STATES.indexOf(item.state) >= 0;
  }).length;
}

function updateNavBadge() {
  const count = activeTaskCount();
  const nodes = document.querySelectorAll('[data-nav="tasks"]');
  for (let i = 0; i < nodes.length; i += 1) {
    let badge = nodes[i].querySelector('.nav__badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav__badge';
        nodes[i].appendChild(badge);
      }
      badge.textContent = String(count);
      badge.hidden = false;
    } else if (badge) {
      badge.hidden = true;
    }
  }
}

function applyTasks(data) {
  if (!data || !Array.isArray(data.items)) return;
  taskState.items = data.items;
  taskState.stats = data.stats || null;
  updateNavBadge();
  paintTasks();
}

function startLive() {
  stopLive();
  connectLive();
}

function stopLive() {
  if (live.source) { live.source.close(); live.source = null; }
  clearTimeout(live.retryTimer);
  clearInterval(live.pollTimer);
  live.retryTimer = null;
  live.pollTimer = null;
}

function connectLive() {
  live.mode = 'sse';
  setLiveNote();
  let source;
  try {
    source = new EventSource(API_ROOT + '/tasks/events');
  } catch {
    live.failures = 2;
    usePolling();
    return;
  }
  live.source = source;
  source.onopen = function () {
    live.failures = 0;
    live.mode = 'sse';
    setLiveNote();
  };
  source.onmessage = function (event) {
    let payload = null;
    try { payload = JSON.parse(event.data); } catch { return; }
    applyTasks(payload);
  };
  source.onerror = function () {
    // EventSource 默认自动重连，这里手动管理，便于统计连续失败次数并降级。
    if (live.source) { live.source.close(); live.source = null; }
    live.failures += 1;
    if (live.failures >= 2) { usePolling(); return; }
    live.mode = 'retrying';
    setLiveNote();
    clearTimeout(live.retryTimer);
    live.retryTimer = setTimeout(connectLive, 3000);
  };
}

function usePolling() {
  if (live.source) { live.source.close(); live.source = null; }
  clearTimeout(live.retryTimer);
  live.mode = 'polling';
  setLiveNote();
  pollTasks();
  if (!live.pollTimer) live.pollTimer = setInterval(pollTasks, 3000);
}

async function pollTasks() {
  try {
    applyTasks(await api('/tasks'));
  } catch {
    // 保留上一次数据，不打断界面。
  }
}

function setLiveNote() {
  const note = $('#live-note');
  if (!note) return;
  if (live.mode === 'polling') {
    note.hidden = false;
    fill(note, [
      iconNode('alert'),
      el('span', { text: '实时推送不可用，已改为每 3 秒轮询一次。' }),
      buttonEl({ class: 'btn btn--sm', 'data-action': 'live-retry' }, null, '重试实时推送'),
    ]);
  } else if (live.mode === 'retrying') {
    note.hidden = false;
    fill(note, [iconNode('alert'), el('span', { text: '实时连接断开，正在重连…' })]);
  } else {
    note.hidden = true;
    note.replaceChildren();
  }
}

function taskSignature(task) {
  return [task.state, task.name, task.sizeBytes, task.error || '', task.savePath || '',
    Array.isArray(task.files) ? task.files.length : 0].join('|');
}

function taskRowEl(task) {
  const state = TASK_STATES[task.state] || { label: task.state || '未知', kind: 'info' };
  const total = Number(task.sizeBytes) || 0;
  const done = Number(task.downloadedBytes) || 0;
  const progress = Number.isFinite(Number(task.progress)) ? Math.max(0, Math.min(1, Number(task.progress))) : 0;
  const percent = (progress * 100).toFixed(1);
  const barKind = task.state === 'error' ? 'bar--err' : (task.state === 'completed' || task.state === 'seeding' ? 'bar--ok' : '');
  const canResume = task.state === 'paused' || task.state === 'error';
  const canPause = ACTIVE_TASK_STATES.indexOf(task.state) >= 0;
  return frag([
    el('div', { class: 'task__head' }, [
      el('input',{type:'checkbox',class:'task-select','aria-label':'选择任务 '+(task.name || task.id),checked:selectedTasks.has(task.id),on:{change:e=>{if(e.target.checked)selectedTasks.add(task.id);else selectedTasks.delete(task.id);paintTaskSelection();}}}),
      el('h3', { class: 'task__name', title: task.name || task.id, text: task.name || task.id }),
      el('span', { class: classNames('chip', 'chip--' + state.kind), text: state.label }),
    ]),
    el('div', { class: 'task__progress' }, [el('div', { class: classNames('bar', barKind), role:'progressbar', 'aria-label':'下载进度', 'aria-valuemin':'0', 'aria-valuemax':'100', 'aria-valuenow':percent }, el('i', { 'data-progress': true, style: 'width:' + percent + '%' })), el('span', { class:'task__percent', 'data-percent':true, text:percent+'%' })]),
    el('div', { class: 'task__meta' }, [
      el('span', { 'data-size': true, text: fmtBytes(done) + ' / ' + fmtBytes(total) }),
      el('span', { 'data-rate': true, text: '↓ ' + fmtRate(task.rateDown) }),
      el('span', { 'data-peers': true, text: String(task.peers || 0) + ' 个节点' }),
      el('span', { 'data-eta': true, text: '剩余 ' + fmtSeconds(task.etaSeconds) }),
    ]),
    el('div', { class: 'task__foot' }, [
      el('details', { class:'task__details' }, [el('summary', { text:'详情' }), el('p', { class: 'task__path', text: task.savePath || '未提供保存目录' })]),
      el('div', { class: 'task__actions' }, [
        canPause ? buttonEl({
          class: 'btn btn--sm', 'data-action': 'task-pause', 'data-id': task.id,
        }, 'pause', '暂停') : null,
        canResume ? buttonEl({
          class: 'btn btn--sm', 'data-action': 'task-resume', 'data-id': task.id,
        }, 'play', '继续') : null,
        buttonEl({
          class: 'btn btn--sm btn--danger', 'data-action': 'task-delete', 'data-id': task.id,
        }, 'trash', '删除'),
      ]),
    ]),
    task.error ? el('p', { class: 'task__error', text: task.error }) : null,
  ]);
}

function paintTasks() {
  const list = $('#task-list');
  const statsHost = $('#task-stats');
  if (!list || !statsHost) return;

  const stats = taskState.stats || {};
  fill(statsHost, [
    ['进行中', Number(stats.active) || activeTaskCount()],
    ['已完成', Number(stats.completed) || 0],
    ['下载速率', fmtRate(stats.rateDown)],
    ['上传速率', fmtRate(stats.rateUp)],
    ['累计大小', fmtBytes(stats.totalSizeBytes)]
  ].map(function (entry) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__value', text: entry[1] }),
      el('span', { class: 'stat__label', text: entry[0] }),
    ]);
  }));

  const stale = list.querySelector('.notice');
  if (stale) stale.remove();

  const visible=filterTasks(taskState.items,taskFilters);
  const visibleIds=new Set(visible.map(task=>task.id));for(const id of selectedTasks)if(!visibleIds.has(id))selectedTasks.delete(id);
  const seen = new Set();
  visible.forEach(function (task, index) {
    seen.add(task.id);
    let node = taskNodes.get(task.id);
    if (!node) {
      node = document.createElement('article');
      node.className = 'task';
      taskNodes.set(task.id, node);
    }
    const signature = taskSignature(task);
    if (node.getAttribute('data-signature') !== signature) {
      fill(node, taskRowEl(task));
      node.setAttribute('data-signature', signature);
    } else {
      const progress = Number(task.progress) || 0;
      const bar = node.querySelector('[data-progress]');
      if (bar) { bar.style.width = (progress * 100).toFixed(1) + '%'; bar.parentElement.setAttribute('aria-valuenow', (progress * 100).toFixed(1)); }
      const percentLabel = node.querySelector('[data-percent]'); if (percentLabel) percentLabel.textContent = (progress * 100).toFixed(1) + '%';
      const size = node.querySelector('[data-size]');
      if (size) {
        size.textContent = fmtBytes(task.downloadedBytes) + ' / ' + fmtBytes(task.sizeBytes);
      }
      const rate = node.querySelector('[data-rate]');
      if (rate) rate.textContent = '↓ ' + fmtRate(task.rateDown);
      const peers = node.querySelector('[data-peers]');
      if (peers) peers.textContent = String(task.peers || 0) + ' 个节点';
      const eta = node.querySelector('[data-eta]');
      if (eta) eta.textContent = '剩余 ' + fmtSeconds(task.etaSeconds);
    }
    const current = list.children[index];
    if (current !== node) list.insertBefore(node, current || null);
  });

  taskNodes.forEach(function (node, id) {
    if (!seen.has(id)) { node.remove(); taskNodes.delete(id); }
  });

  if (!visible.length) {
    fill(list, emptyEl(taskState.items.length?'没有符合筛选的任务。':'还没有下载任务。点右上角「导入任务」粘贴磁力链接或选择种子文件。'));
  }
  paintTaskSelection();
}

async function viewTasks(ctx) {
  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, [
      el('div', {}, [
        el('h1', { text: '下载任务' }),
        el('p', { class: 'page__sub', text: '查看传输进度，管理下载与做种' }),
      ]),
      el('div', { class: 'page__actions' }, [
        buttonEl({ class: 'btn btn--primary', 'data-action': 'import' }, 'plus', '导入任务'),
        buttonEl({ class: 'btn', 'data-action': 'refresh' }, 'refresh', '刷新'),
      ]),
    ]),
    el('p', { id: 'live-note', class: 'live-note', hidden: true }),
    el('div', { id: 'task-stats', class: 'stats' }),
    taskTools(),
    el('div', { class:'list-heading' }, [el('h2', { text:'全部任务' }), el('span', { id:'task-refresh-result', role:'status', text:'自动同步进度' })]),
    el('div', { id: 'task-list', class: 'task-list' }),
  ]));

  taskNodes.clear();
  paintTasks();
  setLiveNote();
  if (live.mode === 'idle') startLive();

  try {
    applyTasks(await api('/tasks'));
  } catch (error) {
    if (!taskState.items.length) {
      fill($('#task-list'), errorEl(error.message));
    } else {
      toast(error.message, 'error');
    }
  }

  currentActions.refresh = async function (button) {
    const note=$('#task-refresh-result'); button.disabled=true; if (note) note.textContent='正在同步…';
    try { applyTasks(await api('/tasks')); if (note) note.textContent='已同步 · '+shanghaiTime(); }
    catch (error) { if (note) note.textContent=error.message; }
    finally { if (button.isConnected) button.disabled=false; }
  };
  currentActions.import = function () { openImportDialog(''); };
  currentActions['live-retry'] = function () { live.failures = 0; startLive(); };
  currentActions['task-pause'] = function (button) { changeTask(button, 'pause'); };
  currentActions['task-resume'] = function (button) { changeTask(button, 'resume'); };
  currentActions['task-delete'] = function (button) { deleteTask(button.getAttribute('data-id')); };
}

function taskTools() {
  return el('section',{class:'management-tools','aria-label':'任务筛选与批量操作'},[
    el('div',{class:'management-filters'},[
      el('input',{type:'search',placeholder:'搜索下载任务…','aria-label':'搜索任务',value:taskFilters.q,on:{input:e=>{taskFilters.q=e.target.value;paintTasks();}}}),
      selectControl('任务状态',[['all','全部状态'],['downloading','正在下载'],['active','进行中与做种'],['paused','已暂停'],['completed','已完成'],['error','出错']],taskFilters.status,value=>{taskFilters.status=value;paintTasks();}),
      selectControl('任务排序',[['added','最近添加'],['name','按名称'],['progress','按进度'],['speed','按速度']],taskFilters.sort,value=>{taskFilters.sort=value;paintTasks();}),
    ]),
    el('div',{class:'management-batch'},[
      buttonEl({class:'btn btn--sm',on:{click:()=>{filterTasks(taskState.items,taskFilters).forEach(task=>selectedTasks.add(task.id));paintTaskSelection();}}},null,'全选当前结果'),
      buttonEl({class:'btn btn--sm btn--ghost',on:{click:()=>{selectedTasks.clear();paintTaskSelection();}}},null,'清空'),
      el('span',{id:'task-selection',class:'field__hint',role:'status',text:'已选 0 项'}),
      ...[['pause','暂停所选'],['resume','继续所选']].map(([action,label])=>buttonEl({class:'btn btn--sm','data-task-batch':action,disabled:true,on:{click:()=>runTaskBatch(action)}},action==='pause'?'pause':'play',label)),
    ]),
  ]);
}
function paintTaskSelection(){const note=$('#task-selection');if(note)note.textContent='已选 '+selectedTasks.size+' 项';$$('[data-task-batch]').forEach(button=>button.disabled=taskBatchBusy||!selectedTasks.size||selectedTasks.size>50);taskNodes.forEach((node,id)=>{const checkbox=node.querySelector('.task-select');if(checkbox)checkbox.checked=selectedTasks.has(id);});}
async function runTaskBatch(action){if(taskBatchBusy||!selectedTasks.size)return;taskBatchBusy=true;paintTaskSelection();try{const result=await api('/tasks/batch',{method:'POST',body:{action,ids:[...selectedTasks]}});applyTasks(result);batchResults('批量下载操作结果',result.results || []);}catch(error){toast(error.message,'error');}finally{taskBatchBusy=false;paintTaskSelection();}}

function taskFeedback(id, text, error) {
  const row = taskNodes.get(id); if (!row?.isConnected) return;
  let note = row.querySelector('.task__feedback');
  if (!note) { note = el('p', { class:'task__feedback', role:'status' }); row.append(note); }
  note.textContent = text; note.classList.toggle('is-error', Boolean(error));
}
async function changeTask(button, what) {
  const id = button.getAttribute('data-id'), original = Array.from(button.childNodes).map(node=>node.cloneNode(true));
  button.disabled = true; button.setAttribute('aria-busy','true'); button.textContent = what === 'pause' ? '暂停中…' : '恢复中…';
  try {
    const result = await api('/tasks/' + encodeURIComponent(id) + '/' + what, { method:'POST' });
    if (result?.task) {
      const index = taskState.items.findIndex(item=>item.id===result.task.id);
      if (index>=0) taskState.items[index]=result.task;
      paintTasks();
    } else { await pollTasks(); }
    taskFeedback(id, what === 'pause' ? '任务已暂停' : '任务已继续', false);
  } catch (error) { taskFeedback(id, error.message, true); }
  finally { if (button.isConnected) { button.disabled=false; button.removeAttribute('aria-busy'); button.replaceChildren(...original); } }
}

async function deleteTask(id) {
  const task = taskState.items.find(function (item) { return item.id === id; });
  let deleteFiles = false;
  const confirmed = await confirmDialog({
    title: '删除任务',
    message: '确定要删除「' + ((task && task.name) || id) + '」吗？',
    confirmText: '删除',
    danger: true,
    extra: el('label', { class: 'switch' }, [
      el('input', { type: 'checkbox', id: 'delete-files' }),
      ' 同时删除已下载的文件',
    ]),
    onMount: function (panel) {
      const checkbox = panel.querySelector('#delete-files');
      checkbox.addEventListener('change', function () { deleteFiles = checkbox.checked; });
    }
  });
  if (!confirmed) return;
  try {
    await api('/tasks/' + encodeURIComponent(id) + '?deleteFiles=' + (deleteFiles ? '1' : '0'), { method: 'DELETE' });
    taskState.items = taskState.items.filter(function (item) { return item.id !== id; });
    paintTasks();
    updateNavBadge();
    toast('任务已删除', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------- 视图：订阅 ---------- */

let subscriptionItems = [];
const selectedSubscriptions=new Set();
const subFilters={q:'',status:'all',sort:'next'};
let subscriptionBatchBusy=false;

/* 订阅页只列「自己订阅了什么」，按电影与剧集分档；每天更新哪些在「更新日历」页。 */
let subscribeTab = 'auto';

async function viewSubscribe(ctx) {
  const wanted = String(ctx.route.params.get('type') || '');
  subscribeTab = wanted === 'movie' || wanted === 'tv' ? wanted : 'auto';

  const fileInput = el('input', {
    class: 'hidden-input',
    type: 'file',
    id: 'sub-import-file',
    accept: '.json,application/json',
  });
  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, [
      el('div', {}, [
        el('h1', { text: '订阅' }),
        el('p', {
          class: 'page__sub',
          text: '关注的作品、下载进度与下一次更新',
        }),
      ]),
      el('div', { class: 'page__actions' }, [
        linkEl({
          class: 'btn',
          href: API_ROOT + '/subscriptions/export',
          download: 'wanspilot-订阅.json',
        }, 'upload', '导出订阅'),
        buttonEl({ class: 'btn btn--primary', 'data-action': 'sub-import' }, 'plus', '导入订阅'),
        fileInput,
      ]),
    ]),
    el('div', { class: 'sub-tabs', id: 'sub-tabs' }),
    subscriptionTools(),
    el('p',{class:'subscription-sync',id:'subscription-sync',role:'status',text:'每 3 秒同步订阅状态'}),
    el('div', { class: 'sub-list', id: 'sub-list' }, skeletonRowsEl(3)),
  ]));
  fileInput.addEventListener('change', async function () {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      toast('读取文件失败', 'error');
      return;
    }
    try {
      const result = await api('/subscriptions/import', { method: 'POST', body: { json: text } });
      toast('已导入 ' + ((result && result.imported) || 0) + ' 条，跳过 ' + ((result && result.skipped) || 0) + ' 条', 'ok');
      dropStash('subscribe');
      loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // 订阅卡：右击（触屏点三个点、键盘回车）出操作菜单
  const list = $('#sub-list');
  const itemOf = function (node) {
    return subscriptionItems.find(function (entry) { return entry.id === node.getAttribute('data-id'); });
  };
  if (list) {
    list.addEventListener('contextmenu', function (event) {
      const card = event.target.closest && event.target.closest('.sub-card');
      if (!card) return;
      event.preventDefault();
      const item = itemOf(card);
      if (item) openSubMenu(item, event);
    });
    list.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest && event.target.closest('.sub-card');
      if (!card || event.target !== card) return;
      event.preventDefault();
      const item = itemOf(card);
      if (item) openSubMenu(item, { currentTarget: card });
    });
  }
  currentActions['sub-menu'] = function (button) {
    const item = itemOf(button);
    if (item) openSubMenu(item, { currentTarget: button });
  };
  currentActions['sub-episodes'] = function(button){openEpisodeManager(button.dataset.id);};
  currentActions['sub-activity'] = function(button){openSubscriptionActivity(button.dataset.id);};
  currentActions['sub-import'] = function () { fileInput.click(); };
  currentActions['sub-upgrade'] = async function (button) {
    button.disabled = true;
    try {
      await api('/subscriptions/' + encodeURIComponent(button.getAttribute('data-id')) + '/upgrade', { method: 'POST' });
      toast('已加入更好的版本', 'ok');
      loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
  currentActions['sub-upgrade-skip'] = async function (button) {
    try {
      await api('/subscriptions/' + encodeURIComponent(button.getAttribute('data-id')) + '/upgrade', { method: 'DELETE' });
      toast('已忽略这次提示', 'ok');
      loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  currentActions['sub-check'] = async function (button) {
    const id = button.getAttribute('data-id');
    button.disabled = true;
    try {
      const result = await api('/subscriptions/' + encodeURIComponent(id) + '/check', { method: 'POST' });
      toast((result && result.message) || '检查已启动', 'ok');
      dropStash('subscribe');
      await loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally { if(button.isConnected)button.disabled=false; }
  };
  currentActions['sub-toggle'] = async function (button) {
    const id = button.getAttribute('data-id');
    const next = button.getAttribute('data-next') === '1';
    button.disabled = true;
    try {
      await api('/subscriptions/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: next } });
      dropStash('subscribe');
      toast(next ? '订阅已启用' : '订阅已暂停', 'ok');
      loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  };
  currentActions['sub-edit'] = function (button) { openSubscriptionEditor(button.getAttribute('data-id')); };
  currentActions['sub-delete'] = async function (button) {
    const id = button.getAttribute('data-id');
    const item = subscriptionItems.find(function (entry) { return entry.id === id; });
    try {
      await api('/subscriptions/' + encodeURIComponent(id), { method: 'DELETE' });
      dropStash('subscribe');
      toast('已取消订阅「' + ((item && item.title) || id) + '」（下载不受影响）', 'ok');
      loadSubscriptions(true);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  await loadSubscriptions(true);
  loadCalendar();
}

let calendarMonth = '';
let calendarData = null;
let calendarLoadId = 0;
let calendarLayout = 'month';
let calendarFilter = { status: 'all', series: 'all' };
const CAL_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const CAL_STATUS = {
  downloaded: { label: '已完成', kind: 'done' }, downloading: { label: '下载中', kind: 'downloading' },
  missing: { label: '待补集（全部）', kind: 'missing' }, upcoming: { label: '未播出', kind: 'upcoming' },
  partial: { label: '部分完成', kind: 'partial' },
};
function thisMonth() { return localDateKey().slice(0, 7); }
function calendarStatusEl(item) {
  const state = CAL_STATUS[item.status] || CAL_STATUS.missing;
  return el('span', { class: 'cal-status is-' + state.kind, text: item.status === 'partial' ? item.downloaded + '/' + item.count + ' 已完成' : state.label });
}
function calendarItemEl(item, expanded) {
  const state = CAL_STATUS[item.status] || CAL_STATUS.missing;
  const poster = el('span', { class: 'cal__poster' }, item.posterPath
    ? el('img', { src: imageUrl(item.posterPath, 'w154'), alt: '', loading: 'lazy', decoding: 'async' }) : iconNode('film'));
  return el('a', {
    class: 'cal__item is-' + state.kind,
    href: '#/detail/' + (item.type === 'movie' ? 'movie' : 'tv') + '/' + item.tmdbId,
    title: item.title + ' · ' + item.episodeLabel + ' · ' + state.label,
  }, [poster, el('span', { class: 'cal-event__body' }, [
    el('strong', { class: 'cal-event__title', text: item.title }),
    el('span', { class: 'cal-event__episode', text: item.episodeLabel }),
    expanded && item.count === 1 && item.episodeName ? el('span', { class: 'cal-event__name', text: item.episodeName }) : null,
    calendarStatusEl(item),
  ])]);
}
function openCalendarDay(cell) {
  const groups = groupCalendarItems(cell.items);
  openModal({ title: cell.date + ' · 周' + CAL_WEEKDAYS[weekdayOf(cell.date)], size: 'md', body: el('div', { class: 'cal-day-detail' }, [
    el('p', { class: 'page__sub', text: groups.length + ' 部剧集 · ' + cell.items.length + ' 集更新' }),
    groups.length ? groups.map(function (group) {
      return el('section', { class: 'cal-day-detail__group' }, [calendarItemEl(group, true),
        el('div', { class: 'cal-day-detail__episodes' }, group.entries.map(function (episode) {
          return el('div', {}, [el('span', { text: 'E' + pad2(episode.episode) + (episode.episodeName ? ' · ' + episode.episodeName : '') }), calendarStatusEl(episode)]);
        })),
        el('a', { class: 'btn btn--sm', href: '#/resources/tv/' + group.tmdbId + '?title=' + encodeURIComponent(group.title) + '&season=' + group.season + (group.count === 1 ? '&episode=' + group.entries[0].episode : '') }, [iconNode('search'), '寻找资源',]),
      ]);
    }) : emptyEl('这一天暂无符合筛选条件的更新'),
  ]) });
  // 跳转详情或资源时收起弹窗，避免遮住新页面。
  $('#modal-root').querySelectorAll('a').forEach(function (link) { link.addEventListener('click', closeModal); });
}
function calendarCellEl(cell, todayKey) {
  if (!cell) return el('div', { class: 'cal__cell cal__cell--blank', 'aria-hidden': 'true' });
  const groups = groupCalendarItems(cell.items);
  const list = el('div', { class: 'cal__items' }, groups.slice(0, 3).map(function (group) { return calendarItemEl(group); }));
  const more = groups.length > 3 ? buttonEl({ class: 'cal__more', 'aria-expanded': 'false', on: { click: function (event) {
    const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
    event.currentTarget.setAttribute('aria-expanded', String(open));
    event.currentTarget.textContent = open ? '收起' : '+ ' + (groups.length - 3) + ' 部剧集';
    fill(list, (open ? groups : groups.slice(0, 3)).map(function (group) { return calendarItemEl(group); }));
  } } }, null, '+ ' + (groups.length - 3) + ' 部剧集') : null;
  return el('div', { class: classNames('cal__cell', cell.date === todayKey && 'is-today', !groups.length && 'cal__cell--empty'), 'data-date': cell.date }, [
    el('button', { type: 'button', class: 'cal__date', 'aria-label': cell.date + '，' + cell.items.length + ' 集更新', on: { click: function () { openCalendarDay(cell); } } }, [
      el('span', { class: 'cal__day', text: cell.day }),
      cell.date === todayKey ? el('span', { class: 'cal__today', text: '今天' }) : null,
      groups.length ? el('span', { class: 'cal__count', text: cell.items.length + ' 集' }) : null,
    ]), list, more,
  ]);
}
function calendarAgendaEl(days, todayKey) {
  return el('div', { class: 'cal-agenda' }, days.map(function (day) {
    const today = day.date === todayKey;
    const future = day.date > todayKey;
    return el('section', { class: classNames('cal-agenda__day', today && 'is-today'), 'data-date': day.date }, [
      el('header', { class: 'cal-agenda__head' }, [
        el('div', { class: 'cal-agenda__stamp' }, [el('strong', { text: Number(day.date.slice(-2)) }), el('span', { text: '周' + CAL_WEEKDAYS[weekdayOf(day.date)] })]),
        el('div', {}, [el('h2', { text: today ? '今天的更新' : ((day.date.slice(0,4)!==todayKey.slice(0,4)?day.date.slice(0,4)+'年':'')+day.date.slice(5).replace('-', '月') + '日') }), el('span', { text: day.items.length + ' 集 · ' + (today ? '今日播出' : future ? '即将播出' : '已到播出日期') })]),
        buttonEl({ class: 'btn btn--sm', 'aria-label': '查看 ' + day.date + ' 更新详情', on: { click: function () { openCalendarDay(day); } } }, null, '详情'),
      ]),
      el('div', { class: 'cal-agenda__events' }, groupCalendarItems(day.items).map(function (group) { return calendarItemEl(group, true); })),
    ]);
  }));
}
function paintCalendar() {
  const body = $('#calendar-body');
  if (!body || !calendarData) return;
  const days = calendarData.days || [];
  const stats = calendarStats(days);
  const allMissing=calendarFilter.status === 'missing' && Array.isArray(calendarData.missingDays);
  const sourceDays=allMissing ? calendarData.missingDays : days;
  const filtered = filterCalendarDays(sourceDays, calendarFilter);
  const filteredStats = calendarStats(filtered);
  const today = calendarData.today || localDateKey();
  const summary = $('#calendar-summary');
  if (summary) fill(summary, [
    ['本月更新', stats.total, stats.series + ' 部订阅剧集', 'all'],
    ['已完成', stats.downloaded, '下载完成的剧集', 'downloaded'],
    ['待补集', (calendarData.missingComplete === false ? '≥ ' : '')+(calendarData.missingTotal ?? calendarData.missing ?? stats.missing), calendarData.missingComplete === false ? '全部订阅 · 部分信息待恢复' : '全部订阅 · 跨月累计', 'missing'],
    ['即将播出', stats.upcoming, '等待新的故事', 'upcoming'],
  ].map(function (metric) {
    return el('button', { type: 'button', class: 'cal-metric' + (calendarFilter.status === metric[3] ? ' is-active' : ''), 'aria-pressed': String(calendarFilter.status === metric[3]), on: { click: function () {
      calendarFilter.status = metric[3]; const select = $('#calendar-status'); if (select) select.value = metric[3]; paintCalendar();
    } } }, [el('span', { text: metric[0] }), el('strong', { text: metric[1] }), el('small', { text: metric[2] })]);
  }));
  const count = $('#calendar-count');
  if (count) count.textContent = (allMissing?'全部待补 · ':'本月 · ')+filteredStats.series + ' 部剧集 · ' + filteredStats.total + ' 集' + (stats.downloading ? ' · ' + stats.downloading + ' 集下载中' : '');
  fill(body, [
    calendarData.warnings?.length ? el('div', { class: 'cal-warning', role: 'status', text: '部分剧集播出信息获取失败，当前日历可能不完整。可稍后刷新重试。' }) : null,
    el('div', { class: 'cal-month-view' + (calendarLayout === 'agenda' || allMissing ? ' is-hidden' : '') }, [
      el('div', { class: 'cal__weekdays' }, CAL_WEEKDAYS.map(function (name) { return el('span', { text: '周' + name }); })),
      el('div', { class: 'cal__grid' }, calendarCells(calendarMonth, filtered).map(function (cell) { return calendarCellEl(cell, today); })),
    ]),
    el('div', { class: 'cal-agenda-view' + (calendarLayout === 'agenda' || allMissing ? ' is-selected' : '') }, filtered.length ? calendarAgendaEl(filtered, today) : null),
    !filtered.length ? el('div', { class: 'cal-empty' }, [iconNode('calendar'), el('h3', { text: days.length ? '没有符合筛选的更新' : '这个月，暂时没有更新安排' }),
      el('p', { text: days.length ? '试试其他剧集或下载状态。' : '订阅剧集后，已公布的播出日期会出现在这里。' }),
      days.length ? buttonEl({ class: 'btn', on: { click: function () { calendarFilter = { status: 'all', series: 'all' }; renderCalendarFilters(); paintCalendar(); } } }, null, '清除筛选') : el('a', { class: 'btn', href: '#/subscribe' }, '查看订阅'),
    ]) : null,
  ]);
}
function renderCalendarFilters() {
  const host = $('#calendar-filters'); if (!host || !calendarData) return;
  const series = new Map();
  [...(calendarData.days || []),...(calendarData.missingDays || [])].forEach(function (day) { (day.items || []).forEach(function (item) { series.set(String(item.subscriptionId || item.tmdbId), item.title); }); });
  if (!series.has(calendarFilter.series)) calendarFilter.series = 'all';
  const seriesSelect = el('select', { id: 'calendar-series', 'aria-label': '筛选订阅剧集', on: { change: function (event) { calendarFilter.series = event.target.value; paintCalendar(); } } }, [
    el('option', { value: 'all', text: '全部剧集' }), [...series.entries()].map(function (entry) { return el('option', { value: entry[0], text: entry[1] }); }),
  ]);
  seriesSelect.value = calendarFilter.series;
  const stateSelect = el('select', { id: 'calendar-status', 'aria-label': '筛选更新状态', on: { change: function (event) { calendarFilter.status = event.target.value; paintCalendar(); } } }, [
    el('option', { value: 'all', text: '全部状态' }), Object.keys(CAL_STATUS).filter(function (key) { return key !== 'partial'; }).map(function (key) { return el('option', { value: key, text: CAL_STATUS[key].label }); }),
  ]);
  stateSelect.value = calendarFilter.status;
  fill(host, [el('div', { class: 'cal-filters__selects' }, [seriesSelect, stateSelect]), el('span', { id: 'calendar-count', class: 'field__hint', 'aria-live': 'polite' }),
    el('span', { class: 'cal__legend' }, Object.values(CAL_STATUS).filter(function (state) { return state.kind !== 'partial'; }).map(function (state) { return el('span', {}, [el('i', { class: 'cal__dot is-' + state.kind }), state.label]); })),
  ]);
}
async function loadCalendar(force) {
  const body = $('#calendar-body'), nav = $('#calendar-nav'); if (!body || !nav) return;
  calendarMonth = validMonthKey(calendarMonth) ? calendarMonth : thisMonth();
  const requestedMonth = calendarMonth, requestId = ++calendarLoadId, viewId = renderToken;
  const [year, month] = calendarMonth.split('-').map(Number);
  const picker = el('input', { type: 'month', value: calendarMonth, min: '1900-01', max: '2100-12', 'aria-label': '选择月份', on: { change: function (event) {
    if (validMonthKey(event.target.value)) { calendarMonth = event.target.value; loadCalendar(); }
  } } });
  const shift = function (delta) { calendarMonth = new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7); loadCalendar(); };
  fill(nav, [
    el('div', { class: 'cal-nav__date' }, [buttonEl({ class: 'icon-btn', 'aria-label': '上个月', on: { click: function () { shift(-1); } } }, 'chevron-left'), el('label', { class: 'cal-month-picker' }, [el('span', { text: year + '年 ' + month + '月' }), iconNode('calendar'), picker]),
      buttonEl({ class: 'icon-btn', 'aria-label': '下个月', on: { click: function () { shift(1); } } }, 'chevron-right'),
      buttonEl({ class: 'btn btn--sm', on: { click: function () { calendarMonth = thisMonth(); loadCalendar(); } } }, null, '本月'),
    ]),
    el('div', { class: 'cal-nav__tools' }, [
      el('div', { class: 'cal-layout', role: 'group', 'aria-label': '日历视图' }, [['month', '月历'], ['agenda', '时间线']].map(function (entry) { return buttonEl({ class: 'btn btn--sm' + (calendarLayout === entry[0] ? ' is-active' : ''), 'aria-pressed': String(calendarLayout === entry[0]), 'data-layout': entry[0], on: { click: function (event) {
        calendarLayout = entry[0]; nav.querySelectorAll('[data-layout]').forEach(function (button) { button.classList.toggle('is-active', button === event.currentTarget); button.setAttribute('aria-pressed', String(button === event.currentTarget)); }); paintCalendar();
      } } }, null, entry[1]); })),
      buttonEl({ class: 'btn btn--sm', 'aria-label': '刷新日历', on: { click: function () { loadCalendar(true); } } }, 'refresh', '刷新'),
    ]),
  ]);
  fill(body, el('div', { class: 'sk', style: 'height:420px', role: 'status', 'aria-label': '正在加载日历' }));
  calendarData = null;
  fill($('#calendar-summary'), []); fill($('#calendar-filters'), []);
  try {
    const path = '/calendar?month=' + encodeURIComponent(requestedMonth);
    if (force) viewCache.delete(path);
    const data = await cachedApi(path, 60 * 1000);
    if (requestId !== calendarLoadId || viewId !== renderToken || !body.isConnected) return;
    calendarData = data; renderCalendarFilters(); paintCalendar();
  } catch (error) {
    if (requestId === calendarLoadId && viewId === renderToken && body.isConnected) fill(body, [errorEl(error.message), buttonEl({ class: 'btn', on: { click: function () { loadCalendar(true); } } }, null, '重新加载')]);
  }
}
async function viewCalendar(ctx) {
  calendarMonth = calendarMonth || thisMonth();
  fill(ctx.host, pageEl([
    el('header', { class: 'page__head cal-page-head' }, [el('div', {}, [el('h1', { text: '追剧日历' }), el('p', { class: 'page__sub', text: '订阅播出安排与下载进度 · 上海时间（UTC+8）' })]),
      el('a', { class: 'btn', href: '#/subscribe', 'aria-label': '管理订阅' }, [iconNode('bookmark'), el('span', { text: '管理订阅' })]),
    ]),
    el('div', { class: 'cal-summary', id: 'calendar-summary' }),
    el('section', { class: 'cal-workspace' }, [el('div', { class: 'cal__bar', id: 'calendar-nav' }), el('div', { id: 'calendar-filters', class: 'cal-filters' }), el('div', { id: 'calendar-body', 'aria-live': 'polite' })]),
    el('p', { class: 'cal-footnote', text: '播出日期来自 TMDB，可能随发行地区调整；完成状态以 WansPilot 的下载记录为准。' }),
  ]));
  await loadCalendar();
}

/** 三个点的「更多」图标：内置图标集里没有省略号，这里现画一个。 */
function moreIconNode() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  [5, 12, 19].forEach(function (cx) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', '12');
    dot.setAttribute('r', '1.8');
    svg.append(dot);
  });
  return svg;
}

function subscriptionTools() {
  return el('section',{class:'management-tools','aria-label':'订阅筛选与批量操作'},[
    el('div',{class:'management-filters'},[
      el('input',{type:'search',id:'subscription-query',placeholder:'搜索订阅片名…','aria-label':'搜索订阅',value:subFilters.q,on:{input:e=>{subFilters.q=e.target.value;loadSubscriptions(false);}}}),
      selectControl('订阅状态',[['all','全部状态'],['enabled','已启用'],['paused','已暂停'],['checking','正在检查'],['pending','已提交下载'],['error','异常']],subFilters.status,value=>{subFilters.status=value;loadSubscriptions(false);}),
      selectControl('订阅排序',[['next','按下次检查'],['created','按添加时间'],['title','按片名']],subFilters.sort,value=>{subFilters.sort=value;loadSubscriptions(false);}),
    ]),
    el('div',{class:'management-batch'},[
      buttonEl({class:'btn btn--sm',on:{click:()=>{$$('#sub-list .sub-card').forEach(card=>selectedSubscriptions.add(card.dataset.id));paintSubscriptionSelection();}}},null,'全选当前结果'),
      buttonEl({class:'btn btn--sm btn--ghost',on:{click:()=>{selectedSubscriptions.clear();paintSubscriptionSelection();}}},null,'清空'),
      el('span',{class:'field__hint',id:'subscription-selection',role:'status',text:'已选 0 项'}),
      ...[['check','检查'],['pause','暂停'],['enable','启用'],['auto-on','开启并检查'],['auto-off','关闭自动下载']].map(([action,label])=>buttonEl({class:'btn btn--sm','data-sub-batch':action,disabled:true,on:{click:e=>runSubscriptionBatch(action,e.currentTarget)}},null,label)),
    ]),
    el('p',{class:'field__hint',text:'批量操作只作用于当前筛选内选中的订阅，每次最多 50 项。'}),
  ]);
}
function paintSubscriptionSelection() {
  const note=$('#subscription-selection');if(note)note.textContent='已选 '+selectedSubscriptions.size+' 项';
  $('#subscription-selection')?.closest('.management-tools').classList.toggle('is-selecting',selectedSubscriptions.size>0);
  $$('[data-sub-batch]').forEach(button=>button.disabled=subscriptionBatchBusy || selectedSubscriptions.size===0 || selectedSubscriptions.size>50);
  $$('#sub-list .sub-card').forEach(card=>{const checkbox=card.querySelector('.sub-card__select input');if(checkbox)checkbox.checked=selectedSubscriptions.has(card.dataset.id);});
}
async function runSubscriptionBatch(action,button) {
  if(subscriptionBatchBusy || !selectedSubscriptions.size)return;
  if(action==='auto-on' && !await confirmDialog({title:'开启自动下载',message:'选中的已启用订阅将立即安排检查，匹配到资源后自动提交到 qBittorrent；暂停中的订阅保持暂停。确认开启？',confirmText:'开启'}))return;
  subscriptionBatchBusy=true;paintSubscriptionSelection();
  try {const result=await api('/subscriptions/batch',{method:'POST',body:{action,ids:[...selectedSubscriptions]}});await loadSubscriptions(true);batchResults('批量订阅操作结果',result.results || []);}
  catch(error){toast(error.message,'error');}
  finally{subscriptionBatchBusy=false;paintSubscriptionSelection();}
}
async function openEpisodeManager(id) {
  const item=subscriptionItems.find(item=>item.id===id);if(!item)return;
  closeSubMenu();
  const host=el('div',{class:'episode-manager'},loadingEl('正在读取分集信息…'));
  openModal({title:item.title+' · 逐集管理',size:'lg',body:host});
  let data,season=item.seasons?.[0] || '',status='all',page=1,version=0;const selected=new Set();
  async function load(){const own=++version;fill(host,loadingEl('正在读取分集信息…'));try{const response=await api('/subscriptions/'+encodeURIComponent(id)+'/episodes'+(season?'?season='+season:''));if(!host.isConnected||own!==version)return;data=response;season=data.season;selected.clear();page=1;paint();}catch(error){if(host.isConnected)fill(host,errorEl(error.message));}}
  async function mark(downloaded,button){button.disabled=true;const note=host.querySelector('.episode-feedback');note.textContent='正在保存记录…';try{await api('/subscriptions/'+encodeURIComponent(id)+'/episodes',{method:'PATCH',body:{keys:[...selected],downloaded}});dropStash('calendar');await loadSubscriptions(true);await load();}catch(error){if(note.isConnected)note.textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}}
  function paint(){
    const scroll=host.parentElement?.scrollTop || 0;
    const focused=host.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
    const episodes=data.episodes.filter(ep=>status==='all'||ep.status===status),pages=Math.max(1,Math.ceil(episodes.length/50));page=Math.min(page,pages);
    const visible=episodes.slice((page-1)*50,page*50);
    const states={downloaded:'已下载',downloading:'已提交',missing:'待补',upcoming:'未播出',unknown:'日期未知'};
    fill(host,[
      el('p',{class:'notice',text:'手动标记仅调整订阅记录，不扫描或修改文件。标记已下载会跳过自动下载；恢复待补后，后续检查可能重新下载。进行中的任务请到下载页操作。'}),
      el('div',{class:'management-filters'},[
        selectControl('选择季',data.seasons.map(s=>[String(s.seasonNumber),s.name || '第 '+s.seasonNumber+' 季']),String(season),value=>{season=value;load();}),
        selectControl('集数状态',[['all','全部集数'],...Object.entries(states)],status,value=>{status=value;page=1;selected.clear();paint();}),
      ]),
      el('div',{class:'management-batch'},[
        buttonEl({class:'btn btn--sm',on:{click:()=>{visible.filter(ep=>ep.status!=='downloading').forEach(ep=>selected.add(ep.key));paint();}}},null,'全选本页'),
        buttonEl({class:'btn btn--sm btn--ghost',on:{click:()=>{selected.clear();paint();}}},null,'清空'),
        el('span',{class:'field__hint',text:'已选 '+selected.size+' 集'}),
        buttonEl({class:'btn btn--sm',disabled:!selected.size,on:{click:e=>mark(true,e.currentTarget)}},'check','标记已下载'),
        buttonEl({class:'btn btn--sm',disabled:!selected.size,on:{click:e=>mark(false,e.currentTarget)}},'refresh','恢复待补'),
      ]),
      el('p',{class:'episode-feedback field__hint',role:'status',text:'第 '+page+' / '+pages+' 页，共 '+episodes.length+' 集 · 上海时间'}),
      el('div',{class:'episode-list'},visible.map(ep=>el('label',{class:'episode-row'},[
        el('input',{type:'checkbox',checked:selected.has(ep.key),disabled:ep.status==='downloading','aria-label':'选择 '+ep.key,on:{change:e=>{if(e.target.checked)selected.add(ep.key);else selected.delete(ep.key);paint();}}}),
        el('div',{},[el('strong',{text:ep.key+(ep.name?' · '+ep.name:'')}),el('small',{text:(ep.airDate || '播出日期未知')+(!ep.inScope?' · 不在订阅规则范围':'')})]),
        chipEl(states[ep.status],ep.status==='downloaded'?'ok':'info'),
        ep.task?el('span',{class:'field__hint',text:Math.round(ep.task.progress*100)+'%'}):null,
      ]))),
      !episodes.length?emptyEl('没有符合条件的集数'):null,
      el('div',{class:'management-batch'},[buttonEl({class:'btn btn--sm',disabled:page<=1,on:{click:()=>{page--;selected.clear();paint();}}},'back','上一页'),buttonEl({class:'btn btn--sm',disabled:page>=pages,on:{click:()=>{page++;selected.clear();paint();}}},null,'下一页')]),
    ]);
    if(host.parentElement)host.parentElement.scrollTop=scroll;
    if(focused)[...host.querySelectorAll('[aria-label]')].find(node=>node.getAttribute('aria-label')===focused)?.focus({preventScroll:true});
  }
  await load();
}

function subscriptionStatus(item) {
  if(item.enabled===false)return {label:'已暂停',kind:'warn'};
  if(item.isChecking)return {label:item.activity?.stage==='submitting'?'正在提交':item.activity?.stage==='searching'?'正在搜索':'正在检查',kind:'info'};
  if(item.downloads?.downloading)return {label:'下载中 · '+item.downloads.downloading+' 个任务',kind:'info'};
  if(item.downloads?.paused)return {label:'下载已暂停',kind:'warn'};
  if(item.pendingKeys?.length)return {label:'已提交 · '+item.pendingKeys.length+' 集',kind:'info'};
  return SUB_STATES[item.state] || {label:item.state || '等待检查',kind:'info'};
}
function subscriptionActivityBody(item) {
  return frag([
    el('div',{class:'subscription-current',role:'status'},[chipEl(subscriptionStatus(item).label,subscriptionStatus(item).kind),el('p',{text:item.lastMessage || '等待首次检查'}),el('p',{class:'field__hint',text:'上次检查：'+(item.lastCheckAt?fmtDateTime(item.lastCheckAt):'尚未完成首次检查')+' · 下次检查：'+(item.enabled===false?'已暂停':item.isChecking?'当前检查结束后安排':item.nextCheckAt?fmtDateTime(item.nextCheckAt):'等待安排')})]),
    item.downloads?.tasks?.length ? el('section',{class:'subscription-downloads'},[el('h3',{text:'关联下载任务'}),item.downloads.tasks.map(task=>el('div',{class:'subscription-download'},[el('span',{text:task.name || task.id}),chipEl((TASK_STATES[task.state] || {label:task.state}).label,'info'),el('span',{text:Math.round(task.progress*100)+'%'})])),linkEl({class:'btn btn--sm',href:'#/tasks',on:{click:closeModal}},'download','查看下载任务')]) : null,
    el('h3',{text:'操作与搜索记录'}),
    el('ol',{class:'subscription-history'},(item.history || []).length ? item.history.slice().reverse().map(event=>el('li',{},[el('time',{datetime:event.at,text:fmtDateTime(event.at)}),el('p',{text:event.message})])) : el('li',{text:'旧版本未保存过程记录，下一次检查开始后会在这里显示。'})),
  ]);
}
function openSubscriptionActivity(id) {
  closeSubMenu();
  const item=subscriptionItems.find(item=>item.id===id);if(!item)return;
  openModal({title:item.title+' · 订阅进度',body:el('div',{class:'subscription-activity-detail','data-subscription-activity':id},subscriptionActivityBody(item))});
}

/** 订阅卡片展示已有下载记录；播出日期仅使用日历接口的真实数据。 */
function subCardEl(item) {
  const state = subscriptionStatus(item);
  const type = item.type === 'movie' ? 'movie' : 'tv';
  const completed = new Set(item.downloadedKeys || []).size;
  const aired = Number(item.totalEpisodes) || 0;
  const progressText = type === 'movie' ? (completed ? '已下载' : '等待匹配资源') : (aired ? '已下载 ' + completed + ' / 已播 ' + aired + ' 集' : (completed ? '已下载 ' + completed + ' 集' : '等待首次更新'));
  const more = buttonEl({
    class: 'sub-card__more',
    'data-action': 'sub-menu',
    'data-id': item.id,
    'aria-label': '打开操作菜单',
  });
  more.append(moreIconNode());
  return el('article', {
    class: 'card sub-card',
    'data-id': item.id,
    tabindex: '0',
    'aria-label': (item.title || '订阅') + '，右击查看操作',
  }, [
    el('a', { class: 'card__poster', href: '#/detail/' + type + '/' + item.tmdbId },
      posterEl(item.posterPath, (item.title || '订阅') + ' 海报', 'w342')),
    el('div', { class: 'sub-card__meta' }, [
      el('span', { class: 'card__title', text: item.title || '未命名' }),
      el('div', { class:'sub-card__status' }, [chipEl(item.enabled === false ? '已暂停' : state.label, item.enabled === false ? 'warn' : state.kind), el('span', { class:'sub-card__quality', text:item.qualityPreference || '1080p' })]),
      el('p', { class:'sub-card__progress', text:progressText }),
      type !== 'movie' ? el('p', { class:'sub-card__schedule', 'data-schedule':item.id, text:'播出时间待更新' }) : null,
      el('p',{class:'sub-card__activity',title:item.lastMessage || '',text:item.lastMessage || '等待首次检查'}),
      el('div',{class:'sub-card__activity-actions'},[
        buttonEl({class:'btn btn--sm btn--ghost','data-action':'sub-activity','data-id':item.id},'activity','记录'),
        type==='tv'?buttonEl({class:'btn btn--sm btn--ghost','data-action':'sub-episodes','data-id':item.id},null,'逐集'):null,
        buttonEl({class:'btn btn--sm btn--ghost','data-action':'sub-check','data-id':item.id,disabled:item.isChecking || item.enabled===false},'search',item.isChecking?'进行中':'检查'),
      ]),
    ]),
    el('label',{class:'sub-card__select',title:'选择订阅，用于批量操作'},el('input',{type:'checkbox','aria-label':'选择 '+(item.title || '订阅'),checked:selectedSubscriptions.has(item.id),on:{change:e=>{if(e.target.checked)selectedSubscriptions.add(item.id);else selectedSubscriptions.delete(item.id);paintSubscriptionSelection();}}})),
    more,
  ]);
}

/** 右击（或在触屏上点三个点）弹出的订阅操作菜单：按钮都在这里，平时不占地方。 */
function openSubMenu(item, event) {
  closeSubMenu();
  const state = subscriptionStatus(item);
  const type = item.type === 'movie' ? 'movie' : 'tv';
  const seasons = Array.isArray(item.seasons) && item.seasons.length
    ? '第 ' + item.seasons.join('、') + ' 季'
    : (type === 'movie' ? '' : '全部季');
  const keys = Array.isArray(item.downloadedKeys) ? item.downloadedKeys : [];
  const facts = [
    typeLabel(type),
    seasons,
    item.qualityPreference || '1080p',
    '做种 ≥ ' + (item.minSeeders === undefined ? 5 : item.minSeeders),
    '≤ ' + (item.maxSizeGB === undefined ? 30 : item.maxSizeGB) + ' GB',
    item.autoDownload ? '自动下载' : '仅通知',
  ].filter(Boolean).join(' · ');

  const menu = el('div', { class: 'sub-menu', role: 'menu', id: 'sub-menu' }, [
    el('div', { class: 'sub-menu__head' }, [
      el('span', { class: 'sub-menu__title', text: item.title || '未命名' }),
      chipEl(state.label, state.kind),
    ]),
    el('p', { class: 'sub-menu__facts', text: facts }),
    el('p', {
      class: 'sub-menu__facts',
      text: '上次检查 ' + (item.lastCheckAt ? fmtDateTime(item.lastCheckAt) : '尚未检查')
        + ' · 已下载 ' + keys.length + ' 项',
    }),
    item.lastMessage ? el('p', { class: 'sub-menu__msg', text: item.lastMessage }) : null,
    el('div', { class: 'sub-menu__items' }, [
      buttonEl({class:'sub-menu__item','data-action':'sub-activity','data-id':item.id},'activity','查看搜索与下载记录'),
      buttonEl({ class: 'sub-menu__item', 'data-action': 'sub-check', 'data-id': item.id }, 'refresh', '立即检查'),
      buttonEl({ class: 'sub-menu__item', 'data-action': 'sub-edit', 'data-id': item.id }, null, '编辑'),
      buttonEl({
        class: 'sub-menu__item',
        'data-action': 'sub-toggle',
        'data-id': item.id,
        'data-next': item.enabled ? '0' : '1',
      }, item.enabled ? 'pause' : 'play', item.enabled ? '暂停' : '启用'),
      buttonEl({
        class: 'sub-menu__item sub-menu__item--danger',
        'data-action': 'sub-delete',
        'data-id': item.id,
      }, 'trash', '删除'),
    ]),
  ]);

  const host = $('#sub-list') || document.body;
  host.append(menu);
  // 贴着鼠标（键盘打开时贴着卡片），并夹在视口内
  const box = menu.getBoundingClientRect();
  let left = event && event.clientX ? event.clientX : 0;
  let top = event && event.clientY ? event.clientY : 0;
  if (!left && !top && event && event.currentTarget && event.currentTarget.getBoundingClientRect) {
    const anchor = event.currentTarget.getBoundingClientRect();
    left = anchor.left;
    top = anchor.bottom;
  }
  menu.style.left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(top, window.innerHeight - box.height - 8)) + 'px';

  setTimeout(function () {
    document.addEventListener('click', closeSubMenu, true);
    document.addEventListener('keydown', onSubMenuKey, true);
    window.addEventListener('scroll', closeSubMenu, true);
  }, 0);
}

function onSubMenuKey(event) {
  if (event.key === 'Escape') { event.stopPropagation(); closeSubMenu(); }
}

function closeSubMenu() {
  const menu = $('#sub-menu');
  if (!menu) return;
  menu.remove();
  document.removeEventListener('click', closeSubMenu, true);
  document.removeEventListener('keydown', onSubMenuKey, true);
  window.removeEventListener('scroll', closeSubMenu, true);
}

/** 订阅页顶部两档：电影 / 剧集，各自带条数。 */
function renderSubscribeTabs(active, movieCount, tvCount) {
  const host = $('#sub-tabs');
  if (!host) return;
  const entry = function (type, label, count) {
    return el('a', {
      class: classNames('chip', type === active && 'chip--active'),
      href: '#/subscribe?type=' + type,
      'aria-current': type === active ? 'true' : null,
    }, [label, el('small', { text: count })]);
  };
  fill(host, [el('div', { class:'sub-tabs__choices' }, [entry('movie','电影',movieCount),entry('tv','剧集',tvCount)]), el('span', { class:'sub-tabs__summary', text:'共 '+(movieCount+tvCount)+' 部 · '+subscriptionItems.filter(item=>item.enabled !== false).length+' 部跟踪中' })]);
}

async function loadSubscriptions(force) {
  const list = $('#sub-list');
  if (!list) return;
  try {
    // 与海报卡共用同一份订阅状态，订阅页拿的是最新一份
    subscriptionItems = await loadSubscriptionsCached(force);
  } catch (error) {
    fill(list, errorEl(error.message));
    return;
  }

  // 降档下载后出现更好版本时，在列表上方给一条可操作的提示
  const upgrades = subscriptionItems.filter(function (item) { return item.upgrade && item.upgrade.available; });
  const host = list.parentElement;
  const oldBox = host ? host.querySelector('.upgrade-box') : null;
  if (oldBox) oldBox.remove();
  if (upgrades.length && host) {
    const box = el('div', { class: 'notice notice--accent upgrade-box' }, upgrades.map(function (item) {
      return frag([
        el('p', { class: 'notice__title' }, [
          iconNode('trending'),
          el('span', { text: item.title + '：发现更好的版本' }),
        ]),
        el('p', {
          class: 'notice__text',
          text: ((item.upgrade && item.upgrade.title) || '')
            + '（' + ((item.upgrade && item.upgrade.resolution) || '') + '）',
        }),
        el('div', { class: 'row row--wrap' }, [
          buttonEl({
            class: 'btn btn--sm btn--primary', 'data-action': 'sub-upgrade', 'data-id': item.id,
          }, null, '替换'),
          buttonEl({
            class: 'btn btn--sm', 'data-action': 'sub-upgrade-skip', 'data-id': item.id,
          }, null, '忽略'),
        ]),
      ]);
    }));
    host.insertBefore(box, list);
  }

  const movies = subscriptionItems.filter(function (item) { return item.type === 'movie'; });
  const shows = subscriptionItems.filter(function (item) { return item.type !== 'movie'; });
  // 没指定看哪一档时，默认落在有内容的那一档
  const active = subscribeTab === 'movie' || subscribeTab === 'tv'
    ? subscribeTab
    : (movies.length ? 'movie' : 'tv');
  renderSubscribeTabs(active, movies.length, shows.length);

  if (!subscriptionItems.length) {
    fill(list, emptyEl('还没有订阅。打开任意影视详情页，点「订阅」即可创建。'));
    return;
  }
  const wanted = filterSubscriptions(active === 'movie' ? movies : shows,subFilters);
  const visibleIds=new Set(wanted.map(item=>item.id));for(const id of selectedSubscriptions)if(!visibleIds.has(id))selectedSubscriptions.delete(id);
  paintSubscriptionSelection();
  if (!wanted.length) {
    fill(list, emptyEl(subFilters.q || subFilters.status!=='all' ? '没有符合筛选的订阅。' : active === 'movie' ? '还没有订阅电影。' : '还没有订阅剧集。'));
    return;
  }
  fill(list, wanted.map(subCardEl));
  paintSubscriptionSelection();
  if (active === 'tv') updateSubscriptionAirDates(list);
}

let subscriptionPollBusy=false;
async function refreshSubscriptionActivity() {
  if(subscriptionPollBusy || !accessReady || document.hidden || parseRoute().name!=='subscribe' || !$('#sub-list'))return;
  subscriptionPollBusy=true;
  const list=$('#sub-list');
  try {
    const previous=subscriptionItems;
    const items=await loadSubscriptionsCached(true);
    if(!list.isConnected || parseRoute().name!=='subscribe')return;
    subscriptionItems=items;
    const oldById=new Map(previous.map(item=>[item.id,item]));
    const active=subscribeTab || (items.some(item=>item.type==='movie')?'movie':'tv');
    const wanted=filterSubscriptions(items.filter(item=>active==='movie'?item.type==='movie':item.type!=='movie'),subFilters);
    const shown=[...list.querySelectorAll('.sub-card')].map(card=>card.dataset.id);
    if(JSON.stringify(shown)!==JSON.stringify(wanted.map(item=>item.id))) {await loadSubscriptions(true);}
    list.querySelectorAll('.sub-card').forEach(card=>{
      const item=items.find(item=>item.id===card.dataset.id);if(!item)return;
      if(JSON.stringify(item)===JSON.stringify(oldById.get(item.id)))return;
      const replacement=subCardEl(item),meta=card.querySelector('.sub-card__meta'),nextMeta=replacement.querySelector('.sub-card__meta');
      const focused=meta.contains(document.activeElement)?document.activeElement.dataset.action:null;
      meta.replaceWith(nextMeta);
      if(focused)nextMeta.querySelector('[data-action="'+focused+'"]')?.focus({preventScroll:true});
    });
    if(items.some(item=>item.type!=='movie'))await updateSubscriptionAirDates(list);
    const detail=document.querySelector('[data-subscription-activity]');
    if(detail){const item=items.find(item=>item.id===detail.dataset.subscriptionActivity);if(item){const scroll=detail.parentElement.scrollTop;fill(detail,subscriptionActivityBody(item));detail.parentElement.scrollTop=scroll;}}
    const sync=$('#subscription-sync');if(sync)sync.textContent='已同步 '+shanghaiTime()+' · 上海时间 · 每 3 秒刷新';
  }catch(error){const sync=$('#subscription-sync');if(sync)sync.textContent='状态同步失败：'+error.message+'，将自动重试';}
  finally{subscriptionPollBusy=false;}
}
setInterval(refreshSubscriptionActivity,3000);

async function updateSubscriptionAirDates(list) {
  const month=thisMonth();
  try {
    const data=await cachedApi('/calendar?month='+month, 5*60*1000);
    if (!list.isConnected) return;
    const today=data.today || localDateKey(new Date());
    const dates=new Map();
    (data.days || []).filter(day=>day.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).forEach(function(day){
      (day.items || []).forEach(function(item){
        if (item.status !== 'upcoming' || dates.has(item.subscriptionId)) return;
        dates.set(item.subscriptionId, (day.date===today?'今日':day.date.slice(5).replace('-','月')+'日')+' · S'+pad2(item.season)+' E'+pad2(item.episode));
      });
    });
    list.querySelectorAll('[data-schedule]').forEach(function(node){
      const text=dates.get(node.dataset.schedule);
      if (text) {node.textContent=text;}
      else {node.textContent=data.warnings?.length?'播出信息暂不可用':'本月暂无后续播出计划';}
    });
  } catch { /* Keep explicit unknown state; a calendar failure must not break subscriptions. */ }
}

function qualitySelectEl(name, value) {
  return el('select', { name: name }, QUALITY_OPTIONS.map(function (option) {
    return el('option', { value: option, selected: option === value ? true : null, text: option });
  }));
}

/** 表单里一行「标签 + 控件」。 */
function selectControl(label,entries,value,onChange) {
  const control=el('select',{'aria-label':label,on:{change:e=>onChange(e.target.value)}},entries.map(([id,text])=>el('option',{value:id,selected:id===value,text})));
  return control;
}
function batchResults(title,results) {
  openModal({title,body:el('div',{class:'batch-results'},[
    el('p',{role:'status',text:'成功 '+results.filter(r=>r.ok).length+' / '+results.length+' 项'}),
    el('ul',{},results.map(result=>el('li',{},[chipEl(result.ok?'完成':'未完成',result.ok?'ok':'err'),el('span',{text:result.message || result.id})]))),
  ])});
}
function subscriptionRulesFields(item={}) {
  return el('details',{class:'settings-advanced subscription-rules'},[
    el('summary',{text:'独立追更与资源规则'}),
    el('p',{class:'field__hint',text:'关键词按字面匹配，不使用正则；包含词须全部命中，排除词命中任意一个即跳过。集号范围对每个订阅季生效。'}),
    el('div',{class:'form-grid'},[
      fieldEl('必须包含（逗号分隔）',inputEl('text',{name:'includeKeywords',value:(item.includeKeywords || []).join(', '),placeholder:'例如 WEB-DL, CHS',maxlength:'1600'})),
      fieldEl('排除关键词（逗号分隔）',inputEl('text',{name:'excludeKeywords',value:(item.excludeKeywords || []).join(', '),placeholder:'例如 CAM, 抢先版',maxlength:'1600'})),
      fieldEl('视频编码',el('select',{name:'codec'},[['any','不限'],['h264','H.264 / AVC'],['h265','H.265 / HEVC'],['av1','AV1']].map(([value,text])=>el('option',{value,text,selected:value===(item.codec || 'any')})))),
      fieldEl('最小体积（GB）',inputEl('number',{name:'minSizeGB',min:'0',max:'500',step:'0.1',value:item.minSizeGB || 0})),
      fieldEl('独立检查间隔（分钟，0 跟随全局）',inputEl('number',{name:'checkIntervalMinutes',min:'0',max:'1440',step:'1',value:item.checkIntervalMinutes || 0})),
      item.type!=='movie' ? fieldEl('从第几集开始',inputEl('number',{name:'startEpisode',min:'1',max:'9999',value:item.startEpisode || 1})) : null,
      item.type!=='movie' ? fieldEl('到第几集结束（0 不限）',inputEl('number',{name:'endEpisode',min:'0',max:'9999',value:item.endEpisode || 0})) : null,
    ]),
    switchEl(inputEl('checkbox',{name:'strictQuality',checked:item.strictQuality}),'严格画质：没有目标画质时等待，不自动降档'),
  ]);
}
function readSubscriptionRules(form) {
  return {includeKeywords:form.elements.includeKeywords.value,excludeKeywords:form.elements.excludeKeywords.value,codec:form.elements.codec.value,minSizeGB:Number(form.elements.minSizeGB.value),checkIntervalMinutes:Number(form.elements.checkIntervalMinutes.value),startEpisode:Number(form.elements.startEpisode?.value || 1),endEpisode:Number(form.elements.endEpisode?.value || 0),strictQuality:form.elements.strictQuality.checked};
}

function fieldEl(label, control) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    control,
  ]);
}

function switchEl(control, label) {
  control.setAttribute('role','switch');
  return el('label', { class: 'switch' }, [control, el('span',{text:label})]);
}

function openSubscriptionEditor(id) {
  const item = subscriptionItems.find(function (entry) { return entry.id === id; });
  if (!item) return;
  const isTv = item.type !== 'movie';
  const seasons = Array.isArray(item.seasons) ? item.seasons : [];
  const form = el('form', { class: 'form', id: 'sub-edit-form' }, [
    el('div', { class: 'form-grid' }, [
      fieldEl('清晰度偏好', qualitySelectEl('qualityPreference', item.qualityPreference || '1080p')),
      fieldEl('最低做种数', el('input', {
        type: 'number', name: 'minSeeders', min: '0', step: '1',
        value: item.minSeeders === undefined ? 5 : item.minSeeders,
      })),
      fieldEl('最大体积（GB）', el('input', {
        type: 'number', name: 'maxSizeGB', min: '1', step: '1',
        value: item.maxSizeGB === undefined ? 30 : item.maxSizeGB,
      })),
      isTv
        ? fieldEl('订阅季（逗号分隔）', el('input', {
          type: 'text', name: 'seasons', value: seasons.join(','), placeholder: '例如 5,6',
        }))
        : null,
    ]),
    subscriptionRulesFields(item),
    switchEl(el('input', { type: 'checkbox', name: 'autoDownload', checked: item.autoDownload ? true : null }),
      '发现资源后自动下载'),
    switchEl(el('input', { type: 'checkbox', name: 'enabled', checked: item.enabled ? true : null }), '自动检查更新'),
    el('div', { class: 'modal__foot' }, [
      buttonEl({ class: 'btn', 'data-close': true }, null, '取消'),
      buttonEl({ type: 'submit', class: 'btn btn--primary' }, null, '保存'),
    ]),
  ]);
  openModal({
    title: '编辑订阅 · ' + (item.title || ''),
    size: 'md',
    body: form,
    onMount: function (panel) {
      const form = panel.querySelector('#sub-edit-form');
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const body = {
          ...readSubscriptionRules(form),
          qualityPreference: form.elements.qualityPreference.value,
          minSeeders: Number(form.elements.minSeeders.value) || 0,
          maxSizeGB: Number(form.elements.maxSizeGB.value) || 0,
          autoDownload: form.elements.autoDownload.checked,
          enabled: form.elements.enabled.checked
        };
        if (isTv) {
          const raw = String(form.elements.seasons.value || '');
          body.seasons = raw.split(',').map(function (part) {
            return parseInt(part.trim(), 10);
          }).filter(function (value) { return Number.isFinite(value) && value > 0; });
        }
        try {
          await api('/subscriptions/' + encodeURIComponent(id), { method: 'PATCH', body: body });
          dropStash('subscribe');
          toast('订阅已更新', 'ok');
          closeModal();
          loadSubscriptions(true);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  });
}

function openSubscribeDialog(detail, options) {
  const opts = options || {};
  const isTv = detail.type === 'tv';
  const settings = appState.settings || {};
  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const defaultSeason = seasons.length ? seasons[seasons.length - 1].seasonNumber : null;
  const seasonPicker = isTv
    ? el('fieldset', {}, [
      el('legend', { text: '订阅季' }),
      el('div', { class: 'season-picker' }, seasons.length
        ? seasons.map(function (season) {
          return el('label', { class: 'season-option' }, [
            el('input', {
              type: 'checkbox', name: 'seasons', value: season.seasonNumber,
              checked: season.seasonNumber === defaultSeason ? true : null,
            }),
            season.name || ('第 ' + season.seasonNumber + ' 季'),
          ]);
        })
        : el('p', { class: 'field__hint', text: '没有获取到分季信息，将订阅全部季。' })),
    ])
    : null;
  const form = el('form', { class: 'form', id: 'subscribe-form' }, [
    el('p', { class: 'modal__lead', text: '订阅后 WansPilot 会按下面的条件定期检查，发现符合条件的新资源就加入下载。' }),
    el('div', { class: 'form-grid' }, [
      fieldEl('清晰度偏好', qualitySelectEl('qualityPreference', settings.qualityPreference || '1080p')),
      fieldEl('最低做种数', el('input', {
        type: 'number', name: 'minSeeders', min: '0', step: '1',
        value: settings.minSeeders === undefined ? 5 : settings.minSeeders,
      })),
      fieldEl('最大体积（GB）', el('input', {
        type: 'number', name: 'maxSizeGB', min: '1', step: '1',
        value: settings.maxSizeGB === undefined ? 30 : settings.maxSizeGB,
      })),
      el('label', { class: 'switch field' }, [
        el('span', { class: 'field__label', text: '发现资源后' }),
        switchEl(el('input', {
          type: 'checkbox', name: 'autoDownload', checked: settings.autoDownload === false ? null : true,
        }), '自动加入下载'),
      ]),
    ]),
    seasonPicker,
    subscriptionRulesFields({type:isTv?'tv':'movie'}),
    el('div', { class: 'modal__foot' }, [
      buttonEl({ class: 'btn', 'data-close': true }, null, '取消'),
      buttonEl({ type: 'submit', class: 'btn btn--primary' }, null, '确认订阅'),
    ]),
  ]);
  openModal({
    title: '订阅 · ' + (detail.title || ''),
    size: 'md',
    body: form,
    onMount: function (panel) {
      const form = panel.querySelector('#subscribe-form');
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        let picked = [];
        if (isTv) {
          const boxes = form.querySelectorAll('input[name="seasons"]:checked');
          picked = Array.prototype.map.call(boxes, function (box) { return Number(box.value); });
        }
        const body = {
          ...readSubscriptionRules(form),
          type: isTv ? 'tv' : 'movie',
          tmdbId: Number(detail.id),
          // 带上片名信息：后端搜索要用原名，中文名只作回退
          title: detail.title || '',
          originalTitle: detail.originalTitle || '',
          year: detail.year || '',
          seasons: isTv ? picked : null,
          qualityPreference: form.elements.qualityPreference.value,
          minSeeders: Number(form.elements.minSeeders.value) || 0,
          maxSizeGB: Number(form.elements.maxSizeGB.value) || 0,
          autoDownload: form.elements.autoDownload.checked
        };
        try {
          const created = await api('/subscriptions', { method: 'POST', body: body });
          if (created && created.item) rememberSubscription(created.item);
          dropStash('subscribe');
          dropStash('calendar');
          toast('订阅成功', 'ok');
          closeModal();
          if (typeof opts.onDone === 'function') opts.onDone(created && created.item);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  });
}

/* ---------- Automation overview and persistent in-app notifications ---------- */
async function viewOverview(ctx) {
  fill(ctx.host,pageEl(loadingEl('正在读取运行总览…')));
  const data=await api('/overview');
  const readiness=data.readiness || {},subs=data.subscriptions || {},tasks=data.tasks || {},capacity=data.capacity || {};
  fill(ctx.host,pageEl([
    el('header',{class:'page__head'},[el('div',{},[el('h1',{text:'运行总览'}),el('p',{class:'page__sub',text:'订阅调度、下载、空间与最近通知 · 上海时间（UTC+8）'})]),el('div',{class:'page__actions'},[linkEl({class:'btn',href:'#/notifications'},'bell','通知中心'),buttonEl({class:'btn',on:{click:render}},'refresh','刷新')])]),
    el('div',{class:'stats'},[['启用订阅',subs.enabled || 0],['检查中与排队',subs.checking || 0],['异常订阅',subs.errors || 0],['下载速率',fmtRate(tasks.rateDown)],['磁盘可用',capacity.known?fmtBytes(capacity.freeBytes):'未知']].map(([label,value])=>el('div',{class:'stat'},[el('span',{class:'stat__value',text:value}),el('span',{class:'stat__label',text:label})]))),
    el('div',{class:'overview-grid'},[
      el('section',{class:'panel'},[el('h2',{class:'panel__title',text:'自动化准备情况'}),el('div',{class:'overview-readiness'},[
        ['TMDB 密钥',readiness.tmdbKeySet?'已配置':'未配置'],['下载器配置',readiness.qbConfigured?'已配置':'未配置'],['qB 当前连接',data.engine?.ready?'就绪':data.engine?.lastError || '未就绪'],['新订阅默认自动下载',readiness.autoDownload?'开启':'关闭'],['默认检查间隔',(readiness.checkIntervalMinutes || 60)+' 分钟'],['自动整理',data.organizer?.autoOrganize?'开启':'关闭']
      ].map(([label,value])=>kvRowEl(label,value))),linkEl({class:'btn btn--sm',href:'#/settings'},'settings','调整设置')]),
      el('section',{class:'panel'},[el('h2',{class:'panel__title',text:'接下来的订阅检查'}),el('div',{class:'overview-queue'},(data.queue || []).length?data.queue.map(item=>el('div',{},[el('strong',{text:item.title}),chipEl(subscriptionStatus(item).label,subscriptionStatus(item).kind),el('time',{text:item.isChecking?'当前检查正在处理':fmtDateTime(item.nextCheckAt)})])):emptyEl('还没有启用的订阅')),linkEl({class:'btn btn--sm',href:'#/subscribe'},'bookmark','管理订阅')]),
    ]),
    el('section',{class:'panel'},[el('div',{class:'panel__head'},[el('h2',{class:'panel__title',text:'最近通知'}),linkEl({class:'btn btn--sm',href:'#/notifications'},null,'查看全部')]),notificationList(data.notifications || [])]),
    el('p',{class:'field__hint',text:'配置已填写不代表连接成功；qB 就绪来自下载器轮询。上海时间 '+fmtDateTime(data.at)}),
  ]));
}
function notificationList(items){return items.length?el('div',{class:'notification-list'},items.map(item=>el('article',{class:classNames('notification-item',!item.read&&'is-unread')},[
  iconNode(item.kind==='error'?'alert':item.kind==='success'?'check':'info'),
  el('div',{},[el('strong',{text:item.title}),el('p',{text:item.message}),el('time',{datetime:item.at,text:fmtDateTime(item.at)+' · 上海时间'})]),
  !item.read?buttonEl({class:'btn btn--sm btn--ghost','aria-label':'标记已读 '+item.title,on:{click:async e=>{const button=e.currentTarget;button.disabled=true;try{await api('/notifications/read',{method:'POST',body:{ids:[item.id]}});refreshNotificationBadge();if(parseRoute().name==='notifications')render();else button.closest('.notification-item').classList.remove('is-unread');}catch(error){button.disabled=false;toast(error.message,'error');}}}},'check','已读'):null,
]))):emptyEl('暂无通知。订阅提交、下载完成或遇到问题时会记录在这里。');}
let notificationFilter='all',notificationBusy=false;
async function viewNotifications(ctx){
  fill(ctx.host,pageEl(loadingEl('正在读取通知…')));const data=await api('/notifications');
  const wanted=data.items.filter(item=>notificationFilter==='unread'?!item.read:notificationFilter==='error'?item.kind==='error':true);
  fill(ctx.host,pageEl([
    el('header',{class:'page__head'},[el('div',{},[el('h1',{text:'通知中心'}),el('p',{class:'page__sub',text:'订阅提交、下载完成与异常提醒 · 保留最近 300 条 · 上海时间'})]),el('div',{class:'page__actions'},[linkEl({class:'btn',href:'#/overview'},'activity','运行总览'),buttonEl({class:'btn',disabled:!data.unread,on:{click:async e=>{const button=e.currentTarget;button.disabled=true;try{await api('/notifications/read',{method:'POST',body:{}});refreshNotificationBadge();render();}catch(error){button.disabled=false;toast(error.message,'error');}}}},'check','全部已读')])]),
    el('div',{class:'management-filters'},[selectControl('通知筛选',[['all','全部通知'],['unread','未读'],['error','异常提醒']],notificationFilter,value=>{notificationFilter=value;render();}),el('span',{class:'field__hint',role:'status',text:data.unread+' 条未读'})]),
    el('section',{class:'panel'},notificationList(wanted)),
  ]));
  refreshNotificationBadge();
}
async function refreshNotificationBadge(){if(!accessReady||document.hidden||notificationBusy)return;notificationBusy=true;try{const data=await api('/notifications?summary=1');const node=$('#notification-badge');if(node){node.textContent=data.unread>99?'99+':String(data.unread || '');node.hidden=!data.unread;}$('#notifications-link')?.setAttribute('aria-label','通知中心，'+data.unread+' 条未读');}catch{/* Keep the app usable when the notification endpoint is temporarily unavailable. */}finally{notificationBusy=false;}}
setInterval(refreshNotificationBadge,15000);

/* ---------- 视图：设置 ---------- */

let settingsStatus = null;

/* 设置页分区：一屏只显示一组，左栏导航切换，避免一长条表单把页面拉到无限长。
   id 同时是 panel 的 data-section，也是地址栏 ?tab= 的取值。 */
const SETTINGS_SECTIONS = [
  { id: 'tmdb', label: '数据源', icon: 'image' },
  { id: 'qb', label: '下载', icon: 'download' },
  { id: 'filter', label: '筛选与订阅', icon: 'filter' },
  { id: 'files', label: '下载与整理', icon: 'folder' },
  { id: 'diag', label: '自检与系统', icon: 'activity' },
];
let settingsTab = 'tmdb';

function settingsSectionExists(id) {
  return SETTINGS_SECTIONS.some(function (section) { return section.id === id; });
}

/** 左栏分区导航：桌面是竖排，窄屏收成一排可横滑的按钮。 */
function settingsNavEl(active) {
  return el('nav', { class: 'settings-nav', 'aria-label': '设置分区' },
    SETTINGS_SECTIONS.map(function (section) {
      const isActive = section.id === active;
      return el('button', {
        type: 'button',
        class: classNames('settings-nav__item', isActive && 'is-active'),
        'data-action': 'settings-tab',
        'data-target': section.id,
        'aria-current': isActive ? 'page' : null,
      }, [iconNode(section.icon), el('span', { class: 'settings-nav__label', text: section.label })]);
    }));
}

function checkItemEl(name, ok, message, extra) {
  const kind = ok === true ? 'ok' : (ok === false ? 'err' : 'warn');
  return el('li', { class: classNames('check', 'check--' + kind) }, [
    el('span', { class: 'check__icon' }, iconNode(ok === true ? 'check' : 'alert')),
    el('div', { class: 'check__body' }, [
      el('span', { class: 'check__name', text: name }),
      el('span', { class: 'check__msg', text: message || '' }),
    ]),
    extra || null,
  ]);
}

function statusBlockEl(status, pending) {
  if (!status) {
    return el('div', { class: 'panel', id: 'settings-status' }, [
      el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title', text: '自检结果' })),
      pending ? loadingEl('正在自检 TMDB、海报源与索引源…') : errorEl('自检结果不可用'),
    ]);
  }
  const sources = Array.isArray(status.sources) ? status.sources : [];
  return el('div', { class: 'panel', id: 'settings-status' }, [
    el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: '自检结果' }),
      el('div', { class: 'row row--wrap' }, [
        buttonEl({ class: 'btn btn--sm', 'data-action': 'test', 'data-kind': 'tmdb' }, null, '测试 TMDB'),
        buttonEl({ class: 'btn btn--sm', 'data-action': 'test', 'data-kind': 'image' }, null, '测试海报源'),
        buttonEl({ class: 'btn btn--sm', 'data-action': 'test', 'data-kind': 'proxy' }, null, '测试代理'),
      ]),
    ]),
    el('ul', { class: 'checks' }, [
      checkItemEl('TMDB API Key', status.tmdbKeySet === true,
        status.tmdbKeySet === true ? '已填写' : '未填写，影视墙与搜索不可用'),
      checkItemEl('TMDB 接口', status.tmdbOk, status.tmdbMessage),
      checkItemEl('海报图片源', status.tmdbImageOk, status.tmdbImageMessage),
      checkItemEl('下载目录（整理用）', status.downloadDirOk, status.downloadDirMessage),
      checkItemEl('qBittorrent', Boolean(status.qbUrl),
        status.qbUrl ? '已配置 ' + status.qbUrl : '未配置，去设置页填 qB 地址才能下载'),
      checkItemEl('下载引擎', status.engineReady,
        status.engineReady === true ? '就绪' : '未就绪，下载任务无法开始'),
      sources.map(function (source) {
        const ok = source.ok === true;
        const message = ok
          ? '可用 · 延迟 ' + (source.latencyMs || 0) + ' ms'
          : (source.message || source.error || '不可用');
        return checkItemEl('索引源 · ' + (source.name || source.id), ok, message,
          buttonEl({
            class: 'btn btn--sm', 'data-action': 'test', 'data-kind': 'source', 'data-id': source.id,
          }, null, '重测'));
      }),
    ]),
  ]);
}

function hintEl(text) {
  return el('span', { class: 'field__hint', text: text });
}

function checkboxEl(props) { return el('input', Object.assign({ type: 'checkbox' }, props)); }

function inputEl(type, props) { return el('input', Object.assign({ type: type }, props)); }

/** 设置页那一大张表单。字段顺序与保存时读取的顺序一致，方便对照。 */
/** 设置页的一张分组卡片：标题 + 说明 + 内容。 */
function settingsCardEl(title, sub, children) {
  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel__head' }, el('div', { class: 'panel__head-text' }, [
      el('h2', { class: 'panel__title', text: title }),
      sub ? el('p', { class: 'panel__sub', text: sub }) : null,
    ])),
    ...children,
  ]);
}

function settingsFormEl(settings, highlightKey) {
  const form = el('form', { class: 'settings__main', id: 'settings-form' }, [
    settingsCardEl('TMDB', '影视墙、搜索与详情页的数据来源', [
      el('div', { class: 'form-grid' }, [
        el('label', {
          class: classNames('field', 'field--full', highlightKey && 'field--highlight'),
          id: 'tmdb-key-field',
        }, [
          el('span', { class: 'field__label', text: 'TMDB API Key' }),
          el('span', { class: 'secret' }, [
            inputEl('password', {
              id: 'set-tmdb-key', name: 'tmdbApiKey', autocomplete: 'off', spellcheck: 'false',
              value: settings.tmdbApiKey || '', placeholder: settings.tmdbApiKeySet ? '已配置 · 留空保留，输入新值替换' : 'TMDB API Key（v3 auth）',
            }),
            buttonEl({
              class: 'btn btn--sm', 'data-action': 'toggle-key', 'aria-label': '显示或隐藏 API Key',
            }, null, '显示'),
          ]),
          hintEl('密钥不会回传浏览器。留空保留已有密钥。'),
          switchEl(checkboxEl({ name: 'clearTmdbKey' }), '清除已保存的 TMDB Key'),
        ]),
        el('label', { class: 'field field--full' }, [
          el('span', { class: 'field__label', text: 'TMDB 接口地址' }),
          inputEl('text', { name: 'tmdbApiBase', spellcheck: 'false', value: settings.tmdbApiBase || '' }),
          hintEl('后端访问 TMDB 的接口地址，可由后端替换为镜像。'),
        ]),
        el('label', { class: 'field field--full' }, [
          el('span', { class: 'field__label', text: 'TMDB 图片地址' }),
          inputEl('text', { name: 'tmdbImageBase', spellcheck: 'false', value: settings.tmdbImageBase || '' }),
          hintEl('海报与剧照的图片来源，前端只通过 /api/image 取图。'),
        ]),
        el('label', { class: 'field field--full' }, [
          el('span', { class: 'field__label', text: '网络代理' }),
          inputEl('text', {
            name: 'proxy', spellcheck: 'false', value: settings.proxy || '', placeholder: '留空表示不使用代理',
          }),
          hintEl('后端访问 TMDB 与索引源时使用的代理。'),
        ]),
      ]),
    ]),

    settingsCardEl('qBittorrent', '选好的种子交给 qB 下载，限速与做种策略在 qB 里设置', [
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field field--full' }, [
          el('span', { class: 'field__label', text: 'qBittorrent 地址' }),
          inputEl('text', {
            id: 'set-qb-url', name: 'qbUrl', spellcheck: 'false',
            value: settings.qbUrl || '', placeholder: 'http://<NAS 局域网 IP>:<qB WebUI 端口>',
          }),
          hintEl('填 NAS 的局域网 IP + qB 的 WebUI 端口，例如 http://192.168.1.10:端口号。'
            + '不要填 127.0.0.1 或 localhost —— 容器里的回环地址指向 wanspilot 自己，连不到 qB。'
            + '留空表示不启用下载。'),
        ]),
      ]),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '用户名' }),
          inputEl('text', {
            name: 'qbUsername', autocomplete: 'off', spellcheck: 'false',
            value: settings.qbUsername || '', placeholder: '留空表示免登录',
          }),
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '密码' }),
          inputEl('password', { name: 'qbPassword', autocomplete: 'new-password', value: '', placeholder: settings.qbPasswordSet ? '已配置 · 留空保留' : '填写 qB 密码' }),
        ]),
      ]),
      switchEl(checkboxEl({ name: 'clearQbPassword' }), '清除已保存的 qB 密码'),
      el('p', { class: 'field__hint', text: 'qB 开了「本地主机跳过认证」时，用户名和密码都可以留空。' }),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '保存目录（qB 视角）' }),
          inputEl('text', {
            name: 'qbSavePath', spellcheck: 'false',
            value: settings.qbSavePath || '', placeholder: '留空用 qB 默认目录',
          }),
          hintEl('填 qB 里看到的路径，比如 /video。'),
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '本地挂载路径（本容器视角）' }),
          inputEl('text', {
            name: 'qbLocalPath', spellcheck: 'false',
            value: settings.qbLocalPath || '', placeholder: '留空则不做自动整理',
          }),
          hintEl('把 qB 的下载目录按同一路径挂给 wanspilot 后填这里。'),
        ]),
      ]),
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '分类名' }),
          inputEl('text', { name: 'qbCategory', spellcheck: 'false', value: settings.qbCategory || '' }),
          hintEl('wanspilot 添加的任务会打上这个分类。'),
        ]),
      ]),
      el('div', { class: 'row row--wrap' }, [
        buttonEl({ class: 'btn', 'data-action': 'test-qb' }, 'activity', '测试 qB 连接'),
        el('span', { class: 'field__hint', id: 'qb-test-result' }),
      ]),
    ]),

    settingsCardEl('筛选与订阅', '自动挑片时按这些门槛过滤', [
      el('div', { class: 'form-grid' }, [
        fieldEl('默认清晰度偏好', qualitySelectEl('qualityPreference', settings.qualityPreference || '1080p')),
        fieldEl('最低做种数', inputEl('number', {
          name: 'minSeeders', min: '0', step: '1',
          value: settings.minSeeders === undefined ? 5 : settings.minSeeders,
        })),
        fieldEl('单个资源最大体积（GB）', inputEl('number', {
          name: 'maxSizeGB', min: '1', step: '1',
          value: settings.maxSizeGB === undefined ? 30 : settings.maxSizeGB,
        })),
        fieldEl('订阅检查间隔（分钟）', inputEl('number', {
          name: 'checkIntervalMinutes', min: '5', step: '5',
          value: settings.checkIntervalMinutes === undefined ? 60 : settings.checkIntervalMinutes,
        })),
      ]),
      switchEl(checkboxEl({ name: 'autoDownload', checked: settings.autoDownload === false ? null : true }),
        '检查到符合条件的资源时自动下载'),
    ]),

    settingsCardEl('下载与整理', '配额、归档与元数据', [
      el('div', { class: 'form-grid' }, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: '配额上限（GB，0 表示不限）' }),
          inputEl('number', { name: 'quotaGB', min: '0', step: '10', value: settings.quotaGB || 0 }),
          hintEl('加入下载前会先比一次剩余空间与配额。'),
        ]),
      ]),
      switchEl(checkboxEl({ name: 'autoOrganize', checked: settings.autoOrganize ? true : null }),
        '下载完成后硬链接归档，跨盘保留原件复制，不影响做种'),
      switchEl(checkboxEl({ name: 'writeNfo', checked: settings.writeNfo ? true : null }),
        '同时写 .nfo 与海报，Jellyfin / Emby 可直接识别'),
      switchEl(checkboxEl({ name: 'deleteSamples', checked: settings.deleteSamples === false ? null : true }),
        '整理时跳过样本文件（保留 qB 原文件）'),
      el('div', { class: 'row row--wrap' }, [
        buttonEl({ class: 'btn', 'data-action': 'organize-preview' }, 'folder', '预览整理'),
        buttonEl({ class: 'btn', 'data-action': 'organize-now' }, 'folder-plus', '整理已完成的任务'),
        el('span', { class: 'field__hint', id: 'organize-result' }),
      ]),
    ]),

    el('div', { class: 'settings__savebar' }, [
      el('span', { class: 'save-state', id: 'save-state', role: 'status', text: '所有更改已保存' }),
      buttonEl({ type: 'submit', class: 'btn btn--primary' }, null, '保存设置'),
      buttonEl({ class: 'btn', 'data-action': 'reload' }, null, '重新载入'),
      linkEl({ class: 'btn btn--ghost', href: '#/overview' }, 'activity', '运行总览'),
      el('p', { class: 'notice notice--muted', id: 'settings-message', hidden: true }),
    ]),
  ]);

  // 前四张卡片按 SETTINGS_SECTIONS 的顺序贴上分区标记，只显示命中的那张；
  // 最后一项「自检与系统」在表单外面，由 paintSettings 单独拼。
  SETTINGS_SECTIONS.slice(0, 4).forEach(function (section, index) {
    const card = form.children[index];
    if (!card) return;
    card.dataset.section = section.id;
    card.classList.toggle('is-active', section.id === settingsTab);
  });
  organizeSettingsFields(form, settings);
  // 「自检与系统」这一区没有表单字段，保存条留在页面上只会碍事
  form.classList.toggle('is-diag', settingsTab === 'diag');
  return form;
}


/* 设置页先用手上的数据画出来，自检结果晚一步贴上来：
   自检要现场打 TMDB 与索引源，慢的时候十几秒，不能让它挡住整页。 */
const SELFTEST_TTL_MS = 60 * 1000;

function organizeSettingsFields(form, settings) {
  const move = function(section, names, title, subtitle) {
    const card=form.querySelector('[data-section="'+section+'"]');
    const fields=names.map(name=>form.elements[name]?.closest('.field')).filter(Boolean);
    if (!card || !fields.length) return;
    const details=el('details', {class:'settings-advanced'}, [el('summary',{},[el('span',{},[el('strong',{text:title}),el('span',{text:subtitle})]),iconNode('chevron-down')]), el('div',{class:'form-grid settings-advanced__body'},fields)]);
    card.querySelectorAll('.form-grid').forEach(grid=>{if(!grid.children.length)grid.remove();});
    const action=card.querySelector('.row'); card.insertBefore(details,action || null);
  };
  move('tmdb',['tmdbApiBase','tmdbImageBase','proxy'],'网络与镜像','接口地址、图片来源及网络代理');
  move('qb',['qbSavePath','qbLocalPath','qbCategory'],'目录与分类','按需设置保存目录和自动整理路径');
  const tmdb=form.querySelector('[data-section="tmdb"]');
  tmdb.append(el('div',{class:'source-entry'},[el('div',{},[el('strong',{text:'资源渠道'}),el('p',{class:'field__hint',text:'接入 Torznab / RSS，手动搜索和自动订阅共用启用的渠道。'})]),linkEl({class:'btn',href:'#/sources'},'search','配置资源渠道')]));
  tmdb.append(el('div',{class:'connection-actions'},[buttonEl({class:'btn','data-action':'test','data-kind':'tmdb'},'activity','测试连接'),buttonEl({class:'btn btn--ghost','data-action':'test','data-kind':'image'},'image','测试图片'),el('span',{class:'connection-result',role:'status',text:settings.tmdbApiKeySet?'密钥已配置 · 可测试连接':'等待配置密钥'})]));
  const qb=form.querySelector('#qb-test-result'); if(qb){qb.classList.add('connection-result');qb.setAttribute('role','status');qb.textContent=settings.qbUrl?'地址已填写 · 可测试连接':'填写地址后测试连接';}
}
let logText='',logBusy=false;
function paintLogs() {
  const pre=$('#logs');if(!pre)return;
  const atBottom=pre.scrollHeight-pre.scrollTop-pre.clientHeight<40;
  const query=($('#logs-filter')?.value || '').toLowerCase();
  pre.textContent=logText.split('\n').filter(line=>!query || line.toLowerCase().includes(query)).join('\n') || (query?'没有匹配的记录':'暂无日志');
  if(atBottom)pre.scrollTop=pre.scrollHeight;
}
async function refreshLogs(force) {
  const pre=$('#logs');
  if(logBusy || !accessReady || !pre || (!force && (document.hidden || !$('#logs-auto')?.checked || !document.querySelector('.settings-group[data-section="diag"].is-active'))))return;
  logBusy=true;
  try {const text=await apiText('/logs?lines=1000');if(!pre.isConnected)return;logText=text;paintLogs();const hint=$('#logs-feedback');if(hint)hint.textContent='已同步 '+shanghaiTime()+' · 上海时间 · 最近 1000 行 · /data/logs 保留文件记录';}
  catch(error){const hint=$('#logs-feedback');if(hint)hint.textContent='日志同步失败：'+error.message+'，可刷新重试';}
  finally{logBusy=false;}
}
setInterval(()=>refreshLogs(false),3000);

function inlineTestResult(button, text, state) {
  const card=button.closest('.panel'); if(!card)return;
  let note=card.querySelector('.connection-result');
  if(!note){note=el('p',{class:'connection-result',role:'status'});card.append(note);}
  note.textContent=text; note.dataset.state=state || 'pending';
}

async function viewSources(ctx) {
  fill(ctx.host,pageEl(loadingEl('正在读取资源渠道…')));
  let data;
  try { data=await api('/indexers'); } catch(error) {fill(ctx.host,pageEl(errorEl(error.message)));return;}
  if(!ctx.host.isConnected)return;
  const cards=el('div',{class:'source-grid'});
  async function action(item,kind,button){
    if(kind==='delete'&&!confirm('移除「'+item.name+'」？已有下载任务会保留。'))return;
    button.disabled=true;
    try{
      if(kind==='test'){
        const result=await api('/indexers/'+encodeURIComponent(item.id)+'/test',{method:'POST'});
        toast(result.message,result.ok?'ok':'error');
      }else await api('/indexers/'+encodeURIComponent(item.id),{method:kind==='delete'?'DELETE':'PATCH',...(kind==='toggle'?{body:{enabled:!item.enabled}}:{})});
      if(parseRoute().name==='sources')render();
    }catch(error){toast(error.message,'error');if(button.isConnected)button.disabled=false;}
  }
  data.items.forEach(item=>cards.append(el('section',{class:'source-card','data-source-id':item.id},[
    el('div',{class:'source-card__head'},[el('h2',{text:item.name}),chipEl(item.enabled?'已启用':'已停用',item.enabled?'ok':'info')]),
    el('p',{class:'source-card__host',text:(item.type==='rss'?'RSS':'Torznab')+' · '+item.host}),
    el('p',{class:'field__hint',text:item.lastTest?(item.lastTest.ok?'连接正常':'连接异常')+' · '+shanghaiDateTime(item.lastTest.at)+' · '+item.lastTest.message:'尚未测试连接'}),
    el('div',{class:'source-card__actions'},[
      buttonEl({class:'btn btn--sm',on:{click:e=>action(item,'test',e.currentTarget)}},'activity','测试'),
      buttonEl({class:'btn btn--sm',on:{click:()=>editSource(item)}},null,'编辑'),
      buttonEl({class:'btn btn--sm',on:{click:e=>action(item,'toggle',e.currentTarget)}},null,item.enabled?'停用':'启用'),
      buttonEl({class:'btn btn--sm btn--ghost',on:{click:e=>action(item,'delete',e.currentTarget)}},'trash','移除')
    ])
  ])));
  fill(ctx.host,pageEl([
    el('header',{class:'page__head'},[el('div',{},[el('h1',{text:'资源渠道'}),el('p',{class:'page__sub',text:'手动搜索与自动订阅共用 · '+data.items.filter(i=>i.enabled).length+' 个自定义渠道已启用'})]),el('div',{class:'page__actions'},[linkEl({class:'btn',href:'#/settings?tab=tmdb'},'settings','设置'),buttonEl({class:'btn btn--primary',disabled:data.items.length>=data.limit,on:{click:()=>editSource()}},'plus','添加渠道')])]),
    el('section',{class:'source-intro'},[el('h2',{text:'接入索引服务'}),el('p',{text:'保留现有公共索引源。可接入 Prowlarr、Jackett 提供的 Torznab API，或站点提供的 RSS 搜索链接（地址里用 {query} 作关键词占位）；最多保存 '+data.limit+' 个渠道。'}),el('p',{class:'field__hint',text:'需要填写你自己的服务地址和访问凭据。RSS 地址含 {query} 时按关键词搜索，不含时只读取订阅源当前返回的条目；接入渠道不代表一定有匹配资源。'})]),
    data.items.length?cards:el('div',{class:'empty-state'},[iconNode('search'),el('h2',{text:'添加第一个资源渠道'}),el('p',{text:'添加你的索引服务，扩展中文剧集、动漫和电影的搜索覆盖。'})])
  ]));
  function editSource(item){
    const feedback=el('p',{class:'field__hint',role:'status','aria-live':'polite'});
    const presetSelect=el('select',{name:'preset','aria-label':'常用源预设',on:{change:()=>{
      const preset=SOURCE_PRESETS[presetSelect.selectedIndex];
      if(!preset||!preset.url)return;
      form.elements.name.value=preset.name;
      form.elements.type.value=preset.type;
      form.elements.url.value=preset.url;
      // 含占位符的地址无法通过浏览器的 URL 校验，临时换成文本框
      form.elements.url.type=/\{query\}/.test(preset.url)?'text':'url';
      feedback.textContent=/\{query\}/.test(preset.url)?'已填入搜索型 RSS 模板，{query} 会替换成搜索关键词，可直接保存。':'已填入预设，请把地址里的主机名和端口改成你实际的索引服务。';
    }}},SOURCE_PRESETS.map(p=>el('option',{value:p.label,text:p.label})));
    const form=el('form',{class:'form',id:'source-form'},[
      fieldEl('常用预设',presetSelect),
      fieldEl('渠道名称',el('input',{name:'name',required:true,maxlength:60,value:item?.name || '',placeholder:'例如：家庭索引服务'})),
      fieldEl('渠道类型',el('select',{name:'type'},['torznab','rss'].map(type=>el('option',{value:type,selected:(item?.type || 'torznab')===type?true:null,text:type==='rss'?'RSS 订阅源':'Torznab（Prowlarr / Jackett）'})))),
      fieldEl('服务地址',el('input',{name:'url',type:'url',required:item?null:true,autocomplete:'off',placeholder:item?'已保存，留空保留原地址':'http://NAS:9117/api/v2.0/indexers/all/results/torznab/api'})),
      el('p',{class:'field__hint',text:'Jackett 可复制 Torznab Feed 地址；Prowlarr 请复制单个索引器的 Torznab 地址（如 http://NAS:9696/1/api）。RSS 请填写完整订阅链接，搜索型站点把关键词写成 {query}（如 https://mikanime.tv/RSS/Search?searchstr={query}）。NAS 内网地址直接连接。部分 RSS 不提供做种数，自动订阅时需按实际情况调整最低做种数。'}),
      fieldEl('API Key（仅 Torznab，可选）',el('input',{name:'apiKey',type:'password',autocomplete:'new-password',maxlength:512,placeholder:item?.apiKeySet?'已保存，留空保留原密钥':'索引服务提供的 API Key'})),
      item?.apiKeySet?switchEl(el('input',{name:'clearApiKey',type:'checkbox'}),'清除已保存的 API Key'):null,
      switchEl(el('input',{name:'enabled',type:'checkbox',checked:item?.enabled===false?null:true}),'启用此渠道'),
      el('p',{class:'field__hint',text:'地址和密钥仅保存在服务端。保存后可测试连接；修改渠道后，请重新搜索资源。'}),feedback,
      el('div',{class:'modal__foot'},[buttonEl({class:'btn','data-close':true},null,'取消'),buttonEl({class:'btn btn--primary',type:'submit'},null,'保存渠道')])
    ]);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;feedback.textContent='正在保存…';
      const fields=form.elements,body={name:fields.name.value,type:fields.type.value,url:fields.url.value.trim(),apiKey:fields.apiKey.value.trim(),enabled:fields.enabled.checked,clearApiKey:fields.clearApiKey?.checked || false};
      try{await api('/indexers'+(item?'/'+encodeURIComponent(item.id):''),{method:item?'PATCH':'POST',body});closeModal();toast('渠道已保存','ok');if(parseRoute().name==='sources')render();}
      catch(error){feedback.textContent=error.message;button.disabled=false;}
    });
    openModal({title:item?'编辑资源渠道':'添加资源渠道',body:form});
  }
}

async function viewSettings(ctx) {
  const focusKey = ctx.route.params.get('focus') === 'key';
  let settings = appState.settings || cachedPayload('/settings');
  if (!settings) {
    fill(ctx.host, pageEl(loadingEl('正在读取设置…')));
    settings = await api('/settings');
  }
  appState.settings = settings;
  settingsCache = settings;
  paintSettings(ctx, settings, settingsStatus, cachedPayload('/system'), focusKey, true);
  const form = $('#settings-form');
  const [statusRes, systemRes] = await Promise.allSettled([
    cachedApi('/settings/status', SELFTEST_TTL_MS), cachedApi('/system'),
  ]);
  if (!form || $('#settings-form') !== form) return;
  if (statusRes.status === 'fulfilled') {
    settingsStatus = statusRes.value;
    const host = $('#settings-status');
    if (host) host.replaceWith(statusBlockEl(settingsStatus, false));
  }
  const systemHost = $('#settings-system');
  if (systemHost && systemRes.status === 'fulfilled') {
    const sys = systemRes.value;
    const kv = systemHost.querySelector('.kv');
    const content = el('div', { class: 'kv' }, [
      kvRowEl('版本', sys.version || '未知'), kvRowEl('Node', sys.nodeVersion || ''),
      kvRowEl('数据目录', sys.dataDir || ''), kvRowEl('下载目录', sys.downloadDir || '未挂载'),
      kvRowEl('剩余空间', sys.freeBytes < 0 ? '等待 qB 上报' : fmtBytes(sys.freeBytes)),
      kvRowEl('已运行', fmtUptime(sys.uptimeSeconds)), kvRowEl('下载引擎', sys.engineReady ? '就绪' : '未就绪'),
    ]);
    if (kv) kv.replaceWith(content); else { const old = systemHost.lastElementChild; if (old?.className !== 'panel__head') old?.remove(); systemHost.append(content); }
  }
}

/** 画设置页（表单 + 自检 + 系统信息 + 日志），并绑好这一份 DOM 上的处理函数。 */
function paintSettings(ctx, settings, status, system, focusKey, pending) {
  settingsStatus = status === undefined ? settingsStatus : status;
  const keyMissing = !(settings.tmdbApiKeySet || settings.tmdbApiKey);
  const highlightKey = focusKey || keyMissing;

  // 分区优先级：聚焦 TMDB Key > 地址栏 ?tab= > 上次停留的分区
  const tabParam = ctx.route.params.get('tab');
  if (focusKey) settingsTab = 'tmdb';
  else if (tabParam && settingsSectionExists(tabParam)) settingsTab = tabParam;

  const callout = highlightKey
    ? el('div', { class: 'notice notice--accent' }, [
      el('p', { class: 'notice__title' }, [
        iconNode('alert'),
        el('span', { text: '先填写 TMDB API Key' }),
      ]),
      el('p', {
        class: 'notice__text',
        text: '影视墙、搜索和详情页的数据都来自 TMDB。请在 TMDB 账号设置里申请 API Key（v3 auth），'
          + '填到下面第一项，保存后点「测试 TMDB」确认可用。如果后端无法直连 TMDB，再填写接口地址或网络代理。',
      }),
    ])
    : null;

  const systemBlock = el('div', { class: 'panel', id: 'settings-system' }, [
    el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title', text: '系统信息' })),
    system
      ? el('div', { class: 'kv' }, [
        kvRowEl('版本', system.version || '未知'),
        kvRowEl('Node', system.nodeVersion || '未知'),
        kvRowEl('数据目录', system.dataDir || ''),
        kvRowEl('下载目录', system.downloadDir || '未挂载（下载由 qBittorrent 负责）'),
        kvRowEl('目录可写', system.downloadDirWritable ? '是' : '否'),
        kvRowEl('剩余空间', fmtBytes(system.freeBytes)),
        kvRowEl('已运行', fmtUptime(system.uptimeSeconds)),
        kvRowEl('下载引擎', system.engineReady ? '就绪' : '未就绪'),
      ])
      : (pending ? loadingEl('正在读取系统信息…') : errorEl('系统信息不可用')),
  ]);

  const logsBlock = el('div', { class: 'panel' }, [
    el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: '运行日志' }),
      el('div',{class:'row row--wrap'},[el('label',{class:'logs-auto'},[el('input',{type:'checkbox',id:'logs-auto',checked:true}), '自动刷新']),buttonEl({ class: 'btn btn--sm', 'data-action': 'load-logs' }, 'refresh', '刷新'),linkEl({class:'btn btn--sm',href:'/api/logs?lines=2000',download:'wanspilot.log'},'download','导出')]),
    ]),
    el('p',{class:'field__hint',id:'logs-feedback',role:'status',text:'最近 1000 行，每 3 秒刷新；更早记录保存在 /data/logs。'}),
    el('input',{type:'search',id:'logs-filter',placeholder:'筛选片名、操作或错误…','aria-label':'筛选日志',on:{input:paintLogs}}),
    el('pre', { class: 'debug logs', id: 'logs', text: '正在读取日志…' }),
  ]);

  fill(ctx.host, pageEl([
    el('header', { class: 'page__head' }, el('div', {}, [
      el('h1', { text: '设置' }),
      el('p', { class: 'page__sub', text: '管理 TMDB、下载连接、订阅规则与自检' }),
    ])),
    callout,
    el('div', { class: 'settings-shell' }, [
      el('div', { class: 'settings-navigation' }, [settingsNavEl(settingsTab), el('label', { class: 'settings-mobile-nav' }, [
        el('span', { class: 'field__label', text: '设置分区' }),
        el('select', { id: 'settings-section', 'aria-label': '设置分区', on: { change: function (event) {
          const button = document.querySelector('.settings-nav__item[data-target="' + event.target.value + '"]');
          if (button) button.click();
        } } }, SETTINGS_SECTIONS.map(function (section) { return el('option', { value: section.id, selected: section.id === settingsTab, text: section.label }); })),
      ])]),
      el('div', { class: 'settings__body' }, [
        settingsFormEl(settings, highlightKey),
        el('div', {
          class: classNames('settings-group', settingsTab === 'diag' && 'is-active'),
          'data-section': 'diag',
        }, [
          statusBlockEl(settingsStatus, pending && !settingsStatus),
          systemBlock,
          logsBlock,
        ]),
      ]),
    ]),
  ]));

  const form = $('#settings-form');
  restoreSettingsDraft(form);
  form.addEventListener('invalid',function(event){let node=event.target.parentElement;while(node&&node!==form){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}},true);
  form.addEventListener('input', function () { settingsDirty = true; captureSettingsDraft(form); updateSaveState('有未保存的更改'); });
  form.addEventListener('change', function () { settingsDirty = true; captureSettingsDraft(form); updateSaveState('有未保存的更改'); });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (form.dataset.saving) return;
    const message = $('#settings-message');
    message.hidden = true;
    const body = {
      quotaGB: Number(form.elements.quotaGB.value) || 0,
      autoOrganize: form.elements.autoOrganize.checked,
      writeNfo: form.elements.writeNfo.checked,
      deleteSamples: form.elements.deleteSamples.checked,
      tmdbApiKey: String(form.elements.tmdbApiKey.value || '').trim(),
      tmdbApiBase: String(form.elements.tmdbApiBase.value || '').trim(),
      tmdbImageBase: String(form.elements.tmdbImageBase.value || '').trim(),
      proxy: String(form.elements.proxy.value || '').trim(),
      qbUrl: String(form.elements.qbUrl.value || '').trim(),
      qbUsername: String(form.elements.qbUsername.value || '').trim(),
      qbPassword: String(form.elements.qbPassword.value || ''),
      qbSavePath: String(form.elements.qbSavePath.value || '').trim(),
      qbLocalPath: String(form.elements.qbLocalPath.value || '').trim(),
      qbCategory: String(form.elements.qbCategory.value || '').trim(),
      qualityPreference: form.elements.qualityPreference.value,
      minSeeders: Number(form.elements.minSeeders.value) || 0,
      maxSizeGB: Number(form.elements.maxSizeGB.value) || 0,
      checkIntervalMinutes: Number(form.elements.checkIntervalMinutes.value) || 0,
      autoDownload: form.elements.autoDownload.checked
    };
    if (!body.tmdbApiKey) delete body.tmdbApiKey;
    if (!body.qbPassword) delete body.qbPassword;
    if (form.elements.clearTmdbKey.checked) body.tmdbApiKey = '';
    if (form.elements.clearQbPassword.checked) body.qbPassword = '';
    form.dataset.saving = '1';
    form.inert = true;
    const saveButton = form.querySelector('[type="submit"]');
    saveButton.disabled = true;
    updateSaveState('正在保存…');
    try {
      const saved = await api('/settings', { method: 'PUT', body: body });
      appState.settings = saved || body;
      settingsCache = appState.settings;
      settingsDirty = false; settingsDraft = null;
      form.elements.tmdbApiKey.value = ''; form.elements.qbPassword.value = '';
      form.elements.clearTmdbKey.checked = false; form.elements.clearQbPassword.checked = false;
      form.elements.tmdbApiKey.placeholder = saved.tmdbApiKeySet ? '已配置 · 留空保留，输入新值替换' : '填写 TMDB API Key';
      form.elements.qbPassword.placeholder = saved.qbPasswordSet ? '已配置 · 留空保留' : '填写 qB 密码';
      updateSaveState('所有更改已保存');
      dropStash(); viewCache.delete('/settings'); viewCache.delete('/settings/status'); viewCache.delete('/tmdb/home');
      message.hidden=false; message.className='settings-confirmation'; message.textContent='设置已保存，已应用当前配置。';
      api('/settings/status').then(function (status) {
        settingsStatus = status;
        if ($('#settings-form') !== form) return;
        const host = $('#settings-status');
        if (host) host.replaceWith(statusBlockEl(status, false));
      }).catch(function (error) { toast('设置已保存，但自检失败：' + error.message, 'error'); });
    } catch (error) {
      message.hidden = false;
      message.className = 'notice notice--err';
      message.textContent = '保存失败：' + error.message;
      updateSaveState('保存失败 · 更改已保留');
    } finally { delete form.dataset.saving; form.inert = false; saveButton.disabled = false; }
  });

  currentActions.reload = function () {
    if (settingsDirty && !confirm('重新载入会丢弃未保存的更改，继续吗？')) return;
    settingsDraft = null; settingsDirty = false; render();
  };
  /* 分区切换：只动 class，不重绘整页，避免表单里已输入的内容被冲掉。 */
  currentActions['settings-tab'] = function (button) {
    const target = button && button.getAttribute('data-target');
    if (!target || !settingsSectionExists(target)) return;
    settingsTab = target;
    const sectionPicker = $('#settings-section'); if (sectionPicker) sectionPicker.value = target;
    document.querySelectorAll('.settings-nav__item').forEach(function (item) {
      const isActive = item.getAttribute('data-target') === target;
      item.classList.toggle('is-active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.settings-shell [data-section]').forEach(function (node) {
      node.classList.toggle('is-active', node.getAttribute('data-section') === target);
    });
    const form = document.querySelector('#settings-form');
    if (form) form.classList.toggle('is-diag', target === 'diag');
    try { history.replaceState(null, '', '#/settings?tab=' + target); } catch (error) { /* 忽略 */ }
    const shell = document.querySelector('.settings-shell');
    if (shell) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if(target==='diag')refreshLogs(true);
  };
  currentActions['toggle-key'] = function (button) {
    const input = $('#set-tmdb-key');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const label = button && button.querySelector('span');
    if (label) label.textContent = show ? '隐藏' : '显示';
    if (button) button.setAttribute('aria-pressed', show ? 'true' : 'false');
  };
  currentActions['test-qb'] = async function (button) {
    const form = $('#settings-form');
    const hint = $('#qb-test-result');
    if (hint) {hint.textContent='正在连接…';hint.dataset.state='pending';}
    if (button) button.disabled = true;
    try {
      const result = await api('/settings/test', {
        method: 'POST',
        body: {
          kind: 'qb',
          qbUrl: String(form.elements.qbUrl.value || '').trim(),
          qbUsername: String(form.elements.qbUsername.value || '').trim(),
          ...(form.elements.qbPassword.value ? { qbPassword: String(form.elements.qbPassword.value) } : {}),
          ...(form.elements.clearQbPassword.checked ? { qbPassword: '' } : {}),
        },
      });
      if (hint) {hint.textContent=(result.ok?'✓ ':'✗ ')+(result.message || '');hint.dataset.state=result.ok?'ok':'error';}
    } catch (error) {
      if (hint) {hint.textContent='✗ '+error.message;hint.dataset.state='error';}
    } finally {
      if (button && document.contains(button)) button.disabled = false;
    }
  };
  currentActions.test = async function (button) {
    const kind = button.getAttribute('data-kind') || 'tmdb';
    const body = { kind: kind };
    const form = $('#settings-form');
    if (form) {
      for (const key of ['tmdbApiBase', 'tmdbImageBase', 'proxy']) body[key] = String(form.elements[key].value || '').trim();
      if (form.elements.tmdbApiKey.value || form.elements.clearTmdbKey.checked) body.tmdbApiKey = String(form.elements.tmdbApiKey.value || '').trim();
    }
    const sourceId = button.getAttribute('data-id');
    if (sourceId) body.id = sourceId;
    button.disabled = true; button.setAttribute('aria-busy','true');
    inlineTestResult(button,'正在测试连接…','pending');
    try {
      const result = await api('/settings/test', { method: 'POST', body: body });
      settingsStatus = Object.assign({}, settingsStatus || {}, result || {});
      const host = $('#settings-status');
      if (host) host.replaceWith(statusBlockEl(settingsStatus));
      const checks = kind === 'source'
        ? (result.sources || []).filter(source => !sourceId || source.id === sourceId).map(source => ({ok:source.ok,message:source.message || source.name}))
        : kind === 'image' ? [{ok:result.tmdbImageOk,message:result.tmdbImageMessage}]
        : kind === 'proxy' ? [{ok:result.tmdbOk,message:result.tmdbMessage},{ok:result.tmdbImageOk,message:result.tmdbImageMessage}]
        : [{ok:result.tmdbOk,message:result.tmdbMessage}];
      const passed = checks.length > 0 && checks.every(check => check.ok === true);
      const messages = checks.filter(check => !passed ? check.ok !== true : true).map(check => check.message).filter(Boolean);
      inlineTestResult(button, (passed ? '✓ ' : '✗ ') + (messages.join('；') || '未获得有效测试结果'), passed?'ok':'error');
    } catch (error) { inlineTestResult(button,error.message,'error'); }
    finally { if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');} }
  };
  currentActions['organize-preview'] = async function (button) {
    button.disabled = true;
    try {
      const result = await api('/organizer/preview', { timeoutMs: 180000 });
      const reports = result.reports || [];
      openModal({ title: '整理预览 · 原文件完整保留', body: el('div', { class: 'preview-list' }, reports.length ? reports.map(function (report) {
        return el('section', { class: 'panel' }, [el('h3', { text: report.name || '任务' }),
          el('p', { class: 'page__sub', text: report.skipped || ('计划归档 ' + report.planned.length + ' 个文件，已归档 ' + report.existing + ' 个') }),
          report.planned.map(function (file) { return el('div', { class: 'preview-file' }, [el('span', { text: file.source }), el('span', { text: '→ ' + file.target })]); }),
          report.errors.map(function (error) { return el('p', { class: 'task__error', text: error }); }),
        ]);
      }) : emptyEl('暂无已完成的下载任务。')) });
    } catch (error) { toast(error.message, 'error'); }
    finally { if (document.contains(button)) button.disabled = false; }
  };
  currentActions['organize-now'] = async function (button) {
    if (button) button.disabled = true;
    const hint = $('#organize-result');
    if (hint) hint.textContent = '正在整理…';
    try {
      const data = await api('/organizer/run', { method: 'POST' });
      const reports = (data && data.reports) || [];
      const moved = reports.reduce(function (sum, item) { return sum + (item.moved || 0); }, 0);
      const skipped = reports.filter(function (item) { return item.skipped; }).length;
      if (hint) hint.textContent = '整理完成：归档 ' + moved + ' 个文件' + (skipped ? '，' + skipped + ' 个任务跳过' : '');
      const errors = reports.reduce(function (n, report) { return n + (report.errors || []).length; }, 0);
      toast(errors ? '部分文件整理失败，请查看日志' : '整理完成，原文件已保留', errors ? 'error' : 'ok');
    } catch (error) {
      if (hint) hint.textContent = error.message;
      toast(error.message, 'error');
    }
    finally { if (button && document.contains(button)) button.disabled = false; }
  };
  currentActions['load-logs'] = async function(button){button.disabled=true;await refreshLogs(true);if(button.isConnected)button.disabled=false;};
  if(settingsTab==='diag')refreshLogs(true);

  if (highlightKey) {
    const field = $('#tmdb-key-field');
    if (field) {
      field.scrollIntoView({ block: 'center' });
      const input = field.querySelector('input');
      if (input) input.focus({ preventScroll: true });
    }
  }
}

/* ---------- 网盘选择器 ---------- */


function normalizePickedList(detail) {
  if (!detail) return [];
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first && (Array.isArray(first) || typeof first === 'object')) return normalizePickedList(first);
    return detail;
  }
  if (typeof detail === 'object') {
    const inner = detail.fileList || detail.files || detail.items || detail.list || detail.data;
    if (inner) return normalizePickedList(inner);
    return [detail];
  }
  return [];
}

/* 官方选择器有时把整条记录当成 JSON 字符串塞回来（[{"basename":"下载","filename":"/下载",…}]），
   这里先把它拆开，再按字段优先级取值，避免把整段 JSON 填进输入框。 */
function unwrapPickedJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '[' && text[0] !== '{')) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function pickedValue(item) {
  let node = unwrapPickedJson(item);
  if (Array.isArray(node)) node = node[0];
  node = unwrapPickedJson(node);
  if (typeof node === 'string') return node.trim();
  if (!node || typeof node !== 'object') return '';
  for (let i = 0; i < PICKED_VALUE_KEYS.length; i += 1) {
    const value = node[PICKED_VALUE_KEYS[i]];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stringifyForDebug(value) {
  const seen = new WeakSet();
  let text;
  try {
    text = JSON.stringify(value, function (_key, item) {
      if (typeof item === 'function') return '[function]';
      if (typeof File !== 'undefined' && item instanceof File) {
        return '[File ' + item.name + ' ' + item.size + 'B]';
      }
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[circular]';
        seen.add(item);
      }
      if (typeof item === 'string' && item.length > 800) return item.slice(0, 800) + '…';
      return item;
    }, 2);
  } catch {
    text = String(value);
  }
  if (typeof text !== 'string') text = String(text);
  if (!text) text = String(value);
  return text.length > 4000 ? text.slice(0, 4000) + '\n…（已截断）' : text;
}

function readPickerPayload(event) {
  const source = event && typeof event.detail !== 'undefined' ? event.detail : event;
  const list = normalizePickedList(source);
  let value = '';
  for (let i = 0; i < list.length; i += 1) {
    const candidate = pickedValue(list[i]);
    if (candidate) { value = candidate; break; }
  }
  if (!value && event) {
    for (let i = 0; i < PICKED_VALUE_KEYS.length; i += 1) {
      const fallback = event[PICKED_VALUE_KEYS[i]];
      if (typeof fallback === 'string' && fallback.trim()) { value = fallback.trim(); break; }
    }
  }
  return { value: value, raw: stringifyForDebug(source) };
}

/* 懒猫平台的网盘选择器是一个自定义元素，只在平台里由平台脚本注入。
   Docker 部署没有它，此时相关入口要么隐藏、要么给出明确的降级提示。 */
function hasCloudPicker() {
  return !!(window.customElements && customElements.get('lzc-file-picker'));
}

function openFilePicker(kind) {
  return new Promise(function (resolve) {
    const host = $('#picker-host');
    const label = kind === 'directory' ? '选择下载目录' : '选择种子文件';
    fill(host, el('div', { class: 'picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, [
      el('header', { class: 'picker__head' }, [
        el('h2', { text: label }),
        el('button', {
          type: 'button', class: 'icon-btn', id: 'picker-close', 'aria-label': '关闭',
        }, iconNode('close')),
      ]),
      el('div', { class: 'picker__body', id: 'picker-mount' }),
    ]));
    host.hidden = false;

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      host.hidden = true;
      host.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(value || '');
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); finish(''); }
    }
    document.addEventListener('keydown', onKey, true);
    $('#picker-close').addEventListener('click', function () { finish(''); });

    const mount = $('#picker-mount');
    if (!hasCloudPicker()) {
      fill(mount, el('div', { class: 'notice notice--err' },
        el('p', { class: 'notice__text', text: '当前部署没有网盘选择器，请改用「选择本机种子文件」。' })));
      return;
    }

    const element = document.createElement('lzc-file-picker');
    element.setAttribute('type', kind === 'directory' ? 'directory' : 'file');
    if (kind === 'directory') {
      element.setAttribute('title', label);
    } else {
      element.setAttribute('title', label);
      element.setAttribute('extname', 'torrent');
      element.setAttribute('accept', '.torrent');
    }
    mount.appendChild(element);
    if (kind === 'directory') {
      // 组件在挂载时把特性读成字符串，空字符串在组件内部是假值。
      // 因此布尔 prop 必须在挂载后用 JS 属性赋值，才能传成 true。
      element.choiceDirOnly = true;
    }

    element.addEventListener('submit', function (event) {
      const picked = readPickerPayload(event);
      if (picked.value) { finish(picked.value); return; }
      fill(mount, el('div', { class: 'notice notice--warn' }, [
        el('p', { class: 'notice__title' }, [
          iconNode('alert'),
          el('span', { text: '没能识别出文件路径' }),
        ]),
        el('p', {
          class: 'notice__text',
          text: '选择器返回的数据里没有 path / webkitRelativePath / name / url 字段。'
            + '下面是原始内容，请反馈给开发者。',
        }),
        el('pre', { class: 'debug', text: picked.raw }),
        buttonEl({ class: 'btn', id: 'picker-close-2' }, null, '关闭'),
      ]));
      const close2 = $('#picker-close-2');
      if (close2) close2.addEventListener('click', function () { finish(''); });
    });
    element.addEventListener('close', function () { finish(''); });
  });
}

/* ---------- 导入种子对话框 ---------- */

function readFileBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = function () { reject(new Error('读取本地文件失败')); };
    reader.readAsDataURL(file);
  });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* 网盘文件地址转成同源文件桥地址，桥的前缀与语义见 lzc-manifest.yml。 */
function bridgeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (raw.indexOf(BRIDGE_ROOT + '/') === 0) return raw;
  for (let i = 0; i < HOME_PREFIXES.length; i += 1) {
    if (raw.indexOf(HOME_PREFIXES[i]) === 0) {
      return BRIDGE_ROOT + '/' + raw.slice(HOME_PREFIXES[i].length);
    }
  }
  if (raw.charAt(0) === '/') return BRIDGE_ROOT + raw;
  let parsed = null;
  try { parsed = new URL(raw); } catch { return raw; }
  let path = parsed.pathname;
  for (let i = 0; i < HOME_PREFIXES.length; i += 1) {
    if (path.indexOf(HOME_PREFIXES[i]) === 0) {
      path = '/' + path.slice(HOME_PREFIXES[i].length);
      break;
    }
  }
  return BRIDGE_ROOT + path + parsed.search;
}

function openImportDialog(prefill) {
  const valueBox = el('textarea', {
    name: 'value', rows: '3', spellcheck: 'false',
    placeholder: 'magnet:?xt=urn:btih:… 或种子文件地址',
    text: prefill || '',
  });
  const fileInput = el('input', {
    class: 'hidden-input',
    type: 'file',
    id: 'torrent-file',
    accept: '.torrent,application/x-bittorrent',
  });
  const importForm = el('form', { class: 'form', id: 'import-form' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: '磁力链接或种子文件地址' }),
      valueBox,
    ]),
    el('div', { class: 'row row--wrap' }, [
      hasCloudPicker()
        ? buttonEl({ class: 'btn', 'data-action': 'pick-torrent-cloud' }, 'folder', '从网盘选择种子')
        : null,
      buttonEl({ class: 'btn', 'data-action': 'pick-torrent-local' }, 'file', '选择本机种子文件'),
    ]),
    fileInput,
    el('p', { class: 'field__hint', text: '支持 magnet 链接、40 位 infoHash，或选择本机 .torrent 文件。' }),
    el('p', { class: 'field__hint', id: 'import-picked', hidden: true }),
    el('div', { class: 'modal__foot' }, [
      buttonEl({ class: 'btn', 'data-close': true }, null, '取消'),
      buttonEl({ type: 'submit', class: 'btn btn--primary' }, null, '开始下载'),
    ]),
  ]);
  openModal({
    title: '导入下载任务',
    size: 'md',
    body: importForm,
    actions: {
      'pick-torrent-cloud': async function () {
        const value = await openFilePicker('torrent');
        if (!value) return;
        const form = $('#import-form');
        if (form) form.elements.value.value = value;
        const note = $('#import-picked');
        if (note) { note.hidden = false; note.textContent = '已从网盘选择：' + value; }
      },
      'pick-torrent-local': function () {
        const input = $('#torrent-file');
        if (input) input.click();
      }
    },
    onMount: function (panel) {
      let pendingBase64 = '';
      const fileInput = panel.querySelector('#torrent-file');
      const note = panel.querySelector('#import-picked');
      fileInput.addEventListener('change', async function () {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          pendingBase64 = await readFileBase64(file);
          if (note) {
            note.hidden = false;
            note.textContent = '已选择本机文件：' + file.name + '（' + fmtBytes(file.size) + '）';
          }
        } catch (error) {
          pendingBase64 = '';
          toast(error.message, 'error');
        }
      });

      const form = panel.querySelector('#import-form');
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const value = String(form.elements.value.value || '').trim();
        try {
          if (pendingBase64) {
            await api('/tasks', { method: 'POST', body: { torrentBase64: pendingBase64 } });
          } else {
            await api('/tasks', { method: 'POST', body: await buildImportBody(value) });
          }
          toast('已加入下载队列', 'ok');
          closeModal();
          if (parseRoute().name === 'tasks') pollTasks();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  });
}

async function buildImportBody(value) {
  if (!value) throw new Error('请填写磁力链接，或选择种子文件');
  if (value.indexOf('magnet:') === 0) return { magnet: value };
  if (/^[0-9a-fA-F]{40}$/.test(value)) return { infoHash: value.toLowerCase() };
  const response = await fetch(bridgeUrl(value), { credentials: 'same-origin' });
  if (!response.ok) throw new Error('读取种子文件失败（HTTP ' + response.status + '）');
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error('种子文件内容为空');
  return { torrentBase64: toBase64(buffer) };
}

/* ---------- 模态框 ---------- */

let modalOnClose = null;

function openModal(options) {
  closeModal();
  const root = $('#modal-root');
  const previous = document.activeElement;
  root.hidden = false;
  document.body.classList.add('has-modal');
  document.querySelector('.topbar').inert = true; document.querySelector('main').inert = true;
  const panel = el('div', {
    class: 'modal modal--' + (options.size || 'md'),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.title || '',
    tabindex: '-1',
  }, [
    el('header', { class: 'modal__head' }, [
      el('h2', { class: 'modal__title', text: options.title || '' }),
      el('button', {
        type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': '关闭',
      }, iconNode('close')),
    ]),
    el('div', { class: 'modal__body' }, options.body || null),
  ]);
  panel.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
  root.replaceChildren(
    el('div', { class: 'modal__backdrop', 'data-close': true }),
    panel,
  );

  modalActions = options.actions || {};
  modalOnClose = options.onClose || null;
  modalPreviousFocus = previous;
  const onKey = function (event) {
    if (event.key === 'Tab') {
      const nodes = Array.from(panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')).filter(function (node) { return !node.disabled && node.getClientRects().length; });
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeModal();
  };
  document.addEventListener('keydown', onKey, true);
  root.modalKeyHandler = onKey;

  const focusTarget = panel.querySelector('input, textarea, select, button:not([data-close])');
  (matchMedia('(max-width: 860px)').matches ? panel : (focusTarget || panel)).focus({ preventScroll: true });
  if (options.onMount) options.onMount(panel);
  return panel;
}

let modalActions = {};
let modalPreviousFocus = null;

function closeModal() {
  const root = $('#modal-root');
  if (!root || root.hidden) return;
  if (root.modalKeyHandler) {
    document.removeEventListener('keydown', root.modalKeyHandler, true);
    root.modalKeyHandler = null;
  }
  root.hidden = true;
  document.body.classList.remove('has-modal');
  document.querySelector('.topbar').inert = false; document.querySelector('main').inert = false;
  root.replaceChildren();
  modalActions = {};
  const onClose = modalOnClose;
  modalOnClose = null;
  const previous = modalPreviousFocus;
  modalPreviousFocus = null;
  if (previous && document.contains(previous) && previous.focus) {
    try { previous.focus({ preventScroll: true }); } catch { /* 元素已不可聚焦 */ }
  }
  if (onClose) onClose();
}

function confirmDialog(options) {
  return new Promise(function (resolve) {
    let answered = false;
    function settle(value) {
      if (answered) return;
      answered = true;
      resolve(value);
    }
    openModal({
      title: options.title,
      size: 'sm',
      body: frag([
        el('p', { class: 'modal__text', text: options.message }),
        options.extra ? el('div', { class: 'modal__extra' }, options.extra) : null,
        el('div', { class: 'modal__foot' }, [
          buttonEl({ class: 'btn', 'data-action': 'dialog-no' }, null, '取消'),
          buttonEl({
            class: classNames('btn', options.danger ? 'btn--danger' : 'btn--primary'),
            'data-action': 'dialog-yes',
          }, null, options.confirmText || '确认'),
        ]),
      ]),
      actions: {
        'dialog-yes': function () { settle(true); closeModal(); },
        'dialog-no': function () { settle(false); closeModal(); }
      },
      onClose: function () { settle(false); },
      onMount: options.onMount
    });
  });
}

/* ---------- 事件绑定与启动 ---------- */

const appState = { settings: null, settingsError: '' };

function takeOpenFileParam() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('lzcOpenFile');
  if (!raw) return '';
  params.delete('lzcOpenFile');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function syncMobileViewport() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : innerHeight;
  document.documentElement.style.setProperty('--visual-height', height + 'px');
  document.documentElement.style.setProperty('--visual-top', (viewport ? viewport.offsetTop : 0) + 'px');
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  document.body.classList.toggle('keyboard-open', editing && height < innerHeight * .8);
}
function bindGlobalEvents() {
  syncMobileViewport();
  matchMedia('(max-width: 860px)').addEventListener('change', function (event) {
    document.querySelectorAll('.filter-panel').forEach(panel => { panel.open = !event.matches; });
  });
  window.visualViewport?.addEventListener('resize', syncMobileViewport);
  window.visualViewport?.addEventListener('scroll', syncMobileViewport);
  window.addEventListener('resize', syncMobileViewport);
  document.addEventListener('focusin', syncMobileViewport);
  document.addEventListener('focusout', function () { setTimeout(syncMobileViewport, 0); });
  document.addEventListener('click', function (event) {
    const button = event.target.closest && event.target.closest('[data-action="theme-toggle"]');
    if (button) {
      event.preventDefault();
      toggleTheme();
    }
  });
  window.addEventListener('hashchange', function () { closeModal(); render(); });
  document.addEventListener('keydown', function (event) {
    if (!accessReady || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    event.preventDefault(); navigate('#/search');
  });

  $('#view').addEventListener('click', function (event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const handler = currentActions[trigger.getAttribute('data-action')];
    if (!handler) return;
    event.preventDefault();
    handler(trigger, event);
  });

  $('#modal-root').addEventListener('click', function (event) {
    const trigger = event.target.closest('[data-action]');
    if (trigger) {
      const handler = modalActions[trigger.getAttribute('data-action')];
      if (handler) { event.preventDefault(); handler(trigger, event); return; }
    }
    if (event.target.closest('[data-close]')) closeModal();
  });
}

function routeFirstLoad(openFile) {
  const go = function (hash) {
    history.replaceState(null, '', location.pathname + location.search + hash);
  };
  if (openFile) { go('#/tasks'); return; }
  const hash = location.hash;
  const atHome = !hash || hash === '#' || hash === '#/' || hash === '#/home';
  if (!atHome) return;
  if (appState.settings && !(appState.settings.tmdbApiKeySet || appState.settings.tmdbApiKey)) {
    // 首次打开且没有 TMDB Key 时，把用户带到设置页填写；其它深链接不劫持。
    go('#/settings?focus=key');
    return;
  }
  go('#/home');
}

/* ---------------------------------------------------------------- 主题 */

const THEME_KEY = 'wanspilot.theme';
const THEMES = [['light', '白天'], ['dark', '夜间']];

/** 只认白天与夜间两态；旧数据里的 auto 按系统偏好定一次就落成确定值。 */
function themePreference() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  if (saved === 'light' || saved === 'dark') return saved;
  const fromSettings = appState.settings && appState.settings.theme;
  if (fromSettings === 'light' || fromSettings === 'dark') return fromSettings;
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function themeLabel(pref) {
  const found = THEMES.filter(function (entry) { return entry[0] === pref; })[0];
  return found ? found[1] : '夜间';
}

function applyTheme(pref, persist) {
  const next = pref === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.setAttribute('data-theme', next);
  root.setAttribute('data-theme-pref', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // 隐私模式写不了本地缓存，不影响本次会话
  }
  const button = document.querySelector('[data-action="theme-toggle"]');
  if (button) {
    const sides = button.querySelectorAll('.themebtn__side');
    if (sides[0]) fill(sides[0], iconNode('sun'));
    if (sides[1]) fill(sides[1], iconNode('moon'));
    button.setAttribute('aria-checked', next === 'light' ? 'true' : 'false');
    button.setAttribute('aria-label', '当前' + themeLabel(next) + '主题，点击切换');
  }
  if (persist && appState.settings && appState.settings.theme !== next) {
    appState.settings.theme = next;
    api('/settings', { method: 'PUT', body: { theme: next } }).catch(function () {
      // 服务端保存失败只影响跨设备同步，本地已经生效
    });
  }
}

function toggleTheme() {
  const next = themePreference() === 'light' ? 'dark' : 'light';
  applyTheme(next, true);
}

async function boot() {
  bindGlobalEvents();
  document.querySelector('#logout-button')?.addEventListener('click', async function () {
    await api('/auth/logout', { method: 'POST' });
    location.reload();
  });
  const auth = await api('/auth/status');
  accessMode = auth.mode || 'token';
  if (!auth.authenticated) { showLogin(); return; }
  accessReady = true;
  document.body.classList.remove('is-locked');
  await startApp();
}

async function startApp() {
  const openFile = takeOpenFileParam();
  try {
    appState.settings = await api('/settings');
  } catch (error) {
    appState.settingsError = error.message;
  }
  applyTheme(themePreference(), Boolean(appState.settings && appState.settings.theme !== themePreference()));
  routeFirstLoad(openFile);
  render();
  settingsCache = appState.settings || null;
  if (appState.settings) startLive();
  refreshNotificationBadge();
  if (openFile) {
    openImportDialog(openFile);
    toast('已打开导入对话框，确认后即可开始下载', 'ok');
  }
}

let accessReady = false;
let accessMode = 'token';
let settingsDirty = false;
let settingsDraft = null;

function captureSettingsDraft(form) {
  settingsDraft = {};
  Array.from(form.elements).forEach(function (input) {
    if (input.name) settingsDraft[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  });
}
function restoreSettingsDraft(form) {
  if (!settingsDraft) return;
  Object.keys(settingsDraft).forEach(function (name) {
    const input = form.elements[name];
    if (!input) return;
    if (input.type === 'checkbox') input.checked = settingsDraft[name]; else input.value = settingsDraft[name];
  });
  updateSaveState('有未保存的更改');
}
function updateSaveState(text) {
  const node = $('#save-state');
  if (node) { node.textContent = text; node.classList.toggle('is-dirty', settingsDirty); }
}
window.addEventListener('beforeunload', function (event) {
  if (settingsDirty) { event.preventDefault(); event.returnValue = ''; }
});

function showLogin() {
  closeModal();
  if (document.querySelector('#access-form')) return;
  ++renderToken;
  document.body.classList.add('is-locked');
  document.title = '登录 · WansPilot';
  const accountMode = accessMode === 'password';
  const userInput = el('input', { name: 'username', id: 'access-username', autocomplete: 'username', required: true, placeholder: '输入账号', autocapitalize: 'none', spellcheck: 'false', maxlength: '128' });
  const input = el('input', { name: accountMode ? 'password' : 'token', type: 'password', autocomplete: 'current-password', required: true, placeholder: accountMode ? '输入密码' : '输入访问令牌', id: 'access-token' });
  const reveal = buttonEl({ class: 'access__reveal', 'aria-label': '显示密码', 'aria-pressed': 'false', on: { click: function (event) {
    const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    fill(event.currentTarget, iconNode('eye'));
  } } }, 'eye');
  const note = el('p', { class: 'access__error', role: 'alert' });
  const submit = buttonEl({ type: 'submit', class: 'btn btn--primary' }, null, '登录');
  const form = el('form', { id: 'access-form', class: 'access__card' }, [
    el('header', { class: 'access__brand' }, [
      el('img', { src: './logo-mark.png', width: '44', height: '44', alt: '', class: 'access__logo' }),
      el('h1', { text: 'WansPilot' }),
    ]),
    el('p', { class: 'access__intro', text: accountMode ? '登录你的账号' : '登录你的私人影视空间' }),
    el('div', { class: 'access__fields' }, [
      accountMode ? el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '账号' }), userInput]) : null,
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: accountMode ? '密码' : '访问令牌' }), el('span', { class: 'access__password' }, [input, reveal])]),
    ]), note, submit,
    accountMode ? null : el('details', { class: 'access__help' }, [el('summary', { text: '如何获取访问令牌？' }),
      el('code', { text: 'docker exec wanspilot cat /data/access-token' }),
    ]),
  ]);
  const story=el('section',{class:'access__story','aria-label':'私人影视空间'},[
    el('img',{class:'access__scene',src:'./login-scene.svg',alt:'影视海报与搜索、下载、日历图标',width:'560',height:'380',decoding:'async'}),
    el('span',{class:'access__eyebrow',text:'你的私人影院'}),
    el('h2',{text:'让好故事，接着发生'}),
    el('p',{class:'access__description',text:'发现值得看的作品，让追更、搜索和下载各就其位。'}),
    el('div',{class:'access__features'},[['film','发现影视'],['calendar','订阅追更'],['download','下载管理']].map(entry=>el('span',{},[iconNode(entry[0]),entry[1]]))),
  ]);
  form.querySelector('.access__fields label:first-child .field__label')?.prepend(iconNode(accountMode?'user':'key'));
  if(accountMode)form.querySelector('.access__fields label:last-child .field__label')?.prepend(iconNode('lock'));
  form.append(el('p',{class:'access__private'},[iconNode('lock'),el('span',{text:'你的媒体空间，由你掌控'})]));
  fill($('#view'), el('div', { class: 'access' }, [story,form]));
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); if (submit.disabled) return;
    submit.disabled = true; submit.textContent = '正在登录…'; note.textContent = '';
    try {
      await api('/auth/login', { method: 'POST', body: accountMode ? { username: userInput.value.trim(), password: input.value } : { token: input.value.trim() } });
      input.value = ''; accessReady = true; document.body.classList.remove('is-locked');
      viewStash.clear(); settingsDraft = null; settingsDirty = false;
      await startApp();
    } catch (error) { note.textContent = error.message; submit.disabled = false; submit.textContent = '登录'; }
  });
  (accountMode ? userInput : input).focus({ preventScroll: true });
}

const VIEWS = {
  sources:viewSources,
  overview:viewOverview,
  notifications:viewNotifications,
  home: viewHome,
  search: viewSearch,
  detail: viewDetail,
  resources: viewResources,
  health: viewHealth,
  tasks: viewTasks,
  subscribe: viewSubscribe,
  calendar: viewCalendar,
  settings: viewSettings
};

boot().catch(function (error) { fill($('#view'), pageEl(errorEl(error.message))); });
