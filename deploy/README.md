# 部署目录约定

一个目录、一份编排、一套脚本。所有服务都从这里起，不再手拼 `-f` / `--profile`。

## 目录结构

```text
deploy/
├── compose.yaml          四服务统一编排（db / node / admin / web）
├── .env.example          非密钥配置模板，复制成 .env 使用
├── caddy/Caddyfile       域名与 HTTPS：/api 反代 Node，/data 静态数据包
├── scripts/ops.sh        唯一运维入口（构建/启动/状态/迁移/审核/日志）
├── scripts/secrets.py    生成连接串与令牌，密码只走隐藏输入
├── secrets/              运行期生成，0600 目录，不进仓库
├── node-build/           解包后的 Node 构建上下文（含 Dockerfile）
├── admin-build/          Java 管理端上下文（Dockerfile + target/lc2-admin.jar）
├── imports/              Java 导入用的只读数据目录
└── data/                 Caddy 对外提供的静态数据包（/data/*）
```

## 服务与构建方式

| 服务 | 镜像 | 何时构建 | 说明 |
| --- | --- | --- | --- |
| `db` | `postgres:17` | 不需要 | 数据在命名卷 `lc2_pgdata` |
| `node` | `lc2-node:<tag>` | `ops.sh build node` | 上下文 `node-build/`，默认启动 |
| `admin` | `lc2-admin:<tag>` | `ops.sh build admin` | 上下文 `admin-build/`，`profile: admin`，一次性命令 |
| `web` | `caddy:2-alpine` | 不需要 | `profile: web`，只在启用域名时启动 |

两个需要构建的服务遵循同一套约定：

- 构建上下文各占一个目录，`Dockerfile` 放在该目录根部。
- 每个上下文自带 `.dockerignore`，默认排除全部再逐条放行。
- 镜像内不写入任何密钥，密钥一律通过 `/run/secrets/*` 挂载。

## 首次部署

```bash
# 0. 把 out/lc2-deploy.tar.gz 上传并解到 ~/lc2-deploy，进入该目录
cd ~/lc2-deploy

# 1. 配置与密钥
cp .env.example .env && chmod 600 .env
vi .env                      # 至少确认 LC2_DOMAIN 与 POSTGRES_* 两项

# 2. 生成密钥（旧部署可用 --migrate-legacy 直接改名复用，不必重输密码）
./scripts/ops.sh secrets --migrate-legacy
./scripts/ops.sh secrets --only all                # 图鉴连接串 + 管理令牌
./scripts/ops.sh secrets --only ratings            # 评分写入账号
./scripts/ops.sh secrets --only submissions        # 投稿写入账号

# 3. 起库、迁移、起服务
./scripts/ops.sh up
./scripts/ops.sh build admin
./scripts/ops.sh migrate
./scripts/ops.sh build node
./scripts/ops.sh up

# 4. 验证
./scripts/ops.sh status
```

`status` 里的 `/api/health` 会给出 `persistence` 字段：

- `"catalog":"postgres"` / `"builds":"postgres"` / `"ratings":"postgres"` / `"submissions":"postgres"` 表示已接库；
- `"packages":"json"` 表示图鉴数据包仍读静态文件，属于当前预期。

## 启用域名

1. DNS：`castle-helper.fun` 的 A 记录指向服务器公网 IP。
2. 安全组：放行 80 / 443（80 用于 ACME 校验，不能只放 443）。
3. 启动代理：

```bash
./scripts/ops.sh web
curl -I https://castle-helper.fun/api/health
```

Caddy 会自动申请并续期证书；证书数据存在 `lc2_caddy_data` 卷里，重建容器不会重复申请。

## 构建源（国内加速）

镜像构建要下载 Debian 包和 npm 依赖。默认走官方源，国内服务器会极慢——实测同一台腾讯云机器，`apt-get update` 卡在 8.7 MB 的 Packages 上超过 4 分钟。在 `.env` 里指向就近镜像：

```bash
DEBIAN_MIRROR=mirrors.tencentyun.com
NPM_REGISTRY=https://mirrors.tencentyun.com/npm
```

这两项会作为 build-arg 传给 `node-build/Dockerfile`，只在构建期生效，不进入运行时镜像。留空则保持官方源，海外机器和 CI 不受影响。同一台机器换成内网源后，整包构建从「4 分钟还没过 apt」降到约 70 秒。

## 日常操作

```bash
./scripts/ops.sh status                # 容器状态 + 健康接口
./scripts/ops.sh logs node             # 最近 80 行日志
./scripts/ops.sh review                # 列出待审投稿
./scripts/ops.sh approve <uuid> 备注   # 通过并写入已发布流派
./scripts/ops.sh reject <uuid> 原因    # 驳回
./scripts/ops.sh stop                  # 停容器，保留数据
```

## 硬性约束

- **永远不要 `docker compose down -v`**：`-v` 会删除 `pgdata`，数据库直接没了。
- 不要在 `compose.yaml` 里写明文密码；只允许 `${VAR}` 或 `*_FILE`。
- 密钥文件权限保持 `0644`（容器内 `node` 用户要读），`secrets/` 目录保持 `0700`。
- 端口 4317 只绑定 `127.0.0.1`，对外一律走 `web` 的 443。
