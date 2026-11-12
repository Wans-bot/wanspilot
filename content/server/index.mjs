import {initIndexers,listIndexers,saveIndexer,deleteIndexer,testIndexer,flushIndexers} from './indexers.mjs';
import { selectedIds } from './subscription-rules.mjs';
import { initNotifications, listNotifications, readNotifications, flushNotifications } from './notifications.mjs';
import { auditOperation } from './audit.mjs';
/**
 * wanspilot 后端入口：HTTP 服务、路由分发、静态资源托管、SSE 推送。
 *
 * 该文件不依赖任何 Web 框架，只用 Node 内置 http 模块，减少运行时依赖与启动时间。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initAuth, authMode, authenticated, sameOrigin, login, logoutCookie } from './auth.mjs';
import { log, initLog, tail, redact } from './log.mjs';
import {
  DATA_DIR,
  CACHE_DIR,
  getSettings,
  publicSettings,
  flushSettings,
  initSettings,
  updateSettings,
  downloadDirStatus,
  resolveDownloadDir,
} from './settings.mjs';
import { clientFromSettings } from './qbittorrent.mjs';
import * as tmdb from './tmdb.mjs';
import { pruneImageCache } from './image-cache.mjs';
import { searchResources, sourcesStatus } from './sources.mjs';
import { capacityCheck, capacityStatus } from './capacity.mjs';
import { initOrganizer, organizeAll, organizerStatus } from './organizer.mjs';
import { month as calendarMonth } from './calendar.mjs';
import {
  initEngine,
  addTask,
  batchTasks,
  listTasks,
  getTask,
  pauseTask,
  resumeTask,
  removeTask,
  subscribe,
  startTicker,
  engineReady,
  shutdownEngine,
  engineStats,
  reconfigure,
} from './engine.mjs';
import {
  initSubscriptions,
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  queueCheck,
  batchSubscriptions,
  subscriptionEpisodes,
  markSubscriptionEpisodes,
  exportPayload,
  importPayload,
  startScheduler,
  promoteUpgrade,
  dismissUpgrade,
  shutdownSubscriptions,
} from './subscriptions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', 'web');
/**
 * 版本号从包内元数据解析，不写死。
 *
 * 写死会让升级后的 /api/health 继续报旧版本，评审与平台看到的版本就对不上。
 * 优先读构建时生成的 version.json（build.sh 从 package.yml 生成），
 * 其次读平台放在容器里的 package.yml，最后回退到未知。
 */
function resolveVersion() {
  if (process.env.WP_VERSION) return process.env.WP_VERSION;
  const candidates = [
    new URL('../version.json', import.meta.url),
    '/lzcapp/pkg/package.yml',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const text = String(candidate).startsWith('http')
        ? null
        : fs.readFileSync(candidate, 'utf8');
      if (!text) continue;
      const json = text.trim().startsWith('{') ? JSON.parse(text) : null;
      const version = json ? json.version : (text.match(/^version:\s*(\S+)/m) || [])[1];
      if (version) return String(version).trim();
    } catch {
      // 下一处候选
    }
  }
  return '0.0.0-unknown';
}

const VERSION = resolveVersion();
const PORT = Number.parseInt(process.env.WP_PORT || '3000', 10);
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ---------------------------------------------------------------- 工具函数 */

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'content-type': contentType, 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('请求体过大');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('请求体不是合法 JSON');
    err.statusCode = 400;
    throw err;
  }
}

/* ------------------------------------------------------------------ 静态资源 */

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const normalized = path.posix.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(WEB_DIR, normalized);

  if (!target.startsWith(WEB_DIR)) {
    sendText(res, 403, '禁止访问');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      if (path.extname(rel)) { sendText(res, 404, '资源不存在'); return; }
      // 导航路径回落到 index.html，缺失的脚本/样式明确返回 404
      const fallback = path.join(WEB_DIR, 'index.html');
      fs.readFile(fallback, (e2, buf) => {
        if (e2) {
          sendText(res, 500, '前端资源缺失，请重新安装应用');
          return;
        }
        res.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'content-length': buf.length, 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const headers = {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': ext === '.html' ? 'no-store' : ['.js', '.mjs', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
      etag: `W/"${st.size}-${Math.floor(st.mtimeMs)}"`,
    };
    if (req.headers['if-none-match'] === headers.etag) { res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] }); res.end(); return; }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
}

/* --------------------------------------------------------------------- 路由 */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  // 健康检查：不鉴权，供容器探针使用
  if (pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', version: VERSION, build: process.env.WP_BUILD_SHA || 'source' });
    return true;
  }

  if (pathname === '/api/auth/status' && method === 'GET') {
    sendJson(res, 200, { authenticated: authenticated(req), required: true, mode: authMode() });
    return true;
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!sameOrigin(req)) { sendJson(res, 403, { error: '不允许跨站登录' }); return true; }
    const body = await readBody(req, 4096);
    const result = login(req, body);
    sendJson(res, result.status, result.error ? { error: result.error } : { ok: true }, result.cookie ? { 'set-cookie': result.cookie } : {});
    return true;
  }
  if (!authenticated(req)) { sendJson(res, 401, { error: '请先登录 WansPilot', code: 'AUTH_REQUIRED' }); return true; }
  if (!['GET', 'HEAD'].includes(method) && !sameOrigin(req)) {
    sendJson(res, 403, { error: '不允许跨站修改数据' }); return true;
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    sendJson(res, 200, { ok: true }, { 'set-cookie': logoutCookie() }); return true;
  }

  if(pathname==='/api/indexers' && method==='GET'){sendJson(res,200,listIndexers());return true;}
  if(pathname==='/api/indexers' && method==='POST'){sendJson(res,201,saveIndexer(await readBody(req,16384)));return true;}
  if(seg[1]==='indexers' && seg[2]){
    const id=seg[2];
    if(seg.length===3 && method==='PATCH'){sendJson(res,200,saveIndexer(await readBody(req,16384),id));return true;}
    if(seg.length===3 && method==='DELETE'){const removed=deleteIndexer(id);sendJson(res,removed?200:404,removed?{ok:true}:{error:'资源渠道不存在'});return true;}
    if(seg.length===4 && seg[3]==='test' && method==='POST'){sendJson(res,200,await testIndexer(id));return true;}
  }
  if(pathname==='/api/notifications' && method==='GET'){listSubscriptions();const data=listNotifications();sendJson(res,200,url.searchParams.has('summary')?{unread:data.unread}:data);return true;}
  if(pathname==='/api/notifications/read' && method==='POST'){
    const body=await readBody(req);sendJson(res,200,readNotifications(body.ids===undefined?null:selectedIds(body.ids)));return true;
  }
  if(pathname==='/api/overview' && method==='GET'){
    const subscriptions=listSubscriptions().items,tasks=listTasks(),settings=getSettings();
    sendJson(res,200,{at:new Date().toISOString(),version:VERSION,
      subscriptions:{total:subscriptions.length,enabled:subscriptions.filter(item=>item.enabled).length,checking:subscriptions.filter(item=>item.isChecking).length,errors:subscriptions.filter(item=>item.state==='error').length,
        downloadedEpisodes:subscriptions.filter(item=>item.type!=='movie').reduce((sum,item)=>sum+item.downloadedKeys.length,0),pendingEpisodes:subscriptions.filter(item=>item.type!=='movie').reduce((sum,item)=>sum+item.pendingKeys.length,0)},
      queue:subscriptions.filter(item=>item.enabled).sort((a,b)=>String(a.nextCheckAt || '').localeCompare(String(b.nextCheckAt || ''))).slice(0,12),
      tasks:tasks.stats,capacity:capacityStatus(),engine:{ready:engineStats().ready,tasks:engineStats().tasks,lastError:redact(engineStats().lastError || '')},organizer:organizerStatus(),
      readiness:{tmdbKeySet:Boolean(settings.tmdbApiKey),qbConfigured:Boolean(settings.qbUrl),autoDownload:settings.autoDownload!==false,checkIntervalMinutes:settings.checkIntervalMinutes},
      notifications:listNotifications().items.slice(0,8),unread:listNotifications().unread});return true;
  }

  if (pathname === '/api/system') {
    const freeBytes = capacityStatus().freeBytes;
    const dirStatus = downloadDirStatus();
    sendJson(res, 200, {
      version: VERSION,
      nodeVersion: process.version,
      dataDir: DATA_DIR,
      downloadDir: dirStatus.dir,
      downloadDirRelative: getSettings().downloadDir,
      downloadDirWritable: dirStatus.ok,
      freeBytes,
      uptimeSeconds: Math.round(process.uptime()),
      engineReady: engineReady(),
    });
    return true;
  }

  if (pathname === '/api/logs') {
    const lines = url.searchParams.get('lines') || '200';
    sendText(res, 200, tail(Number.parseInt(lines, 10) || 200));
    return true;
  }

  if (pathname === '/api/image') {
    const result = await tmdb.fetchImage(url.searchParams.get('path'), url.searchParams.get('size') || 'w342');
    res.writeHead(200, {
      'content-type': result.contentType,
      'content-length': result.body.length,
      'cache-control': 'public, max-age=604800',
    });
    res.end(method === 'HEAD' ? undefined : result.body);
    return true;
  }

/* ---- 整理与日历 ---- */
  if (pathname === '/api/organizer/status' && method === 'GET') {
    sendJson(res, 200, organizerStatus());
    return true;
  }
  if (pathname === '/api/organizer/preview' && method === 'GET') {
    sendJson(res, 200, await organizeAll({ dryRun: true })); return true;
  }
  if (pathname === '/api/organizer/run' && method === 'POST') {
    sendJson(res, 200, await organizeAll());
    return true;
  }
  if (pathname === '/api/calendar' && method === 'GET') {
    sendJson(res, 200, await calendarMonth(url.searchParams.get('month') || ''));
    return true;
  }

  /* ---- 健康度看板 ---- */
  if (pathname === '/api/health/report' && method === 'GET') {
    const sources = await sourcesStatus().catch(() => []);
    const tmdbState = await tmdb.tmdbStatus().catch((error) => ({
      tmdbOk: false,
      tmdbMessage: error.message,
      tmdbKeySet: false,
      tmdbImageOk: false,
    }));
    const cap = capacityStatus();
    const tasksSnapshot = listTasks();
    sendJson(res, 200, {
      tmdb: {
        ok: Boolean(tmdbState.tmdbOk),
        keySet: Boolean(tmdbState.tmdbKeySet),
        message: tmdbState.tmdbMessage || '',
        imageOk: Boolean(tmdbState.tmdbImageOk),
        imageMessage: tmdbState.tmdbImageMessage || '',
      },
      sources,
      capacity: cap,
      tasks: tasksSnapshot.stats || { active: 0, completed: 0, totalSizeBytes: 0 },
      at: new Date().toISOString(),
    });
    return true;
  }
  if (pathname === '/api/capacity' && method === 'GET') {
    sendJson(res, 200, capacityStatus());
    return true;
  }

  /* ---- 设置 ---- */
  if (pathname === '/api/settings') {
    if (method === 'GET') {
      sendJson(res, 200, publicSettings());
      return true;
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      const saved = updateSettings(body);
      log.info('[settings] 已保存配置字段：'+Object.keys(body).filter(key=>Object.hasOwn(saved,key)).join('、'));
      try {
        reconfigure();
      } catch (err) {
        log.warn(`[app] 下载引擎重载失败: ${err.message}`);
      }
      sendJson(res, 200, publicSettings());
      return true;
    }
  }

  if (pathname === '/api/settings/status' && method === 'GET') {
    const [tmdbStatus, sourceStatus] = await Promise.all([tmdb.tmdbStatus(), sourcesStatus()]);
    const dirStatus = downloadDirStatus();
    sendJson(res, 200, {
      ...tmdbStatus,
      downloadDirOk: dirStatus.ok,
      downloadDirMessage: dirStatus.message,
      engineReady: engineReady(),
      sources: sourceStatus,
      qbUrl: getSettings().qbUrl || '',
    });
    return true;
  }

  if (pathname === '/api/settings/test' && method === 'POST') {
    const body = await readBody(req);
    if (body.kind === 'qb') {
      // 传了地址就用页面上的值试连，否则用已保存的设置
      const probe = Object.hasOwn(body, 'qbUrl')
        ? {
            ...getSettings(),
            qbUrl: body.qbUrl,
            qbUsername: body.qbUsername ?? '',
            qbPassword: body.qbPassword ?? getSettings().qbPassword,
          }
        : getSettings();
      try {
        const client = clientFromSettings(probe);
        if (!client) {
          req.operationResult='qB 连接测试失败：尚未配置地址';
          sendJson(res, 200, {
            ok: false,
            message: '还没有填写 qBittorrent 地址：请填 http://<NAS 局域网 IP>:<qB 端口>，不要用 127.0.0.1 / localhost',
            version: '',
            apiVersion: '',
          });
          return true;
        }
        const info = await client.probe();
        const version = info.version || '';
        req.operationResult='qB 连接测试通过 '+version;
        sendJson(res, 200, {
          ok: true,
          message: (version ? `已连上 qBittorrent ${version}` : '已连上 qBittorrent') + (info.warnings?.length ? '；' + info.warnings.join('；') : ''),
          apiMode: info.apiMode, warnings: info.warnings,
          version,
          apiVersion: info.apiVersion || '',
        });
      } catch (err) {
        req.operationResult='qB 连接测试失败：'+err.message;
        sendJson(res, 200, { ok: false, message: err.message, version: '', apiVersion: '' });
      }
      return true;
    }
    if (body.kind === 'source') {
      const all = await sourcesStatus(body.id);
      req.operationResult='索引源测试：'+all.filter(source=>source.ok).length+'/'+all.length+' 通过';
      sendJson(res, 200, { sources: all, downloadDirOk: downloadDirStatus().ok, engineReady: engineReady() });
      return true;
    }
    const current = getSettings();
    const probe = { ...current };
    for (const key of ['tmdbApiKey', 'tmdbApiBase', 'tmdbImageBase', 'proxy']) {
      if (typeof body[key] === 'string') probe[key] = body[key].trim();
    }
    const tmdbStatus = await tmdb.tmdbStatus(probe);
    req.operationResult='TMDB '+(tmdbStatus.tmdbOk?'通过':'失败')+'，图片源 '+(tmdbStatus.tmdbImageOk?'通过':'失败');
    sendJson(res, 200, { ...tmdbStatus, testedDraft: true });
    return true;
  }

  /* ---- TMDB ---- */
  if (pathname === '/api/tmdb/home' && method === 'GET') {
    sendJson(res, 200, await tmdb.getHome());
    return true;
  }
  if (pathname === '/api/tmdb/browse' && method === 'GET') {
    sendJson(res, 200, await tmdb.browse({
      type: url.searchParams.get('type') || 'movie',
      category: url.searchParams.get('category') || 'popular',
      page: url.searchParams.get('page') || '1',
    }));
    return true;
  }
  if (pathname === '/api/tmdb/discover' && method === 'GET') {
    sendJson(res, 200, await tmdb.discover({
      type: url.searchParams.get('type') || 'movie',
      genre: url.searchParams.get('genre') || '',
      language: url.searchParams.get('language') || '',
      yearFrom: url.searchParams.get('yearFrom') || '',
      yearTo: url.searchParams.get('yearTo') || '',
      minRating: url.searchParams.get('minRating') || '',
      sort: url.searchParams.get('sort') || 'popularity',
      keyword: url.searchParams.get('keyword') || '',
      page: url.searchParams.get('page') || '1',
    }));
    return true;
  }
  if (pathname === '/api/tmdb/genres' && method === 'GET') {
    sendJson(res, 200, { genres: await tmdb.genres(url.searchParams.get('type') || 'movie') });
    return true;
  }
  if (pathname === '/api/tmdb/languages' && method === 'GET') {
    sendJson(res, 200, { languages: tmdb.languages() });
    return true;
  }
  if (pathname === '/api/tmdb/search' && method === 'GET') {
    sendJson(res, 200, await tmdb.search({
      q: url.searchParams.get('q') || '',
      type: url.searchParams.get('type') || 'multi',
      page: url.searchParams.get('page') || '1',
    }));
    return true;
  }
  if (pathname === '/api/tmdb/detail' && method === 'GET') {
    sendJson(res, 200, await tmdb.detail({
      type: url.searchParams.get('type') || 'movie',
      id: url.searchParams.get('id'),
    }));
    return true;
  }
  if (pathname === '/api/tmdb/season' && method === 'GET') {
    sendJson(res, 200, await tmdb.season({
      id: url.searchParams.get('id'),
      season: url.searchParams.get('season') || '1',
    }));
    return true;
  }

  /* ---- 资源搜索 ---- */
  if (pathname === '/api/resources' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const seasonRaw = url.searchParams.get('season');
    const episodeRaw = url.searchParams.get('episode');
    sendJson(res, 200, await searchResources({
      q,
      type: url.searchParams.get('type') || 'movie',
      season: seasonRaw ? Number.parseInt(seasonRaw, 10) : undefined,
      episode: episodeRaw ? Number.parseInt(episodeRaw, 10) : undefined,
      year: url.searchParams.get('year') || '',
    }));
    return true;
  }

  /* ---- 任务 ---- */
  if(pathname==='/api/tasks/batch' && method==='POST'){sendJson(res,200,await batchTasks(await readBody(req)));return true;}
  if (pathname === '/api/tasks' && method === 'GET') {
    const tasks = listTasks();
    const scoped = tasks.items || [];
    sendJson(res, 200, { items: scoped, stats: tasks.stats });
    return true;
  }
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    const stats = (listTasks().stats) || {};
    const cap = capacityCheck(Number(body.sizeBytes) || 0, Number(stats.totalSizeBytes) || 0, Number(stats.remainingBytes) || 0);
    // 体积要等拿到元数据才知道，这里只挡住「连 1 GB 都没有」的情况
    if (!cap.ok || (cap.freeBytes >= 0 && cap.freeBytes < 1024 ** 3)) {
      sendJson(res, 413, { error: cap.message });
      return true;
    }
    const task = await addTask(body, String(getSettings().qbSavePath || ''));
    sendJson(res, 201, { task });
    return true;
  }
  if (pathname === '/api/tasks/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // 连接已断开
      }
    };
    send(listTasks());
    const unsubscribe = subscribe(send);
    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    return true;
  }

  if (seg[1] === 'tasks' && seg[2] && seg.length >= 3) {
    const id = decodeURIComponent(seg[2]);
    const action = seg[3];
    if (!action && method === 'GET') {
      const task = getTask(id);
      if (!task) {
        sendJson(res, 404, { error: '任务不存在' });
        return true;
      }
      sendJson(res, 200, { task });
      return true;
    }
    if (!action && method === 'DELETE') {
      const deleteFiles = url.searchParams.get('deleteFiles') === '1';
      const ok = await removeTask(id, deleteFiles);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '任务不存在' });
      return true;
    }
    if (action === 'pause' && method === 'POST') {
      const task = await pauseTask(id);
      sendJson(res, task ? 200 : 404, task ? { task } : { error: '任务不存在' });
      return true;
    }
    if (action === 'resume' && method === 'POST') {
      const task = await resumeTask(id);
      sendJson(res, task ? 200 : 404, task ? { task } : { error: '任务不存在' });
      return true;
    }
  }

  /* ---- 订阅 ---- */
  if(pathname==='/api/subscriptions/batch' && method==='POST'){sendJson(res,200,batchSubscriptions(await readBody(req)));return true;}
  if (pathname === '/api/subscriptions' && method === 'GET') {
    sendJson(res, 200, listSubscriptions());
    return true;
  }
  if (pathname === '/api/subscriptions' && method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 201, createSubscription(body || {}));
    return true;
  }
  if (pathname.startsWith('/api/subscriptions/') && pathname.endsWith('/upgrade') && method === 'POST') {
    const id = decodeURIComponent(pathname.slice('/api/subscriptions/'.length, -'/upgrade'.length));
    sendJson(res, 200, await promoteUpgrade(id));
    return true;
  }
  if (pathname.startsWith('/api/subscriptions/') && pathname.endsWith('/upgrade') && method === 'DELETE') {
    const id = decodeURIComponent(pathname.slice('/api/subscriptions/'.length, -'/upgrade'.length));
    sendJson(res, 200, dismissUpgrade(id));
    return true;
  }
  if (pathname === '/api/subscriptions/export' && method === 'GET') {
    const payload = exportPayload();
    const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
      'content-disposition': 'attachment; filename="wanspilot-subscriptions.json"; filename*=UTF-8\'\'wanspilot-%E8%AE%A2%E9%98%85.json',
      'cache-control': 'no-store',
    });
    res.end(body);
    return true;
  }
  if (pathname === '/api/subscriptions/import' && method === 'POST') {
    const body = await readBody(req);
    let payload = body;
    if (typeof body.json === 'string') {
      try {
        payload = JSON.parse(body.json);
      } catch {
        const err = new Error('导入内容不是合法 JSON');
        err.statusCode = 400;
        throw err;
      }
    }
    sendJson(res, 200, importPayload(payload));
    return true;
  }
  if (seg[1] === 'subscriptions' && seg[2]) {
    const id = decodeURIComponent(seg[2]);
    const action = seg[3];
    if(action==='episodes' && method==='GET'){const result=await subscriptionEpisodes(id,url.searchParams.get('season'));sendJson(res,result?200:404,result || {error:'订阅不存在'});return true;}
    if(action==='episodes' && method==='PATCH'){const result=await markSubscriptionEpisodes(id,await readBody(req));sendJson(res,result?200:404,result || {error:'订阅不存在'});return true;}
    if (action === 'check' && method === 'POST') {
      const result = queueCheck(id);
      sendJson(res, result ? 202 : 404, result || { error: '订阅不存在' });
      return true;
    }
    if (!action && method === 'PATCH') {
      const body = await readBody(req);
      const result = updateSubscription(id, body);
      sendJson(res, result ? 200 : 404, result || { error: '订阅不存在' });
      return true;
    }
    if (!action && method === 'DELETE') {
      const ok = deleteSubscription(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '订阅不存在' });
      return true;
    }
  }

  sendJson(res, 404, { error: `未知接口 ${method} ${pathname}` });
  return true;
}

/* --------------------------------------------------------------------- 启动 */

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    sendText(res, 400, '请求地址不合法');
    return;
  }

  if (url.pathname.startsWith('/api/')) auditOperation(req,res,url);
  const run = async () => {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, '方法不允许');
      return;
    }
    serveStatic(req, res, url.pathname);
  };

  run().catch((err) => {
    const status = err.statusCode || 500;
    if (status >= 500) log.error(`[http] ${req.method} ${url.pathname} 失败: ${err.message}`);
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, { error: err.message || '服务器内部错误' });
  });
});

function shutdown(signal) {
  log.info(`[app] 收到 ${signal}，正在退出`);
  try {
    flushSettings();
    shutdownSubscriptions();
    flushNotifications();
    flushIndexers();
    shutdownEngine();
  } catch (err) {
    log.warn(`[app] 关闭下载引擎出错: ${err.message}`);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

function main() {
  initLog(DATA_DIR);
  initNotifications(DATA_DIR);
  initAuth(DATA_DIR);
  const cleanCache = () => pruneImageCache(CACHE_DIR).catch(err => log.warn(`[cache] 清理失败：${err.message}`));
  setTimeout(cleanCache, 30_000).unref();
  setInterval(cleanCache, 30 * 60_000).unref();
  log.info('[auth] 已启用访问保护，登录方式：' + (authMode() === 'password' ? '账号密码' : '访问令牌'));
  const settings = initSettings();
  initIndexers(DATA_DIR);
  try {
    initEngine(DATA_DIR);
    startTicker();
  } catch (err) {
    log.error(`[app] 下载引擎初始化失败: ${err.message}`);
  }
  try {
    initSubscriptions(DATA_DIR);
    initOrganizer();
    startScheduler();
  } catch (err) {
    log.error(`[app] 订阅模块初始化失败: ${err.message}`);
  }

  // 绑定 0.0.0.0：平台网关（lzcinit）是另一个容器，经应用的私有 docker 网络回源，
  // 只绑回环会让路由与平台健康检查都连不上（实测 Connection refused）。
  // 该端口只存在于本应用的私有网络，外部入口仍由平台鉴权后转发。
  server.listen(PORT, '0.0.0.0', () => {
    log.info(`[app] wanspilot ${VERSION} 已启动，监听 0.0.0.0:${PORT}`);
    const dir = resolveDownloadDir(settings);
    if (String(settings.qbUrl || '').trim()) {
      log.info(`[app] 下载交给 qBittorrent ${settings.qbUrl}，本地可读目录 ${dir || '未挂载（自动整理不可用）'}`);
    } else {
      log.info(`[app] 数据目录 ${DATA_DIR}，下载目录 ${dir}`);
      log.info('[app] 尚未配置 qBittorrent 地址，去设置页填写后才能下载');
    }
    if (!settings.tmdbApiKey) log.info('[app] 尚未配置 TMDB API Key，影视墙与搜索需要先到设置页填写');
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on('error', (err) => {
    log.error(`[app] 监听失败: ${err.message}`);
    process.exit(1);
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error(`[app] 未处理的 Promise 拒绝: ${reason?.message || reason}`);
  });
}

main();
