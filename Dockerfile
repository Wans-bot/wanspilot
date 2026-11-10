# wanspilot 只做「选片 + 把任务丢给 qBittorrent」，自己不跑 BT 引擎。
# 依赖只有 undici，运行镜像很小，amd64 / arm64 都能跑。

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY content/package.json content/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    WP_DATA_DIR=/data \
    WP_DOWNLOAD_DIR=/downloads \
    WP_CACHE_DIR=/cache/wanspilot \
    WP_PORT=3000 \
    PUID=1000 \
    PGID=1000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gosu tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY content/ ./
RUN chmod +x entry.sh && mkdir -p /data /cache/wanspilot

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WP_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/sh", "/app/entry.sh"]
