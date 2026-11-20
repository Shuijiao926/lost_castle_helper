# scripts — 构建期脚本

数据校验、文档内链检查、图标生成，以及两条打包命令。不参与客户端运行时。

**完整说明见 [文档/设计/脚本说明.md](../文档/设计/脚本说明.md)。**

```bash
node scripts/validate-data.js          # 流派数据校验
node scripts/check-links.js            # 文档内链
node scripts/package-deploy.js         # 产出 out/lc2-deploy.tar.gz（服务器部署包）
node scripts/package-desktop.js        # 产出 release/LC2Helper-<版本>-win-x64-setup.exe
```

打包也可用根目录的 npm 脚本：`npm run deploy:pack`、`npm run package:exe`、`npm run package:portable`。
两个打包脚本都不提交、不推送、不发布，只在本地产出文件；上传与发布由人决定。
