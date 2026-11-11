# apps/shared — 前后端共用

流派数据的校验层：客户端提交前预检、服务端接收时校验，用同一份代码。

**完整说明见 [文档/共享层说明.md](../../文档/共享层说明.md)。**

```js
const { validateBuild } = require('../../shared/validate');
```