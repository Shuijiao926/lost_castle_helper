# apps/server — 后台服务（骨架）

Node + Fastify + Prisma + PostgreSQL。**当前未启用**，数据与文件暂由 GitHub 承担。

**完整说明见 [文档/后台架构.md](../../文档/后台架构.md) 与 [文档/服务端说明.md](../../文档/服务端说明.md)。**

```bash
cd apps/server
npm start                 # 无 DATABASE_URL 时自动降级为 JSON 文件存储
```