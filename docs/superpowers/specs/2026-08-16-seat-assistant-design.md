# 南工大图书馆选座助手 — 设计文档

日期：2026-08-16
状态：已与用户逐节确认

## 背景与目标

基于本仓库积累的登录体系知识（CAS channel/表单登录、seat 8 步状态机、GraphQL 语句库），构建一个选座助手：

1. 可视化查看当前座位图
2. 像原站一样选座、退座
3. 管理少量账号（2~5 个），多账号鉴权保活
4. 其余功能（自动抢座、通知等）预留扩展位，不在本期范围

## 已确认决策

| 决策点 | 选择 |
|---|---|
| 产品形态 | Web 应用 |
| 账号规模 | 少量（2~5 个），个人用途 |
| 凭据存储 | 本地加密存储（AES-256-GCM，主密钥不落库） |
| 技术栈 | Node/TypeScript 全栈：Fastify 后端 + Vite/Vue 3 SPA |
| 部署 | 常开设备/服务器，公网或内网访问 |
| 访问控制 | 简单访问密码（Bearer token，HMAC 签发） |
| 架构方案 | API 后端 + SPA 前端分离（方案 B） |
| 项目位置 | 当前目录 `njtech-lib/`（与知识库共存，不新开仓库） |

## §1 总体架构与组件划分

```
njtech-lib/
├── README.md                    # 现有知识库总览（保留）
├── docs/                        # 现有知识库（保留，作为协议文档随代码演进）
├── artifacts/                   # 现有资产（保留）
├── server/                      # Node/TS API 后端（Fastify + better-sqlite3 + node-cron）
│   └── src/
│       ├── index.ts             # 启动：HTTP 服务 + 调度器 + 会话池初始化
│       ├── config.ts            # 端口、主密钥来源（环境变量/文件）、DB 路径
│       ├── auth/
│       │   ├── crypto.ts        # 3DES-EDE3（原生 des-ede3）+ AES-256-GCM（凭据加密）
│       │   ├── cas.ts           # CAS 登录链：channel 免验证码 + 经典表单(验证码)双通道
│       │   └── captcha-ocr.ts   # 模板匹配 OCR（第二阶段，Python 版移植）
│       ├── seat/
│       │   ├── state-machine.ts # 8 步 Referer 链登录状态机（NoRedirect 手动跟随）
│       │   ├── graphql.ts       # GraphQL 客户端 + 已验证语句库
│       │   └── seat-map.ts      # libLayout 原始数据 → 座位图 DTO
│       ├── accounts/
│       │   ├── store.ts         # SQLite CRUD + 加密凭据读写
│       │   ├── session-pool.ts  # 每账号独立 cookie jar + 会话状态
│       │   └── locker.ts        # 每账号互斥锁（选座/退座/保活不并发打同一账号）
│       ├── keepalive/
│       │   ├── scheduler.ts     # node-cron 周期探测
│       │   └── reauth.ts        # 失效→重登流程（channel 优先，表单兜底）
│       └── api/                 # REST 路由 + 访问密码中间件
├── web/                         # SPA 前端（Vite + Vue 3）
│   └── src/
│       ├── pages/               # 座位图 / 账号管理 / 我的预约
│       ├── components/          # 座位网格 Canvas、账号状态卡片
│       └── api/                 # 类型化 API client
└── .gitignore                   # node_modules / server/data(含DB) 等
```

边界原则：
- `auth/` 只懂 CAS：输入凭据输出会话 cookie，不关心 seat
- `seat/` 只懂 seat 协议（状态机 + GraphQL）：输入 cookie 输出业务数据
- `accounts/` 只懂会话生命周期与存储；调度策略交给 `keepalive/`
- 前端只通过 REST 与后端交互，永远不直接碰 seat 服务器

技术选型：Fastify（TS 友好、内建 schema 校验）、Vue 3 + Vite（与 seat 原站 uni-app 同生态）、better-sqlite3（同步 API 简单可靠）、node-cron（调度）。

## §2 数据流

### 流程 1：添加账号 → 建立会话

```
UI 提交(学号+密码)
  → POST /api/accounts  {username, password}
  → store.ts 用 AES-256-GCM(主密钥) 加密密码 → SQLite 落库（明文不落盘）
  → session-pool 立即走登录链：
      CAS channel 登录（免验证码）→ SOURCEID_TGC
      → seat 8 步 Referer 状态机 → wechatSESS_ID + PHPSESSID + Authorization JWT
  → 成功: 账号状态 active；失败: 账号落库但状态 failed + 可读错误
  → 返回 {accountId, status, userInfo(从 index 查询带出)}
```

### 流程 2：座位图

```
UI: GET /api/seats/:libId/layout?accountId=x
  → 后端从会话池取该账号 cookie
  → GraphQL libLayout(libId, libType=0)
  → seat-map.ts 转换: 原样坐标 {max_x, max_y, seats[{x,y,key,type,name,seat_status}]}
  → 前端 Canvas 按 (x,y) 画网格: type=1 真实座位(空/占用着色)、2桌面、8服务台、3装饰
  → 点选座位 = 前端选中态，调流程 3
```

### 流程 3：选座 / 退座（走每账号互斥锁）

```
选座: POST /api/reserve {accountId, libId, seatKey}
  → locker 拿账号锁
  → reserueSeat mutation（captchaCode:"", captcha:"" 先试）
  → 成功 → 返回 + 前端刷新
  → 错误码 1000（要验证码）→ 第一阶段: 返回 428 需验证码状态 + captcha 图片(服务端代取)
    → 前端弹出图片输入框 → 用户输入 → 重试 mutation
    （第二阶段: captcha-ocr.ts 自动识别，用户输入仅作兜底）

退座: POST /api/reserve/cancel {accountId}
  → index 查询取 getSToken → reserveCancle(sToken)
  → 复查 index 确认 reserve==null → 返回结果
```

### 流程 4：保活

```
scheduler 每 N 分钟（默认 10，可配）对每个 active 账号:
  → 轻探测: index GraphQL 查询
  → 正常 → 更新 lastOk 时间戳，UI 显示"保活中"
  → 失效（鉴权错误/401）→ reauth.ts:
      CAS channel 重登 → seat 状态机重走 → 新会话入库
      channel 被风控(captchaInvisible) → 第一阶段降级: 账号标 needs-captcha，
        UI 提示用户输入验证码完成重登（第二阶段接 OCR 全自动）
  → 重登失败连续 3 次 → 状态 failed + UI 告警
```

保活待实测参数（设计为配置项，实施时实测定值）：CAS TGC 有效期、seat Authorization JWT 有效期。
并发规则：同一账号的选座/退座/保活重登互斥（locker），不同账号完全并行。

## §3 数据存储与凭据加密

SQLite（`server/data/app.db`，单文件，不随代码入库）：

```sql
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,      -- 学号
  password_enc TEXT NOT NULL,            -- AES-256-GCM(主密钥) 密文: iv.tag.ciphertext (base64)
  alias       TEXT,                      -- UI 显示名
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending / active / needs-captcha / failed
  last_ok_at  INTEGER,                   -- 最近一次保活探测成功时间
  last_error  TEXT,                      -- 最近错误（可读文案）
  created_at  INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- 主密钥文件路径、保活周期、访问密码哈希等
);
```

- 密码只存密文。主密钥：环境变量 `NJ_SEAT_MASTER_KEY`（推荐）或密钥文件路径（settings 配置）；服务启动时读取，缺失拒绝启动——延续"凭据不入库"原则
- 会话 cookie 不落盘：每账号 cookie jar 只在内存（session-pool），服务重启即全量重登。保活靠重登而非持久化会话，避免有效 token 写入磁盘
- 账号删除 → 级联清理内存会话 + SQLite 行删除
- DB 与 node_modules、日志一起进 .gitignore

访问密码：

- 前端所有 API 走中间件：`Authorization: Bearer <token>`；token = 访问密码的 HMAC 签名（防明文重放）
- 启动时未设置访问密码则拒绝启动
- 登录成功签发带过期时间的 token（默认 7 天），前端存 localStorage

## §4 错误处理、状态机与并发

账号状态机（每账号一个，UI 直接映射）：

```
pending ──登录成功──▶ active ──探测失效──▶ (reauth) ──成功──▶ active
   │                    │                      │失败N次
   │登录失败            │操作/探测遇验证码      ▼
   ▼                    ▼                   failed
 failed            needs-captcha ──用户输入/OCR成功──▶ active
```

- 每个状态转换带 `last_error` 可读文案，UI 显示对应操作按钮
- 任何账号失败不影响其它账号（隔离在 session-pool 每账号条目内）

错误分类与处理：

| 类别 | 例子 | 处理 |
|---|---|---|
| 协议错误 | Referer 链中途非预期响应、302 断链 | 丢弃该账号会话状态，全链重走（幂等，最多 2 次） |
| 业务错误 | 1320007、座位被占、退座无预约 | 如实透传给 UI，不自动重试（避免误操作） |
| 风控 | captchaInvisible=true、错误码 1000 | 转验证码流程；OCR 阶段二前由用户输入兜底 |
| 网络错误 | 超时、连接失败 | 指数退避重试（1s→2s→4s，封顶 3 次），保活探测失败也退避，避免频繁打对方服务 |

并发与幂等：

- 锁粒度 = 账号：内存 `Map<accountId, mutex>`；选座/退座/保活重登互斥；不同账号并行
- 写操作先验状态再执行（如退座前先查 reserve != null）；请求带 requestId，前端超时重试不会重复退座（"先查后做"保证幂等）
- GraphQL 调用统一封装：超时、错误解析、日志脱敏（cookie 值只记前 8 字符）

## §5 测试策略

| 层 | 内容 | 方式 |
|---|---|---|
| 单元 | 3DES 与已捕获明密文对拍（crypto.ts）、AES-GCM 加解密往返、OCR 与 Python 版输出对拍、Referer 状态机跳转表 | vitest |
| 集成 | node 内置 http 起 mock CAS + mock seat（按 docs/ 录制的真实响应序列重放）→ 跑全链登录/选退座/保活失效重登 | vitest + mock server |
| 端到端 smoke | 连真实系统：登录→查座→选座→退座（手动触发，不自动跑，避免无谓打扰对方服务） | 独立脚本 |
| 前端 | 座位图渲染（固定 fixture 的 libLayout 数据）、账号状态卡片 | vitest + 组件测试 |

不测试真实系统的响应细节（对方服务不是测试环境）；协议变化靠 smoke + 文档跟进。

## §6 里程碑与范围

- **M1（本 spec 范围）**：后端核心四模块 + REST API + 访问密码；前端三页（座位图可点选、账号管理、选退座）；保活基础版（探测 + 重登，验证码场景走用户手动输入兜底）
- **M2（预留，另行 spec）**：captcha-ocr.ts 移植（Python 模板匹配 → TS）接入自动重登；保活周期按实测 TGC/JWT 有效期调优
- **明确不做**（YAGNI，将来再说）：自动抢座/定时预约、通知推送、账号批量导入
