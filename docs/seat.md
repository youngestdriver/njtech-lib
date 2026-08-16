# 座位预约系统详解（seat.njtech.edu.cn）

"我去图书馆"（嘉图 vendor，schId=20317），phpCAS 1.3.3，uni-app H5 前端，GraphQL API。**公网直连可达，无需 VPN**。

## 1. 登录状态机（完整 8 步，★Referer 是命门）

```
① GET /index.php/reserve/index.html?f=h5&from_code=WwsCBVIIAQs%3D
      → 302 /index.php/index/boot.html
② GET /index.php/index/boot.html                     [Ref: ①]
      → 303 /index.php/user/login.html               (Set-Cookie: wechatSESS_ID, FROM_CODE, FROM_TYPE)
③ GET /index.php/user/login.html                     [Ref: ②]
      → 303 /index.php/cas/login.html?schId=20317
④ GET /index.php/cas/login.html?schId=20317          [Ref: ③]  ★必须带 Referer
      → 302 https://u.njtech.edu.cn/cas/login?service=https%3A%2F%2Fseat.njtech.edu.cn%2Findex.php%2Fcas%2Flogin.html%3FschId%3D20317
      (无 Referer: 200 + 90字节 JS 自跳转死循环 — 反脚本机制)
⑤ GET u.njtech.edu.cn/cas/login?service=...          [Ref: ④]
      → 302 sfgl /cas/login?service=... (有 SOURCEID_TGC 则免登录直接发 ST)
      → 302 seat /index.php/cas/login.html?schId=20317&ticket=ST-xxx
⑥ GET ticket URL                                    [Ref: ⑤]
      → phpCAS 验票 → 302 消耗票 → /index.php/index/boot.html
⑦ boot.html → 303 /web/index.html#/pages/index/index (应用加载)
⑧ 会话建立: wechatSESS_ID + PHPSESSID + Authorization(JWT)
```

要点：
- **每步必须带上一跳 URL 作 Referer**；urllib 默认跟随跳转不带 Referer，必须 NoRedirect + 手动跟随
- 状态机单向推进（"跳转CAS"每会话只发一次 302），重放请求会拿到不同响应
- CAS 的 service 必须是 `https://seat.njtech.edu.cn/index.php/cas/login.html?schId=20317`；直接对 sfgl 发 ticket 而绕过 u.njtech 也能拿到 ST，但 seat 侧 phpCAS 验票不认（实测死循环）

## 2. GraphQL API

```
POST https://seat.njtech.edu.cn/index.php/graphql/
body: {"operationName": "<名>", "query": "<语句>", "variables": {}}
认证: 仅会话 Cookie (Authorization JWT + wechatSESS_ID)，无额外 header
introspection 被禁用 (__schema 查询返回 Request Failed)
```

关键查询（完整 30 条见 artifacts/graphql-queries.md）：

| 查询 | 类型 | 用途 |
|---|---|---|
| getCurrentUser | query | 我的信息（昵称/学号/姓名/头像/封禁状态/sch） |
| useLogs | query | 历史学习记录（时间/座位/时长） |
| index | query | 首页聚合：当前预约 reserve.reserve + 退座凭证 getSToken（见 artifacts，实测 2026-08-15） |
| list | query | 全部图书馆+实时统计（seats_total/used/booking） |
| libLayout(libId,libType) | query | 座位图（每座 x/y/key/type/seat_status/status） |
| libRule(libId) | query | 预约规则（开放时间/续约/暂离时长） |
| reserveSeat(libId,seatKey,captcha...) | mutation | 选座（**前端实际调用的是拼写错误变体 `reserueSeat`**，2026-08-15 实测） |
| captcha | query | 选座验证码（顶层字段 `captcha{code,data}`，data 为图片）；仅当空验证码选座被拒（错误码 1000）时才需要 |
| reserveCancle(sToken) | mutation | 退座；sToken 取 index 查询的 getSToken 值 |
| reserveHold / reserveHoldConfirm / reserveMarkCancle | mutation | 暂离/确认/取消标记 |
| oftenseat | query | 常用座位 |
| tongJi | query | 时长统计（排名/累计/今日） |

## 3. 数据结构语义（实测）

### 座位（libLayout.seats[]）
- `seat_status`: `1`=空闲可预约、`3`=占用中、`0`=非座位（桌/装饰物）；`status`(bool) 与 seat_status=3 一致
- `type`: `1`=真实座位、`2`=桌面/过道、`8`=服务台、`3`=装饰
- `key` 格式 `"y,x"`（如 `"4,15"`），选座 mutation 的 seatKey 用它
- `name` 为座位号（字符串）；type≠1 时 name=None

### 图书馆（list.libs[]）
- `lib_id` 关键值：122797=一楼大厅、122811=新书借阅室、122818=二楼大厅、122825=自科一、122832=社科三、122846=四楼A区（完整列表可随时用 list 查询拉取）
- `is_open` 开闭馆；`lib_type` 均为 0（朗读亭也 type=0 但 lib_id 不同段）

### 我的信息（getCurrentUser）
```
user_id, user_nick, user_mobile(脱敏), user_sex, user_sch, user_last_login(时间戳),
user_avatar(size: MIDDLE), user_adate, user_student_no, user_student_name,
area_name, user_deny{deny_deadline}, sch{sch_id, sch_name, activityUrl, isShowCommon}
```

### 历史记录（useLogs）
```
created_time, created_time_f(格式化), time_range(秒), seat_name_with_lib, study(格式化时长文本)
```

## 4. 实测记录（2026-08-15）

- 一楼大厅 12 座：3 占用（1/7/10号）、9 空闲，布局 3列×4行 + 服务台(type=8)
- getCurrentUser / useLogs / list / libLayout 均已实测调用成功
- 前端 JS 分块：主 bundle index.4ec8ae39.js；页面 chunk 映射（name→hash）在主 bundle 内，如 pages-index-index→fbeee39d、pages-personal-log→0a02d80b；chunk 命名 `pages-<name>.<hash>.js`，全部可从 /web/static/js/ 直接下载
- GraphQL 查询语句全部内嵌在各 chunk 的查询映射模块中（双引号字符串，`"query xxx {...}"` 格式）
- **退座实测（同日）**：channel 登录 → 8 步状态机全程脚本化成功（ticket 在链式 302 中自动消耗：`ticket=ST-xxx` → 302 去参 `cas/login.html?schId=20317` → 303 boot.html → 303 `http://web/index.html#/pages/index/index?r=<ts>` → **301 https** → 200 应用页）。reserveCancle(sToken=getSToken) 返回 `{timerange,img,hours,mins,per}` 统计后，复查 `reserve.reserve==null` 确认退座生效
- **getSToken 语义**：每次 index 查询返回新值（退座成功后复查仍返回非空新值）——是会话级动态 token 而非预约绑定；"无进行中预约"的唯一可靠判据是 `reserve.reserve == null`
- **选座实测（同日）**：`reserueSeat({libId,seatKey,captchaCode:"",captcha:""})` 空验证码一次成功（开馆时段免验证码；返回 `{"reserueSeat": true}`，复查 `reserve.reserve` 状态 status=3）。前端逻辑：空验证码被拒（错误码 1000）才弹验证码框 → `captcha` 查询拿 `{code,data}`（data 图片）→ 重发 `captchaCode=识别码, captcha=captcha.code`。验证码流程尚未实测（未触发）

## 5. 反脚本机制清单

1. **Referer 检查**（cas/login.html）：无 Referer → 90字节 JS 自跳转死循环
2. **状态机单向**：每会话每个状态只推进一次
3. **phpCAS 验票**：必须经 u.njtech.edu.cn/cas 链路拿票
4. GraphQL introspection 关闭
5. 未认证 boot.html 一律 303 到登录（无信息泄漏）
