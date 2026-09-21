# ─────────────────────────────────────────────
# Ni-Zn Battery Configuration Calculator
# 一条命令运行:  docker compose up -d
# 或:            docker build -t battery-config . && docker run -p 3000:3000 battery-config
# ─────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# 先装依赖（利用 Docker 层缓存）
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 再拷贝源码
COPY public ./public
COPY server ./server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/index.js"]
