#!/usr/bin/env bash
# 统一运维入口：构建、启动、状态、迁移、审核、日志都从这里走，
# 不再手拼 docker compose 的 -f / --profile / --env-file 参数组合。
#
# 用法：./scripts/ops.sh <命令> [参数]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")

usage() {
	cat <<'USAGE'
用法：./scripts/ops.sh <命令>

  init               生成 .env（首次）并检查密钥是否齐全
  build [node|admin] 构建镜像（默认 node）
  up                 启动 db + node（等待健康检查通过）
  web                额外启动 Caddy（域名 + HTTPS）
  status             容器状态 + /api/health
  check [ratings|submissions] 只读预检数据库连接与最小权限
  migrate            执行 Flyway 迁移（V1–V4）
  review             列出待审投稿
  approve <id> [备注] 审核通过（会写入已发布流派）
  reject <id> <原因>  审核驳回
  logs [服务名]      查看日志（默认 node，最近 80 行）
  stop               停止容器（保留数据卷）
  secrets <参数>     转给 secrets.py，例如 --only submissions --replace

不要使用 docker compose down -v：那会删除数据库卷。
USAGE
}

require_env() {
	if [[ ! -f "$ROOT/.env" ]]; then
		echo "缺少 $ROOT/.env，先执行：./scripts/ops.sh init" >&2
		exit 1
	fi
}

require_secrets() {
	local missing=()
	for name in postgres_password node_catalog_url node_ratings_url node_submissions_url node_admin_token; do
		[[ -f "$ROOT/secrets/$name" ]] || missing+=("$name")
	done
	if (( ${#missing[@]} > 0 )); then
		echo "缺少密钥文件：${missing[*]}" >&2
		echo "用 ./scripts/ops.sh secrets --only <catalog|ratings|submissions|admin> 补齐" >&2
		exit 1
	fi
}

command="${1:-}"
shift || true

case "$command" in
	init)
		if [[ -f "$ROOT/.env" ]]; then
			echo ".env 已存在，未覆盖"
		else
			cp "$ROOT/.env.example" "$ROOT/.env"
			chmod 600 "$ROOT/.env"
			echo "已生成 .env，按需修改后继续"
		fi
		mkdir -p "$ROOT/secrets"
		chmod 700 "$ROOT/secrets"
		;;
	build)
		require_env
		target="${1:-node}"
		case "$target" in
			node) "${COMPOSE[@]}" build node ;;
			admin)
				[[ -f "$ROOT/admin-build/target/lc2-admin.jar" ]] || {
					echo "缺少 admin-build/target/lc2-admin.jar，先上传新构建的 JAR" >&2
					exit 1
				}
				"${COMPOSE[@]}" --profile admin build admin
				;;
			*) echo "只能构建 node 或 admin" >&2; exit 1 ;;
		esac
		;;
	up)
		require_env
		require_secrets
		# 透传额外参数，例如 up --dry-run 先看会重建哪些容器。
		"${COMPOSE[@]}" up "$@" -d --wait --wait-timeout 120 db node
		;;
	web)
		require_env
		require_secrets
		"${COMPOSE[@]}" --profile web up "$@" -d --wait --wait-timeout 120 web
		;;
	status)
		require_env
		"${COMPOSE[@]}" ps
		echo
		curl -fsS http://127.0.0.1:4317/api/health || echo "健康接口不可达"
		echo
		;;
	migrate)
		require_env
		"${COMPOSE[@]}" --profile admin run --rm admin --lc2.catalog.command=migrate
		;;
	check)
		require_env
		require_secrets
		# 只读预检：确认连接可用、表存在、账号权限恰好最小，不写入任何数据。
		case "${1:-submissions}" in
			ratings) "${COMPOSE[@]}" run --rm --no-deps node node apps/server/src/check-rating-storage.js ;;
			submissions) "${COMPOSE[@]}" run --rm --no-deps node node apps/server/src/check-submission-storage.js ;;
			*) echo "只能检查 ratings 或 submissions" >&2; exit 1 ;;
		esac
		;;
	review)
		require_env
		"${COMPOSE[@]}" --profile admin run --rm admin --lc2.task=submission --lc2.submission.command=pending
		;;
	approve)
		require_env
		[[ -n "${1:-}" ]] || { echo "用法：ops.sh approve <uuid> [备注]" >&2; exit 1; }
		# 备注可含空格，因此拆成独立数组元素，避免空格被 shell 再切分。
		review_args=(--lc2.task=submission --lc2.submission.command=approve
			"--lc2.submission.id=$1" "--lc2.submission.reviewer=admin")
		[[ -n "${2:-}" ]] && review_args+=("--lc2.submission.note=$2")
		"${COMPOSE[@]}" --profile admin run --rm admin "${review_args[@]}"
		;;
	reject)
		require_env
		[[ -n "${1:-}" && -n "${2:-}" ]] || { echo "用法：ops.sh reject <uuid> <原因>" >&2; exit 1; }
		"${COMPOSE[@]}" --profile admin run --rm admin --lc2.task=submission \
			--lc2.submission.command=reject "--lc2.submission.id=$1" \
			"--lc2.submission.reviewer=admin" "--lc2.submission.note=$2"
		;;
	logs)
		require_env
		"${COMPOSE[@]}" logs --tail=80 "${1:-node}"
		;;
	stop)
		require_env
		"${COMPOSE[@]}" stop
		;;
	secrets)
		python3 "$ROOT/scripts/secrets.py" "$@"
		;;
	""|-h|--help|help)
		usage
		;;
	*)
		echo "未知命令：$command" >&2
		usage
		exit 1
		;;
esac
