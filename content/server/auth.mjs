import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'wp_session';
const MAX_AGE = 7 * 24 * 3600;
let token = '';
let username = '';
let passwordHash = '';
let sessionKey = '';
export function authMode() { return username ? 'password' : 'token'; }
const attempts = new Map();

export function initAuth(dataDir) {
  username = String(process.env.WP_USERNAME || '').trim();
  const password = String(process.env.WP_PASSWORD || '');
  if (username || password) {
    if (!username || password.length < 8) throw new Error('请同时配置 WP_USERNAME 和至少 8 个字符的 WP_PASSWORD');
    passwordHash = crypto.scryptSync(password, 'wanspilot-login:' + username, 32).toString('hex');
    sessionKey = crypto.createHash('sha256').update(username + ':' + passwordHash).digest('hex');
    token = String(process.env.WP_ACCESS_TOKEN || '').trim();
    if (token && token.length < 16) throw new Error('WP_ACCESS_TOKEN 至少需要 16 个字符');
    attempts.clear();
    return;
  }
  passwordHash = '';
  const file = path.join(dataDir, 'access-token');
  fs.mkdirSync(dataDir, { recursive: true });
  token = String(process.env.WP_ACCESS_TOKEN || '').trim();
  if (!token) {
    try { token = fs.readFileSync(file, 'utf8').trim(); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      fs.writeFileSync(file, token + '\n', { mode: 0o600, flag: 'wx' });
    }
    fs.chmodSync(file, 0o600);
  }
  sessionKey = token;
  if (token.length < 16) throw new Error('访问令牌至少需要 16 个字符，请修改 WP_ACCESS_TOKEN 或 /data/access-token');
}

function equal(a, b) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
}
function signature(payload) { return crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url'); }

export function authenticated(req) {
  if (!sessionKey) return false;
  if (String(req.headers.authorization || '').startsWith('Bearer ')) return Boolean(token) && equal(req.headers.authorization.slice(7), token);
  const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!cookie) return false;
  const parts = cookie.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 3) return false;
  const expires = Number(parts[0]);
  return Number.isFinite(expires) && expires > Date.now() && expires <= Date.now() + MAX_AGE * 1000
    && equal(parts[2], signature(parts.slice(0, 2).join('.')));
}
export function sameOrigin(req) {
  if (!req.headers.origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
export function login(req, value) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
  if (entry.count >= 10) return { status: 429, error: '尝试过于频繁，请 15 分钟后再试' };
  let valid;
  if (username) {
    const supplied = value && typeof value === 'object' ? value : {};
    const suppliedHash = crypto.scryptSync(String(supplied.password || ''), 'wanspilot-login:' + username, 32).toString('hex');
    const userMatches = equal(String(supplied.username || ''), username);
    valid = equal(suppliedHash, passwordHash) && userMatches;
  } else valid = equal(String((value && typeof value === 'object' ? value.token : value) || ''), token);
  if (!valid) {
    entry.count += 1;
    if (attempts.size < 10000 || attempts.has(key)) attempts.set(key, entry);
    return { status: 401, error: username ? '账号或密码不正确' : '访问令牌不正确' };
  }
  attempts.delete(key);
  const payload = `${now + MAX_AGE * 1000}.${crypto.randomBytes(16).toString('hex')}`;
  return { status: 200, cookie: `${COOKIE}=${payload}.${signature(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${req.socket.encrypted ? '; Secure' : ''}` };
}
export function logoutCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`; }
