# njtech-lib — 南工大图书馆登录体系全解

[![ci](https://github.com/youngestdriver/njtech-lib/actions/workflows/ci.yml/badge.svg)](https://github.com/youngestdriver/njtech-lib/actions/workflows/ci.yml)

本目录完整记录 2026-08-14/15 会话探索到的**全部登录体系知识**。任何新会话只读本目录即可完全理解并复现整个登录流程，无需原始对话上下文。

## 自动化流水线

推送到 `worktree-*` / `feat/*` 分支 → 自动开 PR（automerge 标签）→ CI（69 tests + tsc）→ 绿灯后 merge-bot 自动合并。

## 系统拓扑

```
浏览器
  │
  ├─ vpnlib.njtech.edu.cn ............ 山石网科(Hillstone) SSL VPN enlink 网关
  │     ├─ openresty 前置网关
  │     ├─ /enlink/sso/login 登录页（5种登录方式，SSO 为主）
  │     ├─ /enlink/ ensclient SPA（登录后应用门户，113 个应用）
  │     └─ api/getTunnelState 等 Spring Boot 服务（本地 agent 127.0.0.1:18999）
  │
  ├─ u.njtech.edu.cn ................. 智慧南工（统一身份 OAuth 门户，转发层）
  │     └─ /oauth2/authorize → 302 转发到 sfgl CAS
  │
  ├─ sfgl.njtech.edu.cn ............... 南工大 CAS（linkid 平台定制，本体系核心）
  │     ├─ /cas/login 登录页（croypto+flowkey+验证码）
  │     ├─ /cas/protected/rest/login ★免验证码登录通道
  │     └─ /cas/oauth2.0/* OAuth2 端点（发 OC- 授权码）
  │
  └─ seat.njtech.edu.cn ............... 图书馆座位预约（公网直连可达，无需VPN）
        ├─ phpCAS 1.3.3 + "我去图书馆"(嘉图, schId=20317)
        ├─ /index.php/* 登录状态机（★Referer 反脚本）
        └─ /index.php/graphql/ GraphQL API（选座/记录/统计）
```

**一句话链路**：vpnlib 的 SSO 按钮 → 智慧南工 OAuth → 南工大 CAS 认证 → 授权码回 enlink；座位系统独立走 phpCAS 状态机 → 智慧南工 → CAS 发 ST → 验票建立会话。

## 完整登录流程（黄金路径，逐级展开）

### 阶段一：建立 CAS SSO 会话（一次，所有系统通用）

**推荐路径：channel 登录（免验证码）**。经典表单 POST /cas/login 带验证码的完整逻辑**已于 2026-08-16 破解并实测一次成功**（全字段 + 同会话"取页→取图→提交"，详见 docs/cas.md），也可用。

```python
# 1. 访问任意 OAuth 入口, 跟随 302 到 CAS 登录页, 提取页面内嵌字段
#    GET https://u.njtech.edu.cn/oauth2/authorize?client_id=<应用的client_id>&redirect_uri=...&scope=basic&response_type=code&state=<应用的state>
#    → 302 sfgl /cas/oauth2.0/authorize → 302 /cas/login?service=...
#    登录页 HTML 中提取:
#      login-croypto   = <8字节随机密钥的base64>      (每次页面加载都不同)
#      login-page-flowkey = <uuid>_<base64(HS512 JWT)> (webflow execution)

# 2. channel 登录（关键: 密码与时间戳拼接待加密）
import time, base64, subprocess
ts = int(time.time() * 1000)
plain = f"{密码},{ts}"
key = base64.b64decode(croypto)
enc = subprocess.run(['openssl','enc','-des-ede3-ecb','-K', key.hex()*3],
                     input=plain.encode(), capture_output=True).stdout
# 注意 -K 参数是 8 字节密钥重复 3 次 (EDE3 K1=K2=K3, 即 CryptoJS.DES 语义, 2026-08-15 实测)
payload = {"username": "<学号>", "password": base64.b64encode(enc).decode(),
           "timestamp": ts, "croypto": croypto}
# POST https://sfgl.njtech.edu.cn/cas/protected/rest/login (JSON)
# → 200 {"code":200,"message":"登录成功",...}
#   Set-Cookie: SOURCEID_TGC=<JWT>   ← CAS SSO 会话凭证(Path=/cas/)
```

拿到 `SOURCEID_TGC` 后，访问任何 CAS 保护的系统时浏览器/脚本自动获得 ST，**全程无需再输密码**。

### 阶段二：进入 vpnlib 门户（图书馆 VPN）

```python
# 用带 SOURCEID_TGC 的会话重走 OAuth 链:
# GET https://u.njtech.edu.cn/oauth2/authorize?client_id=nc2Upjt6MbtO8eVD30Cq
#     &redirect_uri=https://vpnlib.njtech.edu.cn/enlink/api/client/callback/oauth
#     &scope=basic&response_type=code&state=ENLINK_OAUTH
# → 302→302→302... 自动走完:
#   cas authorize → cas login(SSO生效直接发ST) → callbackAuthorize
#   → authorize 发 code=OC-xxx → vpnlib 回调 /enlink/api/client/callback/oauth?code=...&state=ENLINK_OAUTH
#   → 302 https://vpnlib.njtech.edu.cn/enlink/#/client/app  (门户)
# 会话: ENSSESSIONID + clientInfo(base64 JSON: username/userId/loginKey/sid)
# 门户 API: POST /enlink/api/client/service/group/treeWithService {userId} → 113个应用
```

### 阶段三：进入座位预约系统（seat.njtech.edu.cn，可直连）

**关键：每一步跳转必须携带上一步 URL 作为 Referer**（seat 的反脚本机制，无 Referer 会无限 JS 自跳转）。

```python
# 步骤(每步带 Referer = 上一步URL):
# ① GET /index.php/reserve/index.html?f=h5&from_code=WwsCBVIIAQs%3D
# ② GET /index.php/index/boot.html                    (ref=①)
# ③ GET /index.php/user/login.html                    (ref=②)  → Set-Cookie: wechatSESS_ID
# ④ GET /index.php/cas/login.html?schId=20317         (ref=③)
#    → 302 https://u.njtech.edu.cn/cas/login?service=https%3A%2F%2Fseat.njtech.edu.cn%2Findex.php%2Fcas%2Flogin.html%3FschId%3D20317
# ⑤ GET 上面 URL (带 SOURCEID_TGC, ref=④)
#    → 302 sfgl CAS → SSO 生效直接发 ST → 302 回
#    seat /index.php/cas/login.html?schId=20317&ticket=ST-xxx
# ⑥ GET ticket URL (ref=⑤) → phpCAS 验票 → 302 消耗票 → boot.html
# ⑦ → 303 /web/index.html#/pages/index/index  (应用加载)
# 会话: wechatSESS_ID + PHPSESSID + Authorization(JWT)
```

### 阶段四：调用座位系统 GraphQL

```python
# POST https://seat.njtech.edu.cn/index.php/graphql/
# body: {"operationName": "<查询名>", "query": "<GraphQL语句>", "variables": {}}
# 认证: 仅靠会话 Cookie, 无额外 header

# 我的信息:   operationName=getCurrentUser
# 历史记录:   operationName=useLogs
# 当前预约:   operationName=index  (首页聚合查询: userAuth.reserve.reserve + getSToken)
# 退座:       operationName=reserveCancle, variables={"sToken": <getSToken值>}
# 图书馆列表: operationName=list
# 座位图:     operationName=libLayout, variables={"libId":<id>,"libType":0}
# 选座:       operationName=reserveSeat (mutation)
# 完整30条语句清单: artifacts/graphql-queries.md
```

## 关键坑点（必须知道）

| 坑 | 说明 |
|---|---|
| 经典表单 POST /cas/login 的验证码 | ~~6 次 OCR 全对仍被拒(1320007)~~ **已破解**：全字段集+同 SESSION 一次成功（2026-08-16）；历史失败疑为字段不全/状态不一致，非验证码问题 |
| 1320007 错误码 | 通用失败码，不区分验证码/密码（对照实验证实） |
| seat 的 Referer 检查 | 无 Referer → 无限 JS 自跳转；curl 默认不带 Referer 必踩 |
| urllib 自动跟随跳转 | 不带 Referer；seat 链路必须 NoRedirect + 手动跟随 |
| seat 会话状态机 | 状态只推进一次（如"跳转CAS"只发一次 302），重放同一请求状态已变 |
| execution/flowkey 一次性 | 登录失败后页面重新渲染新 flowkey，重试必须重取整个页面 |
| 密码传输 | CAS 前端 3DES 只是混淆（密钥同请求传输）；channel 登录密码格式是 `密码,毫秒时间戳` 一起加密 |

## 目录索引

```
README.md                    本文件 — 总览 + 黄金路径
docs/
  cas.md                     南工大 CAS 详解（加密/验证码/execution/channel登录/OAuth）
  vpnlib.md                  vpnlib 网关与 enlink 门户详解（登录方式/SSO链/门户API）
  seat.md                    座位系统详解（phpCAS状态机/GraphQL/座位语义/数据结构）
  hidden-apis.md             隐藏接口清单（linkid 平台 400+ 路径，已验证/未实测分组）
artifacts/
  graphql-queries.md         座位系统 30 条 GraphQL 语句完整清单
  app-list.json              vpnlib 门户 113 个应用（脱敏）
  api-paths.txt              enlink 51 条 API 路径
  login-page.html            vpnlib 登录页 HTML（含 SSO 配置）
  ensclient-app.js           门户主逻辑 JS
```

## 复现提示

- Python 3.9+ 纯标准库即可复现全部流程（urllib + cookiejar + openssl 命令做 3DES）
- Cookie 会话持久化用 MozillaCookieJar；注意 sfgl(CAS)、vpnlib、seat 三个域分别持有各自 Cookie
- 验证码 OCR 工具在 GitHub 仓库 `njtech-oauth/captcha-ocr/`（模板匹配，零依赖；但 seat 流程不需要它）
- 凭据不入库：本目录不含任何密码/学号/token 值
