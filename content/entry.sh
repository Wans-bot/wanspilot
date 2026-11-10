#!/bin/sh
# wanspilot 容器入口。
#
# 镜像里以 `ENTRYPOINT tini -- /bin/sh /app/entry.sh` 启动；
# 用脚本自身位置解析代码目录，本机调试时 `sh content/entry.sh` 也能跑。
set -e

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

export WP_DATA_DIR="${WP_DATA_DIR:-/data}"
export WP_DOWNLOAD_DIR="${WP_DOWNLOAD_DIR:-/downloads}"
export WP_CACHE_DIR="${WP_CACHE_DIR:-/cache/wanspilot}"
export WP_PORT="${WP_PORT:-3000}"

# /data 与 /cache 是容器的持久卷；下载目录由用户决定挂不挂，建失败不算错。
mkdir -p "$WP_DATA_DIR/logs" "$WP_CACHE_DIR" 2>/dev/null || true
mkdir -p "$WP_DOWNLOAD_DIR" 2>/dev/null || true

echo "[entry] wanspilot starting: data=$WP_DATA_DIR downloads=$WP_DOWNLOAD_DIR port=$WP_PORT"

# NAS 上常见 PUID/PGID=1000。以 root 启动时降到该用户运行，
# 否则 /data 里写出的文件在宿主机上属于 root，后续管理很麻烦。
# 只 chown 自己管理的 data/cache，绝不碰下载目录（可能是几十万文件的媒体库）。
if [ "$(id -u)" = "0" ] && [ -n "$PUID" ] && [ -n "$PGID" ]; then
  if ! getent group "$PGID" >/dev/null 2>&1; then
    groupadd -o -g "$PGID" wans 2>/dev/null || true
  fi
  if ! getent passwd "$PUID" >/dev/null 2>&1; then
    useradd -o -u "$PUID" -g "$PGID" -M -s /usr/sbin/nologin wans 2>/dev/null || true
  fi
  chown -R "$PUID:$PGID" "$WP_DATA_DIR" "$WP_CACHE_DIR" 2>/dev/null || true
  exec gosu "$PUID:$PGID" node --max-old-space-size=768 "$SELF_DIR/server/index.mjs"
fi

# exec 让 node 成为 PID 1 的子进程，docker stop 的 SIGTERM 能直接到达并触发优雅退出。
exec node --max-old-space-size=768 "$SELF_DIR/server/index.mjs"
