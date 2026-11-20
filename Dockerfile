# Node 用户服务镜像
#
# 单仓库单镜像：只装 @lc2/server 及其工作区依赖，不碰桌面端。
# 构建上下文是仓库根目录（本地或服务器上的 node-build/），因此 Dockerfile 放在根上，
# 与 Java 管理端的 Dockerfile 保持同一种位置和格式。
FROM node:22-bookworm-slim AS base
# 默认走官方源；国内构建可传 --build-arg DEBIAN_MIRROR=mirrors.tencentyun.com 换成就近镜像。
ARG DEBIAN_MIRROR=
RUN if [ -n "$DEBIAN_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
# 同理，registry 可指向内网 npm 源；不传则用官方源。
ARG NPM_REGISTRY=
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/shared/package.json ./apps/shared/package.json
# 只装服务端工作区；--ignore-scripts 防止安装期拉起 Electron 或仓库 hooks。
RUN npm config set registry "${NPM_REGISTRY:-https://registry.npmjs.org}" \
    && npm ci --workspace @lc2/server --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY apps/server/prisma ./apps/server/prisma
RUN npx --no-install prisma generate --schema apps/server/prisma/schema.prisma
RUN npm prune --omit=dev --workspace @lc2/server --include-workspace-root --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/src ./apps/server/src
COPY apps/shared ./apps/shared
COPY data ./data
RUN mkdir -p /app/runtime && chown node:node /app/runtime
USER node
EXPOSE 4317
CMD ["node", "apps/server/src/index.js"]
