/** Audit business operations without request bodies, credentials, cookies or polling noise. */
import { log } from './log.mjs';
export function operationFor(method, pathname) {
  const exact = {
    'POST /api/auth/login':'登录', 'POST /api/auth/logout':'退出登录',
    'PUT /api/settings':'保存设置', 'POST /api/settings':'保存设置', 'POST /api/settings/test':'测试连接',
    'POST /api/tasks':'添加下载任务', 'POST /api/tasks/batch':'批量管理下载', 'POST /api/subscriptions/batch':'批量管理订阅','POST /api/notifications/read':'标记通知已读', 'POST /api/subscriptions':'创建订阅',
    'POST /api/subscriptions/import':'导入订阅', 'GET /api/subscriptions/export':'导出订阅',
    'POST /api/organizer/run':'执行文件整理', 'GET /api/organizer/preview':'预览文件整理',
    'GET /api/resources':'手动搜索资源', 'GET /api/tmdb/search':'搜索影视',
  };
  if (exact[method+' '+pathname]) return exact[method+' '+pathname];
  if (/^\/api\/subscriptions\/[^/]+\/episodes$/.test(pathname) && method==='PATCH') return '调整逐集下载记录';
  if (/^\/api\/subscriptions\/[^/]+\/check$/.test(pathname) && method==='POST') return '立即检查订阅';
  if (/^\/api\/subscriptions\/[^/]+\/upgrade$/.test(pathname)) return method==='POST'?'升级订阅画质':method==='DELETE'?'忽略画质升级':null;
  if (/^\/api\/subscriptions\/[^/]+$/.test(pathname)) return method==='PATCH'?'修改订阅':method==='DELETE'?'取消订阅':null;
  if (/^\/api\/tasks\/[^/]+\/pause$/.test(pathname) && method==='POST') return '暂停下载任务';
  if (/^\/api\/tasks\/[^/]+\/resume$/.test(pathname) && method==='POST') return '继续下载任务';
  if (/^\/api\/tasks\/[^/]+$/.test(pathname) && method==='DELETE') return '删除下载任务';
  return null;
}
export function auditOperation(req,res,url) {
  const operation=operationFor(req.method,url.pathname);if(!operation)return;
  const started=Date.now();
  const target=url.pathname.split('/')[3] || '';
  const context=/^[a-z0-9_-]{1,80}$/i.test(target)?' · '+target:'';
  log.info(`[operation] ${operation} 开始${context}`);
  res.once('finish',()=>{
    const level=res.statusCode>=400?'warn':'info';
    log[level](`[operation] ${operation} ${res.statusCode>=400?'失败':'完成'} · HTTP ${res.statusCode} · ${Date.now()-started} ms${req.operationResult?' · '+req.operationResult:''}${context}`);
  });
  res.once('close',()=>{if(!res.writableFinished)log.warn(`[operation] ${operation} 客户端连接已断开，后台操作状态请查看业务记录${context}`);});
}
