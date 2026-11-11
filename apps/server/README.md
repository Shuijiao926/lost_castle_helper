# apps/server — 后台服务（P1）

Node + Fastify。**按大功能职责（限界上下文）分模块，模块内 DDD 分层**；P1 用 JSON 仓储，无数据库也能跑通全链路。

**完整说明见 [文档/服务端说明.md](../../文档/服务端说明.md)，设计依据见 [文档/后端设计-DDD.md](../../文档/后端设计-DDD.md)。**

```bash
cd apps/server
npm start        # http://127.0.0.1:4317
npm test         # 领域 + 安全 + HTTP 集成测试（28 个用例）
```

```
src/
├─ app/        组合根：config · container · http-server · auth · adapters
├─ api/        接口公共定义：routes（路由表）· handlers · errors
├─ shared/     logger · errors · event-bus · shared-kernel · json-database
└─ modules/
   ├─ catalog/     图鉴        ├─ builds/       流派
   ├─ submissions/ 投稿        ├─ ratings/      评分
   ├─ publishing/  发布        └─ security/     安全管控（指纹 + 限流）
      （每个模块内：domain / application / infrastructure）
```
