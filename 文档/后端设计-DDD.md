# 后端设计（DDD）

> 目标：把「数据采集 → 存储 → 审核 → 发布 → 客户端消费」这条链路用领域驱动的方式建模。
> 现在没有数据库也能跑：仓储接口有 **PostgreSQL（Prisma）** 和 **JSON 文件** 两种实现。

---

## 一、限界上下文

先按业务能力切，不按技术切。

| 上下文 | 职责 | 核心概念 | 谁写数据 |
|---|---|---|---|
| **图鉴 Catalog** | 游戏参考数据：武器、刻印、宝藏、宝物流派分类 | `WeaponType` `Inscription` `Treasure` `School` `Rarity` `ClassifyDepth` | 采集器（只读为主） |
| **流派 Builds** | 玩家总结的构筑：拿什么宝藏、顺序、配装、加点 | `Build`（聚合根） | 审核通过后由投稿转换 |
| **投稿 Submissions** | 社区投稿的接收、审核、驳回 | `Submission`（聚合根） | 投稿者 |
| **评分 Ratings** | 玩家对流派打分、防刷 | `Rating` | 客户端 |
| **发布 Publishing** | 把数据打包成带版本的「数据包」，供客户端拉取 | `DataPackage`（聚合根） | 审核通过后由系统生成 |
| **资产 Assets** | 图标、截图等二进制文件 | `Asset` | 采集器 / 投稿者 |
| **安全 Security** | 限流、请求指纹、防刷、审计 | `RateLimitPolicy` `RequestFingerprint` | 所有写入接口 |

**上下文之间的关系**：

```
Catalog ──(只读引用)──> Builds <──(审核通过后生成)── Submissions
   │                      │
   └──────(打包)─────────> Publishing ──> 客户端
```

- Builds 只**引用** Catalog 的 ID（`weaponTypeId`、`inscriptionId`、`treasureId`），不复制名称
- Submissions 不直接改 Builds，必须经过审核用例
- Publishing 只读，不反向依赖任何上下文

---

## 二、代码组织：按大功能职责划分，模块内分层

目录**先按限界上下文切**（哪个功能），模块**内部再按 DDD 分层**（哪一层）。

```
apps/server/src/
├─ app/                    组合根：config · container · http-server · auth · adapters
├─ api/                    ★ 接口公共定义：routes（路由表）· handlers · errors
├─ shared/                 跨模块：logger · kernel/errors · event-bus · shared-kernel · json-database
└─ modules/                ★ 每个目录 = 一个限界上下文
   ├─ catalog/  ├─ builds/  ├─ submissions/  ├─ ratings/  ├─ publishing/  └─ security/
       ├─ domain/           实体 / 值对象 / 聚合 / 仓储接口（纯 JS，禁止 IO）
       ├─ application/      用例编排
       └─ infrastructure/   仓储与技术实现（P1=JSON，P4=Prisma）
```

**三条边界纪律**：

1. **HTTP 只在 `api/`**：路由、权限、错误映射集中；模块里不出现 `request` / `reply`
2. **配置只在 `app/config.js`**：业务代码不读 `process.env`，默认值只写一处
3. **日志只用 `shared/logger.js`**：业务代码不直接 `console.*`，统一格式与级别

### 横切关注点

| 关注点 | 位置 | 说明 |
|---|---|---|
| 日志 | `shared/logger.js` | 分级别、带 scope、`child()` 派生；启动只打印数据加载情况 |
| API 定义 | `api/routes.js` | 方法 / 路径 / 权限 / handler 名集中声明，新增接口改一张表 |
| 错误映射 | `api/errors.js` | 领域错误 → 4xx/5xx，含 429 + Retry-After |
| 鉴权 | `app/admin-auth.js` | 头名与口令来自配置 |
| 安全管控 | `modules/security/` | 指纹 + 滑动窗口限流，写接口统一走 `RateLimiter.assert()` |

## 三、聚合与不变量

### 3.1 Build（聚合根）

一条流派 = 玩家看到的卡片 + 详情页 8 个区块。

**不变量**（违反就拒绝写入）：

| 不变量 | 规则 |
|---|---|
| ID 唯一 | `build.id` 全局唯一，3–40 位小写字母/数字/下划线 |
| 武器类型合法 | 必须是 Catalog 中已登记的 `WeaponType` |
| 刻印存在 | 必须挂在已存在的 `Inscription` 下 |
| 特点标签 1–5 个 | 卡片折叠态只显示这几个 |
| 宝藏顺序有意义 | `treasureOrder` 顺序即拾取优先级，**有序**，不可重复 |
| 深度标记只用内部值 | `t ∈ {S,R,1,2}`，**永不返回给客户端 UI** |
| 版本必填 | `gameVersion` 形如 `1.0.1.3`，用于过期提示 |

**值对象**（不可变，自带校验）：

```
BuildId          id 格式校验
WeaponType       THW/SHW/STAFF/DB/BOW/FD/GUN/PL/KA
InscriptionRef   { id, name }
TreasureOrderItem{ treasureId, name, rarity, depth }   ← depth 内部用
GearChoice       { itemId, tag: 核心|毕业|过渡|可选 }
Resonance        { code: "2-1-2", nodes: [] }
BuildStatus      DRAFT | REVIEWING | PUBLISHED | ARCHIVED
```

### 3.2 Submission（聚合根）

```
Submission
├─ id, buildId, author, contact
├─ payload（完整流派数据）
├─ files（截图）
├─ status: PENDING | APPROVED | REJECTED
├─ reviewNote, reviewedAt
└─ 方法：approve(reviewer) / reject(reason)
```

**不变量**：只有 `PENDING` 能被审核；`approve` 时必须通过领域校验才能产出 `Build`。

### 3.3 DataPackage（聚合根）

```
DataPackage
├─ version: "1.0.1.3-r2"      ← 游戏版本 + 修订号
├─ gameVersion
├─ fileUrl, fileHash(sha256), size
├─ notes, publishedAt
└─ 不变量：version 递增；hash 与实际内容一致
```

发布流程是一个**领域服务**：`PackageAssembler` 收集已发布流派 → 序列化 → 计算 hash → 产出新版本。

---

## 四、仓储接口（domain 定义，infra 实现）

```js
// domain/builds/build-repository.js
class BuildRepository {
  async findById(id) {}
  async listPublished({ weaponType, inscriptionId, sort }) {}
  async save(build) {}
  async archive(id) {}
}

// domain/catalog/catalog-repository.js
class CatalogRepository {
  async weaponTypes() {}
  async inscriptions() {}
  async treasures() {}
  async schools() {}
}

// domain/packages/package-repository.js
class PackageRepository {
  async latest() {}
  async save(pkg) {}
}

// domain/submissions/submission-repository.js
class SubmissionRepository {
  async pending() {}
  async save(submission) {}
  async findById(id) {}
}
```

**两种实现**：

| 实现 | 场景 |
|---|---|
| `infrastructure/persistence/json/*` | 现在就能跑、无依赖、方便调试 |
| `infrastructure/persistence/prisma/*` | 有数据库后切换，接口不变 |

切换点只在启动文件里选哪一种，用例代码零改动。

---

## 五、领域事件

| 事件 | 谁发布 | 谁订阅 |
|---|---|---|
| `BuildPublished` | 审核通过 | 发布上下文（标记数据需要重新打包） |
| `PackagePublished` | 发布用例 | 日志 / 通知 |
| `SubmissionRejected` | 审核用例 | 日志 |

现在用**进程内事件总线**（十几行代码）就够，不要上消息队列。

---

## 六、用例清单

| 用例 | 输入 | 输出 | 权限 |
|---|---|---|---|
| `ListBuilds` | 筛选条件 | 卡片列表（分页） | 公开 |
| `GetBuild` | buildId | 详情（8 区块） | 公开 |
| `GetCatalog` | — | 武器 / 刻印 / 宝藏 / 标签字典 | 公开 |
| `GetLatestPackage` | — | 版本 + hash + 下载地址 | 公开 |
| `SubmitBuild` | payload + 作者信息 | submissionId | 公开（限流） |
| `ReviewSubmission` | id + 通过/驳回 + 备注 | 审核结果 | 管理员 |
| `RateBuild` | buildId + 分数 + 指纹 | 平均分 | 公开（防刷） |
| `PublishPackage` | 备注 | 新版本号 | 管理员 |
| `ImportCatalog` | wiki 快照 | 变更摘要 | 运维脚本 |

---

## 七、数据库 Schema（草稿）

```sql
-- 图鉴：只读为主，采集器写入
weapon_type(id, code, name, forms jsonb, note, sort)
inscription(id, weapon_type_code, name, effect, icon, sort)
treasure(id, name, rarity, classify_id, depth, icon, game_version)      -- depth 仅内部
school(id, code, name, kind)                                            -- 宝物流派分类 30 条
catalog_version(id, game_version, imported_at, source_snapshot)

-- 流派：聚合根
build(id, name, weapon_type_code, inscription_id, author, status, rating, votes,
      game_version, payload jsonb, created_at, updated_at)
build_version(id, build_id, version, payload jsonb, note, created_at)

-- 投稿
submission(id, build_id, author, contact, payload jsonb, files jsonb,
           status, review_note, created_at, reviewed_at)

-- 评分
rating(id, build_id, score, voter_key, created_at, unique(build_id, voter_key))

-- 发布
data_package(id, version unique, game_version, file_url, file_hash, size, notes, published_at)

-- 资产
asset(id, kind, filename, url, hash, size, created_at)
```

关键设计：**`build.payload` 存整条流派数据（JSONB）**，而不是把 8 个区块拆成十几张表。

理由：
- 客户端消费的是整条记录，拆表只会增加 join 和映射成本
- 区块字段还在演进，拆表会让迁移成本爆炸
- 需要索引的只有 `status` / `weapon_type` / `inscription` 这几列，单列出来即可

---

## 八、防腐层：wiki 采集器

外部的 wiki 模块格式**绝不能**泄漏进领域模型。

```
infrastructure/sources/wiki/
├─ wiki-client.js      只管 HTTP + 限流 + 重试
├─ lua-table.js        Lua 表 → JS 对象（子集解析）
└─ wiki-mapper.js      wiki 字段 → 领域值对象（校验在这里）
```

映射器示例职责：

| wiki 值 | 领域值 |
|---|---|
| `ItemType.PassiveProps = '宝藏'` | `TreasureKind.PASSIVE_PROPS` |
| `PassivePropsClassifyDepth.Root = '根级'` | `ClassifyDepth.ROOT`（仅内部排序用） |
| `ItemRareType.Legend = '传奇'` | `Rarity.LEGENDARY` |

**任何 wiki 里的中文展示文本都不直接进数据库**，先映射成枚举，展示文案由客户端决定。

---

## 九、落地顺序

| 阶段 | 内容 | 可验证结果 |
|---|---|---|
| **P1** | 领域模型 + 仓储接口 + JSON 实现 + 用例 + HTTP 路由 | `npm start` 起服务，`/api/builds` 返回种子数据（当前种子已清空，测试用 fixture），**不连数据库** |
| **P2** | wiki 采集器 + Lua 解析 + catalog 落地 | `node scripts/fetch-wiki.js` 产出 `data/catalog/*.json` |
| **P3** | 客户端去 mock，改读 catalog + catalog 图标 | 界面上的武器/刻印/宝藏全部来自真实数据 |
| **P4** | 切 PostgreSQL，投稿与审核跑通 | 投稿 → 审核 → 发布 → 客户端更新 |

**P1 是关键**：先把边界立住（domain 不依赖 IO），后面 P2/P4 才不会返工。
