/**
 * qBittorrent Web API v2 客户端。
 *
 * wanspilot 自己不下载，只把任务交给用户已有的 qBittorrent：
 * - 磁力 / 种子统一走 POST /api/v2/torrents/add
 * - 任务状态从 GET /api/v2/torrents/info 读，文件清单从 /api/v2/torrents/files 读
 * - 暂停 / 继续 / 删除对应 torrents/pause|resume|delete，5.0 的 stop|start 也兜住
 *
 * 认证：qB 默认要登录。POST /api/v2/auth/login 成功会返回 Set-Cookie: SID=…，
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

/** 去掉末尾斜杠与多余空白；不是 http(s) 就抛错，避免把 file:// 之类塞进 fetch。 */
export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\/[^/\s]+/i.test(value)) {
    throw new QBError(`qBittorrent 地址应形如 http://192.168.1.10:8080，当前是「${raw}」`, {
      statusCode: 400,
      kind: 'config',
    });
  }
  return value;
}

export class QBClient {
  #sid = '';

  #loginPromise = null;


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

  get safeBaseUrl() {
    return this.baseUrl;
  }

  /** 单次请求：带 SID、超时、403 时重登一次。 */
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

    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (this.#sid) init.headers.Cookie = `SID=${this.#sid}`;
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
      throw new QBError(`连不上 qBittorrent（${this.baseUrl}）：${reason}`, { kind: 'network' });
    }

    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const cookie of setCookies) {
      const match = /(?:^|;\s*)SID=([^;]+)/.exec(cookie);
      if (match) this.#sid = match[1];
    }

    const text = await res.text();
    const forbidden = res.status === 403 || /^\s*Forbidden\s*$/i.test(text);
    return { res, text, forbidden };
  }

  /** 登录拿 SID；并发调用合并成一次。 */
  async #login() {
    if (this.#loginPromise) return this.#loginPromise;
    if (!this.hasCredentials) {
      throw new QBError('qBittorrent 拒绝了未认证请求。请在设置页填写 qB 的用户名与密码（或在 qB 里开启「对本地主机跳过认证」）。', {
        statusCode: 401,
        kind: 'auth',
      });
    }
    this.#loginPromise = (async () => {
      const { res, text } = await this.#send('/api/v2/auth/login', {
        method: 'POST',
        form: { username: this.username, password: this.password },
      });
      // qB 登录成功返回 200 + 文本 "Ok."，失败也是 200 + "Fails."（设计如此）
      if (!this.#sid || /^\s*Fails\.?\s*$/i.test(text) || res.status >= 400) {
        this.#sid = '';
        throw new QBError('qBittorrent 登录失败：用户名或密码不对，请到设置页检查', {
          statusCode: 401,
          kind: 'auth',
        });
      }
      log.info(`[qb] 登录成功 ${this.baseUrl}（${this.username}）`);
      return this.#sid;
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
      throw new QBError(`qBittorrent 返回 ${res.status}：${text.slice(0, 200) || '无响应内容'}`);
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
      throw new QBError(`qBittorrent 返回 ${res.status}：${text.slice(0, 200) || '无响应内容'}`);
    }
    return text.trim();
  }

  /** 版本号形如 "v4.6.7"；用于设置页自检。 */
  async appVersion() {
    return this.#text('/api/v2/app/version');
  }

  /** server_state.free_space_on_disk 是 qB 所在磁盘的真实剩余空间。 */
  async mainData() {
    return this.#json('/api/v2/sync/maindata');
  }

  async freeSpace() {
    try {
      const data = await this.mainData();
      const value = Number(data?.server_state?.free_space_on_disk);
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch (err) {
      log.warn(`[qb] 读取剩余空间失败：${err.message}`);
      return null;
    }
  }

  /** hashes 为空表示全部任务，否则用 | 连接。 */
  async torrentsInfo(hashes) {
    const list = Array.isArray(hashes) ? hashes.filter(Boolean) : [];
    return (await this.#json('/api/v2/torrents/info', {
      query: { hashes: list.join('|') || undefined },
    })) || [];
  }

  async torrentsFiles(hash) {
    return (await this.#json('/api/v2/torrents/files', { query: { hash } })) || [];
  }

  /**
   * 添加任务。
   * @param {{magnet?: string, torrent?: Buffer, savePath?: string, category?: string, paused?: boolean}} input
   */
  async addTorrent(input) {
    const form = new FormData();
    if (input.magnet) form.set('urls', input.magnet);
    if (input.torrent) {
      form.set('torrents', new Blob([input.torrent], { type: 'application/x-bittorrent' }), 'wanspilot.torrent');
    }
    if (input.savePath) form.set('savepath', input.savePath);
    if (input.category) form.set('category', input.category);
    if (input.paused) form.set('paused', 'false'); // 交给 qB 自己的队列策略，不用 wanspilot 的自动暂停
    const text = await this.#text('/api/v2/torrents/add', { method: 'POST', formData: form });
    // 4.x 成功返回空或 "Ok."，种子无效返回 "Fails."
    if (/^Fails\.?$/i.test(text)) {
      throw new QBError('qBittorrent 拒绝了这个任务：种子或磁力链接无效', { statusCode: 400, kind: 'input' });
    }
    return true;
  }

  /** 4.x 叫 pause/resume，5.0 改叫 stop/start 且保留了旧别名。先新后旧，兼容两头。 */
  async #toggle(action, hashes) {
    const joined = Array.isArray(hashes) ? hashes.join('|') : String(hashes || '');
    const modern = action === 'stop' ? 'stop' : 'start';
    const legacy = action === 'stop' ? 'pause' : 'resume';
    try {
      return await this.#text(`/api/v2/torrents/${modern}`, { method: 'POST', form: { hashes: joined } });
    } catch (err) {
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return this.#text(`/api/v2/torrents/${legacy}`, { method: 'POST', form: { hashes: joined } });
      }
      throw err;
    }
  }

  async pause(hashes) {
    return this.#toggle('stop', hashes);
  }

  async resume(hashes) {
    return this.#toggle('start', hashes);
  }

  async deleteTorrents(hashes, deleteFiles = false) {
    const joined = Array.isArray(hashes) ? hashes.join('|') : String(hashes || '');
    return this.#text('/api/v2/torrents/delete', {
      method: 'POST',
      form: { hashes: joined, deleteFiles: deleteFiles ? 'true' : 'false' },
    });
  }

  /** 设置页「测试连接」：一次调用拿版本、认证方式与剩余空间。 */
  async probe() {
    const startedAt = Date.now();
    const version = await this.appVersion();
    const data = await this.mainData();
    return {
      ok: true,
      version,
      latencyMs: Date.now() - startedAt,
      authMode: this.authMode,
      freeBytes: Number(data?.server_state?.free_space_on_disk) || null,
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
