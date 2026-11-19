#!/usr/bin/env python3
"""在服务器本地生成 Node 密钥文件，密码不进入参数、终端输出或镜像。"""

import argparse
import getpass
import os
from pathlib import Path
import secrets
from urllib.parse import quote


def main():
    """只写部署目录中的两份密钥；已有文件默认不覆盖。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replace", action="store_true", help="明确允许重建已有 Node 密钥")
    parser.add_argument("--db-user", default="lc2_catalog_reader")
    parser.add_argument("--db-host", default="db")
    parser.add_argument("--db-port", type=int, default=5432)
    parser.add_argument("--db-name", default="lc2")
    args = parser.parse_args()
    root = Path.cwd().resolve()
    if not (root / "compose.yaml").is_file():
        parser.error("请先进入包含 compose.yaml 的 lc2-deploy 目录")
    directory = root / "secrets"
    if not directory.resolve().is_relative_to(root):
        parser.error("密钥目录不能指向部署目录之外")
    targets = [directory / "node_database_url", directory / "node_admin_token"]
    if any(path.is_symlink() for path in targets):
        parser.error("密钥文件不能是符号链接")
    if any(path.exists() for path in targets) and not args.replace:
        parser.error("Node 密钥已存在；确需重建时显式传入 --replace")
    password = getpass.getpass("请输入 Node 游戏数据只读账号密码（输入不显示）：")
    if not password:
        parser.error("数据库密码不能为空")
    url = ("postgresql://" + quote(args.db_user, safe="") + ":" + quote(password, safe="")
           + "@" + args.db_host + ":" + str(args.db_port) + "/" + quote(args.db_name, safe="")
           + "?connection_limit=2&connect_timeout=5&pool_timeout=5")
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    # 父目录仅部署用户可遍历；文件需允许容器内 node 用户读取绑定挂载。
    for target, value in zip(targets, [url, secrets.token_urlsafe(48)]):
        flags = os.O_WRONLY | os.O_CREAT | (os.O_TRUNC if args.replace else os.O_EXCL)
        descriptor = os.open(target, flags, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(value + "\n")
        target.chmod(0o644)
    print("Node 连接文件和独立管理令牌已生成；未修改数据库账号、密码或数据。")


if __name__ == "__main__":
    main()
