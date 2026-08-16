# vpnlib 网关与 enlink 门户详解（vpnlib.njtech.edu.cn）

图书馆数字资源入口的 SSL VPN 网关。方法：只读 HTTP 探测 + 一次真实 SSO 登录。

## 1. 架构

```
openresty 网关 (302页脚 center>openresty)
  ├─ /enlink/ ......... ensclient SPA (Vue, 登录后 VPN 客户端门户)
  │    ├─ /enlink/static/js/app.*.js ... 客户端逻辑(47KB, artifacts/ensclient-app.js)
  │    ├─ /enlink/api/client/* .......... JSON API (envelope: code/messages)
  │    ├─ /enlink/sso/login ............. 登录页 (山石网科 enlink SSO)
  │    └─ /enlink/static/download/ ...... 客户端下载中心
  ├─ api/getTunnelState 等 .............. 独立 Spring Boot 服务 (本机 agent 127.0.0.1:18999 转发)
  └─ 登录后 → 113 个应用 (web应用走 webvpn URL 重写, 隧道类走本地 gate-local 127.0.0.1:8081)
```

- 会话 Cookie：`GUESTSESSIONID`（网关访客）、`ENSSESSIONID`（enlink 登录会话）、`clientInfo`（base64 JSON：username/userId/loginKey/sid）
- 服务模式：SDP（`api/client/user/v2/serviceConf` → `{"from":"sso","serviceMode":"sdp"}`）

## 2. 登录方式（/enlink/sso/login）

| 方式 | 接口 | 说明 |
|---|---|---|
| **SSO 登录**(主) | 跳转 u.njtech.edu.cn/oauth2/authorize | 见 §3 |
| 账号密码 | POST /enlink/sso/login/submit | AES-128-CBC 密码（key=`kyEqiDXY4TCXjcUV`、iv=key反转，内嵌登录页）；GVerify 图形码纯前端自校验 |
| 短信验证码 | POST /enlink/sso/login/verifyCode | 发码前 jigsaw 拼图滑块（成功回调仅前端事件，无服务端凭据校验） |
| 企业微信扫码 | api/client/user/enApp/showQrCode + sso/login/enApp/qrResult 轮询 | |
| 宁盾动态码 | POST /sso/login/ningdun | |

## 3. SSO 链路（实测）

```
① 登录页点"SSO登录" (ssoConf.url)
   → https://u.njtech.edu.cn/oauth2/authorize
     ?client_id=nc2Upjt6MbtO8eVD30Cq
     &redirect_uri=https://vpnlib.njtech.edu.cn/enlink/api/client/callback/oauth
     &scope=basic&response_type=code&state=ENLINK_OAUTH   ← state 为静态字符串(弱CSRF)
② 302 → sfgl /cas/oauth2.0/authorize (同参数)
③ 302 → /cas/login?service=...callbackAuthorize... (统一身份认证, 见 cas.md)
④ 用户认证(或已持 SOURCEID_TGC 则免登录) → ST
⑤ callbackAuthorize → authorize 发 code=OC-xxx
⑥ 302 → vpnlib /enlink/api/client/callback/oauth?code=...&state=ENLINK_OAUTH
⑦ enlink 服务端换身份 → Set ENSSESSIONID → 302 /enlink/#/client/app (门户)
```

## 4. 门户 API（登录后，均需 ENSSESSIONID）

统一 envelope：`{"code":"200","messages":"OK","data":...}`；未认证 → `code 1000 已超时`。

| 接口 | 用途 |
|---|---|
| POST /api/client/service/group/treeWithService `{nameLike,serviceNameLike,userId}` | 应用树（userId 从 clientInfo cookie 解码；缺 userId → code 2000） |
| GET /api/client/user/findByUserId/{id} | 用户信息 |
| GET /api/client/notice/message/noReadTotal | 未读消息数 |
| GET /api/client/user/v2/serviceConf | 服务模式配置 |
| GET /api/client/service/icon/all | 应用图标 |
| POST /api/client/service/v2/open/{id} | 打开应用（web 类返回 urlPlus webvpn 重写地址） |
| 其余 46 条 | 见 artifacts/api-paths.txt（用户中心/设备/审计/认证TOTP/隧道） |

应用树结构：`data.children[]`（分组节点，字段 title/key/serviceList）+ `serviceList[].{id,name,server,gatewayVo,urlPlus,useTunnel,type}`。

## 5. 安全观察（仅记录，勿滥用）

1. SSO state 静态字符串 `ENLINK_OAUTH`
2. 账号密码 AES 密钥/IV 内嵌登录页（形同虚设）
3. GVerify 前端自校验、jigsaw 成功无服务端凭据
4. 未认证 API 全部 code 1000 拦截；仅 diy/getTemplate 返回 400（行为略异）
