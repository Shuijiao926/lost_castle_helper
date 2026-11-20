#!/usr/bin/env python3
"""统一生成 Node 服务连接密钥与令牌；密码只经隐藏输入，不进入参数、日志或镜像。

密钥命名统一为 node_<用途>_url，与 compose.yaml 中挂载的文件名一一对应。
"""

import argparse
import getpass
import os
from pathlib import Path
import secrets
from urllib.parse import quote

# 每个用途绑定的默认数据库角色；角色与授权由维护者另行创建。
ROLES = {
    "catalog": ("node_catalog_url", "lc2_catalog_reader"),
    "ratings": ("node_ratings_url", "lc2_rating_writer"),
    "submissions": ("node_submissions_url", "lc2_submission_writer"),
}

# 早期部署文件名的迁移映射，保证换编排不需要重新输入密码。
LEGACY_NAMES = {
    "node_database_url": "node_catalog_url",
    "node_ratings_database_url": "node_ratings_url",
    "node_submissions_database_url": "node_submissions_url",
}


def main():
    """按选择生成密钥；已存在的文件默认不覆盖。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["all", "catalog", "ratings", "submissions", "admin"],
                        default="all", help="生成哪一组；all 只含图鉴连接与管理令牌")
    parser.add_argument("--replace", action="store_true", help="明确允许覆盖同名密钥")
    parser.add_argument("--migrate-legacy", action="store_true", help="把早期文件名的密钥改成统一命名")
    parser.add_argument("--db-user", default=None)
    parser.add_argument("--db-host", default="db")
    parser.add_argument("--db-port", type=int, default=5432)
    parser.add_argument("--db-name", default="lc2")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    if not (root / "compose.yaml").is_file():
        parser.error("请把本脚本放在部署目录的 scripts/ 下（与 compose.yaml 同级）")
    directory = root / "secrets"
    if directory.exists() and any(path.is_symlink() for path in directory.glob("*")):
        parser.error("密钥目录内不能包含符号链接")
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)

    if args.migrate_legacy:
        rename_legacy(directory)

    if args.only == "admin":
        write_secret(directory / "node_admin_token", secrets.token_urlsafe(48), args.replace)
    elif args.only == "all":
        login, default_user = ROLES["catalog"]
        write_url(directory / login, args.db_user or default_user, args, parser)
        write_secret(directory / "node_admin_token", secrets.token_urlsafe(48), args.replace)
    else:
        login, default_user = ROLES[args.only]
        write_url(directory / login, args.db_user or default_user, args, parser)

    print("已生成本次选择的密钥；未修改其他密钥、数据库账号、密码或业务数据。")


def rename_legacy(directory):
    """只处理尚未存在的目标文件名，避免覆盖已经生效的密钥。"""
    for old, new in LEGACY_NAMES.items():
        source = directory / old
        target = directory / new
        if source.is_file() and not target.exists():
            source.rename(target)
            print("已迁移：" + old + " -> " + new)


def write_url(target, user, args, parser):
    """生成带最小连接池参数的连接串，密码经 URL 编码避免特殊字符破坏协议。"""
    password = getpass.getpass("请输入 " + user + " 的数据库密码（输入不显示）：")
    if not password:
        parser.error("数据库密码不能为空")
    url = ("postgresql://" + quote(user, safe="") + ":" + quote(password, safe="")
           + "@" + args.db_host + ":" + str(args.db_port) + "/" + quote(args.db_name, safe="")
           + "?connection_limit=2&connect_timeout=5&pool_timeout=5")
    write_secret(target, url, args.replace)


def write_secret(target, value, replace):
    """容器内 node 用户需要读取绑定挂载的文件，因此文件为 0644、目录为 0700。"""
    if any(path.is_symlink() for path in [target]):
        raise SystemExit("密钥文件不能是符号链接：" + target.name)
    if target.exists() and not replace:
        raise SystemExit("密钥已存在：" + target.name + "；确需重建时显式传入 --replace")
    flags = os.O_WRONLY | os.O_CREAT | (os.O_TRUNC if replace else os.O_EXCL)
    descriptor = os.open(target, flags, 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(value + "\n")
    target.chmod(0o644)


if __name__ == "__main__":
    main()
