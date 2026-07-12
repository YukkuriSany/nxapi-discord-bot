FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOME=/data \
    XDG_CACHE_HOME=/data/.cache \
    XDG_CONFIG_HOME=/data/.config \
    XDG_STATE_HOME=/data/.local/state \
    NXAPI_DATA_PATH=/data \
    NXAPI_DEBUG_FILE=0
WORKDIR /app
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ffmpeg python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages --no-cache-dir yt-dlp && \
    npm install --global nxapi@latest && \
    npm cache clean --force && \
    groupadd --system --gid 10001 bot && \
    useradd --system --uid 10001 --gid bot --home-dir /app bot && \
    mkdir -p /data/.cache /data/.config /data/.local/state && \
    chown -R bot:bot /data
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=bot:bot package.json ./
COPY --chown=bot:bot src ./src
USER bot
VOLUME ["/data"]
CMD ["node", "src/index.js"]
