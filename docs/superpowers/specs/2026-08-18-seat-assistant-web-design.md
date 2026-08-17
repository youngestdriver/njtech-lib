# 南工大图书馆选座助手 — 前端设计文档

日期：2026-08-18
状态：已与用户逐节确认

## 背景与目标

Plan 1（后端 `server/`，API 契约已定稿并实测）之上构建前端 `web/`：
可视化座位图、选座/退座、多账号管理（含验证码恢复）。仅通过后端 REST API 交互，不直接接触 seat 服务器。

后端 API 契约（前端只对接这些）：
```
GET  /healthz
POST /api/auth/login                     {password} → {token}
GET  /api/accounts
POST /api/accounts                       {username, password, alias?}
DELETE /api/accounts/:id
POST /api/accounts/:id/reauth            → {ok:true}
POST /api/accounts/:id/login-captcha     {captchaCode} → {ok:true}
GET  /api/accounts/:id/current           → {reserve, getSToken}
GET  /api/seats/libraries/:libId/layout?accountId= → SeatMapDto
POST /api/reserve                        {accountId, libId, seatKey} → {ok:true} | {needCaptcha, imageData, captchaToken} | {ok:false, message}
POST /api/reserve/captcha                {accountId, libId, seatKey, captchaToken, code}
POST /api/reserve/cancel                 {accountId} → {ok:true} | {ok:false, message}
```
SeatMapDto：`{libId, libName, isOpen, libFloor, seatsTotal, seatsUsed, seatsBooking, maxX, maxY, seats: [{x, y, key, type, name, seatStatus}]}`

## 已确认决策

| 决策点 | 选择 |
|---|---|
| 技术栈 | Vite + Vue 3 + Element Plus |
| 导航形态 | 单页 Tab（无路由库） |
| 集成方式 | 开发：Vite dev 代理 `/api` → 后端；生产：后端 Fastify 静态托管 `web/dist` |
| 状态管理 | 无 Pinia，视图局部状态 + 事件刷新（YAGNI） |
| 座位图渲染 | Canvas 自绘（真实数据即坐标网格，不引第三方图库） |
| 项目位置 | 当前仓库 `web/` |

## §1 页面结构与交互流

```
App.vue（未登录 → 访问密码门；已登录 → Tab 导航）
├── Tab「座位图」 SeatMap.vue
│     ├─ 顶部：账号选择器（下拉） + 图书馆选择器（下拉）
│     │        + 实时统计条（总/占用/预约）+ 刷新按钮
│     ├─ 中间：SeatCanvas.vue（Canvas 座位网格）
│     └─ 交互：
│         • 点空闲座位 → 选中高亮 → 弹确认「选座？」
│         → POST /api/reserve → 成功刷新画布 + 顶部提示「已选座 X」
│         → 返回 needCaptcha → 弹 CaptchaDialog（图片+输入）→ POST /api/reserve/captcha
│         → 返回错误 → ElMessage 展示后端 message
├── Tab「账号管理」 Accounts.vue
│     ├─ 账号列表（ElTable）：别名/学号/状态徽章(active 绿/needs-captcha 橙/failed 红/pending 灰)
│     │        + 最近保活时间 + 最近错误(tooltip) + 操作列
│     ├─ 操作列：
│     │     • 状态 needs-captcha → 「验证码恢复」→ CaptchaDialog → POST login-captcha
│     │     • 其它状态 → 「重登」→ POST reauth
│     │     • 「删除」→ 确认弹窗 → DELETE
│     └─ 添加账号：表单（学号/密码/别名）→ POST /api/accounts → 状态反馈
└── Tab「当前预约」 Current.vue
      ├─ 账号选择器 + 查询按钮 → GET /api/accounts/:id/current
      ├─ 有预约：座位信息卡片（图书馆/座位号/到期时间/状态）+ 退座按钮（确认弹窗）→ POST /api/reserve/cancel
      └─ 无预约：空态提示
```

关键交互规则：
1. 所有写操作（选座/退座/添加/删除/重登）成功后自动刷新对应列表/画布
2. 验证码流程统一走 CaptchaDialog（选座 1000 错误、needs-captcha 恢复共用）
3. 401（token 过期）→ 全局清除 token 回登录门

## §2 座位图渲染（SeatCanvas）

```
props: { map: SeatMapDto }        // 输入
emit:  click-seat(seat)           // 点击空闲真实座位

渲染规则:
  Canvas 尺寸 = cellSize(40px) * (maxX+1) 宽 × (maxY+1) 高
  坐标映射: 座位 (x,y) → ((x+1)*cell, (y+1)*cell) 中心, 半径 14px 圆
  （+1 偏移留边距; DTO 已拆独立 x/y, 原站 key "y,x" 不直接用）
  着色（type 优先）:
    type=1 真实座位: seatStatus=1 空闲→绿; 3 占用→红; 其它→灰
    type=2 桌面 / 8 服务台 / 3 装饰: 淡灰填充矩形（不可点）
  选中态: 边框高亮 + 放大 1.2x（本地状态）
  座位号: 座位中心绘制 name（白字, 占用红底上可读）
  缩放: 画布超容器 → CSS transform: scale() 适配（不重绘）

交互:
  mousedown → hit-test（距离 < 半径*1.5）命中 type=1 且 seatStatus=1 → emit('click-seat')
  Hover: 空闲座高亮描边 + tooltip 座位号

测试（fixture 4 座）:
  - 空闲座 (3,4) 中心像素绿 (r<g); 占用座红 (r>g); 桌面/服务台灰
  - 点击空闲 emit; 点击占用/装饰不 emit
  - 宽画布窄容器 → 根元素 transform scale
```

## §3 数据流与错误处理

数据流：无状态库，每视图局部状态 + 写操作成功后重新拉取（layout/accounts/current）。

api/client.ts 封装：
```
request(path, {method, body}) → 自动 Authorization: Bearer <token>
  200 → JSON
  401 → 清 token + 全局事件 'auth-expired' → 回登录门
  4xx → {status, message: body.error ?? body.message ?? '请求失败'}
  网络错误 → {message: '无法连接后端'}
```

错误处理矩阵：

| 场景 | 表现 |
|---|---|
| 登录密码错 | 登录门 ElMessage 错误 |
| token 过期(401) | 全局回登录门 + "登录已过期" |
| 选座被占/业务错 | ElMessage 展示后端 message |
| 选座需验证码(1000) | CaptchaDialog 弹窗 → POST /api/reserve/captcha；取消 → 清选中 |
| needs-captcha 账号 | 橙徽章 + 「验证码恢复」按钮 |
| failed 账号 | 红徽章 + lastError tooltip；刷新重拉 |

测试：
- api/client.ts 单测（fetch mock）：token 注入 / 401 清除 / 错误解析
- SeatCanvas.vue 组件测试：像素断言 + 交互（§2）
- Accounts.vue 组件测试（fetch mock）：列表/徽章/删除确认/添加表单
- CaptchaDialog.vue：确认 emit {code}
- 不做端到端浏览器测试（M1 范围外，手动 smoke）

## §4 工程配置与后端集成

web/ 工程：package.json（vue3 + element-plus + vite + vitest + @vue/test-utils）、vite.config.ts（dev 代理 /api → http://127.0.0.1:8791）、tsconfig.json（strict）、index.html（「南工大选座助手」）。

后端集成（新任务）：
- @fastify/static 挂载 web/dist 于 /
- SPA fallback：非 /api/ 路径 → index.html
- 仅当 web/dist/index.html 存在时注册（开发模式后端无产物则跳过）

验收标准（M1 完成定义）：
1. `npm run dev`（web/）→ :5173 代理后全部 API 可用
2. 登录门 → 添加账号（真凭据）→ active
3. 座位图 Tab → 选馆 → Canvas 渲染真实 173 座 → 点选/退座全流程
4. 账号管理 Tab → 徽章/重登/删除可用
5. `vite build` → 后端 :8791 直接访问完整应用
6. CI 通过（前端 vitest + 既有后端测试）

## 范围外（M2+，另行规划）

自动抢座/定时预约、通知推送、账号批量导入、端到端浏览器测试。
