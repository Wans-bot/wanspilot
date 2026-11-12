/**
 * qBittorrent Web API v2 / legacy API 客户端。
 *
 * wanspilot 自己不下载，只把任务交给用户已有的 qBittorrent：
 * - 磁力 / 种子走 v2 add 或旧版 command/download|upload
 * - 任务状态从 GET /api/v2/torrents/info 读，文件清单从 /api/v2/torrents/files 读
 * - 暂停 / 继续 / 删除对应 torrents/pause|resume|delete，5.x 的 stop|start 也兜住；旧接口先进行只读能力探测
 *
 * 认证：qB 默认要登录。POST /api/v2/auth/login 成功会下发会话 Cookie
 * （兼容 SID 和 QBT_SID_<端口>），后续请求原样带回。
 * 后续请求带这个 cookie。用户名留空表示「免认证直连」——qB 开了
 * 「对本地主机跳过认证」或局域网白名单时可以不登录；真被拒时错误信息会提示去补账号。
 *
 * 这里只做协议转换，不缓存状态：状态缓存放在 engine.mjs，那份要兼顾前端同步读。
 */
import { log } from './log.mjs';

const TIMEOUT_MS = Number.parseInt(process.env.WP_QB_TIMEOUT_MS || '15000', 10);

export class QBError extends Error {
  /**
   * @param {string} message 面向用户的中文说明
   * @param {{statusCode?: number, kind?: string}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'QBError';
    /** 用 502：上游不可达不是调用方的错，但也不能伪装成成功 */
    this.statusCode = options.statusCode ?? 502;
    this.kind = options.kind || 'api';
  }
}

/**
 * 地址里出现回环主机名/地址就判定为「填错了」。
 * 容器内的 127.0.0.1 指向 wanspilot 自己，永远连不到 NAS 上的 qB。
 */
export function isLoopbackUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return false;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '0.0.0.0' || host === '::1' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * 去掉末尾斜杠与多余空白，缺 scheme 时补 http://；
 * 回环地址直接拒绝并给出可执行的提示，避免用户以为「地址填了却连不上」。
 */
export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  if (!/^https?:\/\/[^/\s]+/i.test(withScheme)) {
    throw new QBError(`qBittorrent 地址应形如 http://192.168.1.10:8080，当前是「${raw}」`, {
      statusCode: 400,
      kind: 'config',
    });
  }
  if (isLoopbackUrl(withScheme)) {
    throw new QBError(
      'qBittorrent 地址不能填 127.0.0.1 / localhost：容器里的回环地址指向 wanspilot 自己。请填 NAS 的局域网 IP + qB WebUI 端口，例如 http://192.168.1.10:端口号',
      { statusCode: 400, kind: 'config' },
    );
  }
  return withScheme;
}

export class QBClient {
  /** 登录后的会话 Cookie，直接带名字（qB 4.x 是 SID，5.x 是 QBT_SID_<端口>）。 */
  #cookie = '';

  #loginPromise = null;
  #apiMode = '';
  #apiPromise = null;
  #version = '';
  #legacyApiVersion = null;
  #togglePaths = new Map();


  /**
   * @param {{url?: string, username?: string, password?: string}} config
   */
  constructor(config = {}) {
    this.baseUrl = normalizeBaseUrl(config.url);
    this.username = String(config.username || '').trim();
    this.password = String(config.password || '');
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  get hasCredentials() {
    return Boolean(this.username);
  }

  /** 设置页与自检用来区分「免认证直连」和「账号登录」。 */
  get authMode() {
    return this.hasCredentials ? 'password' : 'anonymous';
  }

  get apiMode() { return this.#apiMode; }

  get safeBaseUrl() {
    return this.baseUrl;
  }

  /** 单次请求：带会话 Cookie、超时、403 时重登一次。 */
  async #send(path, { method = 'GET', query, form, formData, headers = {}, body } = {}) {
    if (!this.configured) {
      throw new QBError('还没有配置 qBittorrent 地址，请到设置页填写', { statusCode: 400, kind: 'config' });
    }
    let url;
    try {
      url = new URL(`${this.baseUrl}${path}`);
    } catch {
      throw new QBError(`qBittorrent 地址不合法：${this.baseUrl}`, { statusCode: 400, kind: 'config' });
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }

    const init = { method, redirect: 'error', headers: { Origin: url.origin, Referer: this.baseUrl + '/', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (this.#cookie) init.headers.Cookie = this.#cookie;
    if (formData) {
      // 交给 fetch 自己算 boundary，不要手写 content-type
      init.body = formData;
    } else if (form) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      init.body = body;
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? `超时（${TIMEOUT_MS} ms）` : (err?.message || String(err));
      throw new QBError(
        `连不上 qBittorrent（${this.baseUrl}）：${reason}。请确认地址是 NAS 的局域网 IP + qB WebUI 端口，`
        + '且该端口从容器里可访问（qB 的 WebUI 需监听 0.0.0.0，不能只绑 127.0.0.1）。',
        { kind: 'network' },
      );
    }

    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const cookie of setCookies) {
      // 4.x 下发 SID=…，5.x 下发 QBT_SID_<端口>=…，名字必须原样带回去。
      const match = /(?:^|;\s*)((?:QBT_)?SID[^=;\s]*)=([^;]+)/i.exec(cookie);
      if (match) this.#cookie = `${match[1]}=${match[2]}`;
    }

    const text = await res.text();
    const forbidden = res.status === 401 || res.status === 403 || /^\s*Forbidden\s*$/i.test(text);
    return { res, text, forbidden };
  }

  /** 登录拿会话 Cookie；并发调用合并成一次。 */
  async #login() {
    if (this.#loginPromise) return this.#loginPromise;
    if (!this.hasCredentials) {
      throw new QBError('qBittorrent 拒绝了未认证请求。请在设置页填写 qB 的用户名与密码（或在 qB 里开启「对本地主机跳过认证」）。', {
        statusCode: 401,
        kind: 'auth',
      });
    }
    this.#loginPromise = (async () => {
      this.#cookie = '';
      const { res, text } = await this.#send(this.#apiMode === 'legacy' ? '/login' : '/api/v2/auth/login', {
        method: 'POST',
        form: { username: this.username, password: this.password },
      });
      if ([404, 405, 501].includes(res.status)) throw new QBError('当前 qBittorrent 不提供这个认证接口', { statusCode: res.status, kind: 'unsupported' });
      // 兼容 200 + "Ok." 和 204 空响应，以及 SID / QBT_SID_<端口>；
      // 失败都是 200 + "Fails."。以「拿到 Cookie 且不是 Fails」为准。
      if (!this.#cookie || /^\s*Fails\.?\s*$/i.test(text) || res.status >= 400) {
        this.#cookie = '';
        throw new QBError('qBittorrent 登录失败：用户名或密码不对，请到设置页检查', {
          statusCode: 401,
          kind: 'auth',
        });
      }
      log.info(`[qb] 登录成功 ${this.baseUrl}（${this.username}）`);
      return this.#cookie;
    })().finally(() => {
      this.#loginPromise = null;
    });
    return this.#loginPromise;
  }

  /** 需要认证的通用请求。免认证模式先直接打，被拒再登录（没有账号就给可执行提示）。 */
  async #authed(path, options = {}) {
    const first = await this.#send(path, options);
    if (!first.forbidden) return first;
    if (!this.hasCredentials) await this.#login(); // 这里会抛出带指引的错误
    else await this.#login();
    const second = await this.#send(path, options);
    if (second.forbidden) {
      throw new QBError('qBittorrent 拒绝访问：账号已登录但仍无权限，请检查该用户是否被限制 WebUI 访问', {
        statusCode: 403,
        kind: 'auth',
      });
    }
    return second;
  }

  async #json(path, options) {
    const { res, text } = await this.#authed(path, options);
    if (res.status >= 400) {
      throw new QBError(`qBittorrent 返回 ${res.status}：${text.slice(0, 200) || '无响应内容'}`, { statusCode: res.status });
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new QBError(`qBittorrent 返回了非 JSON 内容：${text.slice(0, 120)}`, { kind: 'protocol' });
    }
  }

  async #text(path, options) {
    const { res, text } = await this.#authed(path, options);
    if (res.status >= 400) {
      throw new QBError(`qBittorrent 返回 ${res.status}：${text.slice(0, 200) || '无响应内容'}`, { statusCode: res.status });
    }
    return text.trim();
  }

  /** Detect with read-only requests, never retry add/delete to guess API versions. */
  async #ensureApi() {
    if (this.#apiMode && this.#version) return;
    if (this.#apiPromise) return this.#apiPromise;
    const validVersion = value => /^v?\d+\.\d+(?:\.\d+)?[^\s<>]*$/.test(value);
    this.#apiPromise = (async () => {
      try {
        this.#apiMode = 'v2';
        const version = await this.#text('/api/v2/app/version');
        if (!validVersion(version)) throw new QBError('版本接口返回的不是 qBittorrent 版本', { kind: 'protocol' });
        this.#version = version;
      } catch (error) {
        if (![404, 405, 501].includes(error.statusCode) && error.kind !== 'protocol') { this.#apiMode = ''; throw error; }
        this.#cookie = ''; this.#apiMode = 'legacy';
        try {
          const version = await this.#text('/version/qbittorrent');
          if (!validVersion(version)) throw new QBError('无法识别 qBittorrent Web API，请检查地址是否指向 WebUI', { kind: 'protocol' });
          const apiVersion = await this.#text('/version/api');
          if (!/^\d+$/.test(apiVersion)) throw new QBError('无法识别旧版 qBittorrent API 版本', { kind: 'protocol' });
          this.#legacyApiVersion = Number(apiVersion); this.#version = version;
        } catch (legacyError) { this.#apiMode = ''; throw legacyError; }
      }
    })().finally(() => { this.#apiPromise = null; });
    return this.#apiPromise;
  }

  async appVersion() { await this.#ensureApi(); return this.#version; }

  /** server_state.free_space_on_disk 是 qB 所在磁盘的真实剩余空间。 */
  async mainData() {
    await this.#ensureApi();
    return this.#json(this.#apiMode === 'legacy' ? '/sync/maindata' : '/api/v2/sync/maindata');
  }

  async freeSpace() {
    try {
      const data = await this.mainData();
      const raw = data?.server_state?.free_space_on_disk;
      const value = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch (err) {
      log.warn(`[qb] 读取剩余空间失败：${err.message}`);
      return null;
    }
  }

  /** hashes 为空表示全部任务，否则用 | 连接。 */
  async torrentsInfo(hashes) {
    await this.#ensureApi();
    const list = Array.isArray(hashes) ? hashes.filter(Boolean) : [];
    const data = await this.#json(this.#apiMode === 'legacy' ? '/query/torrents' : '/api/v2/torrents/info', { query: { hashes: list.join('|') || undefined } });
    if (!Array.isArray(data)) throw new QBError('qBittorrent 任务列表格式不正确，请检查 WebUI 地址', { kind: 'protocol' });
    return data.map(item => ({ ...item, downloaded: item.downloaded ?? Math.round((Number(item.size) || 0) * (Number(item.progress) || 0)) }));
  }

  async torrentsFiles(hash) {
    await this.#ensureApi();
    const data = await this.#json(this.#apiMode === 'legacy' ? '/query/propertiesFiles/' + encodeURIComponent(hash) : '/api/v2/torrents/files',
      this.#apiMode === 'legacy' ? undefined : { query: { hash } });
    if (data === null) return [];
    if (!Array.isArray(data)) throw new QBError('qBittorrent 文件清单格式不正确', { kind: 'protocol' });
    return data;
  }

  /**
   * 添加任务。
   * @param {{magnet?: string, torrent?: Buffer, savePath?: string, category?: string, paused?: boolean}} input
   */
  async addTorrent(input) {
    await this.#ensureApi();
    const legacy = this.#apiMode === 'legacy';
    if (legacy && this.#legacyApiVersion < 13 && input.paused) throw new QBError('此旧版 qBittorrent API 不支持暂停添加，请升级 qBittorrent', { statusCode: 400, kind: 'unsupported' });
    const form = new FormData();
    if (input.magnet) form.set('urls', input.magnet);
    if (input.torrent) {
      form.set('torrents', new Blob([input.torrent], { type: 'application/x-bittorrent' }), 'wanspilot.torrent');
    }
    if (input.savePath) form.set('savepath', input.savePath);
    if (input.category) form.set('category', input.category);
    if (input.paused !== undefined) {
      // 5.x renamed paused to stopped; both flags are harmless to older APIs.
      form.set('paused', String(Boolean(input.paused)));
      form.set('stopped', String(Boolean(input.paused)));
    }
    let options = { method: 'POST', formData: form };
    if (legacy && this.#legacyApiVersion < 7 && input.magnet) {
      if (input.savePath || input.category || input.paused) throw new QBError('此旧版 qBittorrent API 不支持指定保存目录、分类或暂停添加，请升级 qBittorrent', { statusCode: 400, kind: 'unsupported' });
      options = { method: 'POST', form: { urls: input.magnet } };
    }
    const endpoint = legacy ? (input.torrent ? '/command/upload' : '/command/download') : '/api/v2/torrents/add';
    const text = await this.#text(endpoint, options);
    // 4.x 成功返回空或 "Ok."，种子无效返回 "Fails."
    if (/^Fails\.?$/i.test(text)) {
      throw new QBError('qBittorrent 拒绝了这个任务：种子或磁力链接无效', { statusCode: 400, kind: 'input' });
    }
    return true;
  }

  /** Missing endpoints alone trigger fallback; auth, input and server failures do not. */
  async #toggle(action, hashes) {
    await this.#ensureApi();
    const values = Array.isArray(hashes) ? hashes : String(hashes || '').split('|');
    if (this.#apiMode === 'legacy') {
      if (values.length === 1 && values[0] === 'all') return this.#text('/command/' + (action === 'stop' ? 'pauseAll' : 'resumeAll'), { method: 'POST' });
      for (const hash of values.filter(Boolean)) await this.#text('/command/' + (action === 'stop' ? 'pause' : 'resume'), { method: 'POST', form: { hash } });
      return '';
    }
    const modern = action === 'stop' ? 'stop' : 'start';
    const older = action === 'stop' ? 'pause' : 'resume';
    const major = Number(this.#version.replace(/^v/, '').split('.')[0]);
    const first = this.#togglePaths.get(action) || (major >= 5 ? modern : older);
    const other = first === modern ? older : modern;
    const options = { method: 'POST', form: { hashes: values.join('|') } };
    try {
      const result = await this.#text('/api/v2/torrents/' + first, options);
      this.#togglePaths.set(action, first); return result;
    } catch (error) {
      if (![404, 405, 501].includes(error.statusCode)) throw error;
      const result = await this.#text('/api/v2/torrents/' + other, options);
      this.#togglePaths.set(action, other); return result;
    }
  }

  async pause(hashes) {
    return this.#toggle('stop', hashes);
  }

  async resume(hashes) {
    return this.#toggle('start', hashes);
  }

  async deleteTorrents(hashes, deleteFiles = false) {
    await this.#ensureApi();
    const joined = Array.isArray(hashes) ? hashes.join('|') : String(hashes || '');
    return this.#text(this.#apiMode === 'legacy' ? (deleteFiles ? '/command/deletePerm' : '/command/delete') : '/api/v2/torrents/delete', {
      method: 'POST',
      form: { hashes: joined, deleteFiles: deleteFiles ? 'true' : 'false' },
    });
  }

  /** 设置页「测试连接」：一次调用拿版本、认证方式与剩余空间。 */
  async probe() {
    const startedAt = Date.now();
    const version = await this.appVersion();
    await this.torrentsInfo(); // Core access must work even if optional disk statistics do not exist.
    let apiVersion = '', data = null;
    const warnings = [];
    if (this.#apiMode === 'legacy') apiVersion = String(this.#legacyApiVersion);
    else {
      try { apiVersion = await this.#text('/api/v2/app/webapiVersion'); }
      catch (error) { if (![404,405,501].includes(error.statusCode)) throw error; warnings.push('未提供 Web API 版本号'); }
    }
    try { data = await this.mainData(); } catch (error) {
      if (![404,405,501].includes(error.statusCode)) throw error;
      warnings.push('此版本不提供磁盘统计，剩余空间显示为未知');
    }
    const rawFree = data?.server_state?.free_space_on_disk;
    const freeBytes = rawFree === undefined || rawFree === null || rawFree === '' ? null : Number(rawFree);
    return { ok: true, version, apiVersion, apiMode: this.#apiMode, warnings,
      latencyMs: Date.now() - startedAt, authMode: this.authMode,
      freeBytes: Number.isFinite(freeBytes) && freeBytes >= 0 ? freeBytes : null,
      savePath: data?.server_state?.save_path || '',
    };
  }
}

/** 用当前设置构造客户端；设置里没填地址时返回 null。 */
export function clientFromSettings(settings) {
  const url = String(settings?.qbUrl || '').trim();
  if (!url) return null;
  return new QBClient({
    url,
    username: settings?.qbUsername,
    password: settings?.qbPassword,
  });
}
