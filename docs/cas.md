# 南工大 CAS 详解（sfgl.njtech.edu.cn）

统一身份认证平台，linkid 平台定制版 Apereo CAS。所有系统（办事大厅、vpnlib、座位预约）的最终认证点。

## 1. 登录页组成（GET /cas/login）

服务端渲染 HTML，内嵌三个关键元素（每次加载都重新生成）：

| 元素 | 格式 | 用途 |
|---|---|---|
| `login-croypto` | base64(8字节随机密钥) | 前端 3DES 加密密码的密钥 |
| `login-page-flowkey` | `uuid_base64(完整JWT)` | webflow execution（提交时的 execution 字段） |
| `login-error-msg` | `<div class="alert alert-danger"><span>错误码</span>` | 失败提示（注意元素带 class，正则匹配需兼容） |

动态加载链：`loginNew.js`（横竖屏检测+配置）→ `deploy.js`（加载 SPA 资源）→ `caspagehash.js` → Angular SPA（cas-login bundle）。全部静态资源从 `/gate/public/` 提供。

认证方式：UsernamePassword（用户名密码）/ smsLogin（短信）/ corpwechatQr（企业微信扫码）。

## 2. 密码加密（已实测验证）

```javascript
// deploy.js / cas-login-main.js
desEncrypt(key, content) {
  const keyHex = CryptoJS.enc.Base64.parse(key);   // key = croypto
  return CryptoJS.DES.encrypt(content, keyHex, {
    mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7
  }).toString();                                    // base64 输出
}
```

**CryptoJS.DES = 3DES-EDE3（8字节密钥重复3次）+ ECB + Pkcs7**。

openssl 等价命令：
```bash
openssl enc -des-ede3-ecb -K <croypto解码后的hex>  # 输入明文密码, 输出密文
```

已用 HAR 明密文对验证过（HAR 已删除，勿再存明文凭据）。

**经典表单 POST /cas/login 字段**（application/x-www-form-urlencoded，**2026-08-16 实测一次成功**）：

```
username        学号
passwordPre     明文密码（表单可见字段直接提交）
password        base64(3DES-EDE3-ECB(裸密码, key=croypto))   ← JS 提交时动态追加的隐藏字段
croypto         页面内嵌值（JS 动态追加）
captcha_code    验证码（OCR 结果）
type=UsernamePassword  _eventId=submit  geolocation=（空）
execution       <login-page-flowkey>
```

- 表单 `<form method="post">` **无 action** → POST 到当前页面 URL（保留 `?service=` 查询串）
- 完整字段集缺一不可（历史 6 次 1320007 失败疑与字段不全/状态不一致有关，全字段+同会话严格顺序可稳定复现成功）
- 成功响应：302 → service 回调带 `ticket=ST-xxx`，并 **Set-Cookie: SOURCEID_TGC**（JWT，SSO 会话）

## 3. execution 令牌

`login-page-flowkey` = `uuid_` + base64(完整JWT)。JWT 头 `{"alg":"HS512"}`，payload 是 **1840 字节加密二进制**（加密序列化的 flow 状态），无法伪造/修改，只能原样回传，一次性使用（失败后页面重新生成新 flowkey）。

## 4. 验证码

- 接口：`GET /cas/api/captcha/generate/DEFAULT` → 160×70 RGBA PNG（需要 /cas/ 路径的 SESSION cookie）
- 特征：4 字符（约 16~20 符号集）、固定蓝 (25,60,170)、straight alpha（随机 alpha 不影响 RGB）、渲染确定性（同码同图）
- 干扰线 R≥100 与文字 R<100 可用颜色掩码分离
- 其它类型参数（NUMBER/GIF/ARITHMETIC/CHINESE）全部 500，仅 DEFAULT 注册
- 池子规模估算 6~8 万张（1000 样本 6 次重复）
- OCR 方案见 GitHub 仓库 `njtech-oauth/captcha-ocr/`（模板匹配，30 张留出验证 100%）
- **✅ 已破解（2026-08-16）**：此前"OCR 全对仍被拒（1320007）"之谜已解——完整字段集 + 同一 SESSION 贯穿"取页→取图→提交"三跳，一次成功（连续 2 次复现）。1320007 是通用失败码（错码/错密码均返回），历史失败非验证码本身问题，疑为字段不全或会话/flowkey 状态不一致。经典表单登录现在也可作为自动化通道

### 4.1 验证码开关与图片 URL 是服务端按用户下发的（2026-08-15 从 JS 新挖出）

真实验证码链路不是裸端点，而是：

```
GET api/protected/user/findCaptchaCount/{username}   (linkidAggregateUserService.getCount, 相对路径)
→ {captchaInvisible: bool, captchaUrl: string}
  - captchaInvisible=true  → 前端显示验证码框, 图片从 captchaUrl 加载
  - false → 不显示验证码
```

- 页面加载时调一次（`login_user_id` 本地缓存）；提交前若还没显示过验证码会再调一次（用当前用户名）
- deploy.js 的 CSS content 指纹（body computed content 含 'x'）写死 `captcha-url` 元素为 `api/captcha/generate/DEFAULT` 只是**兜底路径**，会被 SPA 的 getCount 结果覆盖
- **2026-08-15 实测确认**：`GET https://sfgl.njtech.edu.cn/cas/api/protected/user/findCaptchaCount/{学号}` 带硬编码伪 CSRF 头（`Csrf-Key: FzgxPikIetYDlXZM4lRG9taclVDa99lB` / `Csrf-Value: 7964f321f00366a3a287a133dd307ed0`）+ Referer `/cas/login` → `{"code":200,"data":{"captchaInvisible":true,"captchaUrl":"api/captcha/generate/DEFAULT"}}`。本账号 captchaInvisible=true（疑为历史失败次数触发风控），captchaUrl 就是裸 DEFAULT 端点——"图片通道不同"假说**不成立**
- **channel 登录的绕行得到强化证据**：账号被标记 captchaInvisible=true 的情况下，同日 4 次 channel 登录不带 captchaCode 全部成功——服务端对该通道不强制验证码
- **假说验证结果（2026-08-16 实测）**：破解实验执行成功——同一会话内严格按"取页面→取图→OCR→提交"顺序，三跳 SESSION 值一致（如 `5dcfbe02...ec20`），完整字段集 POST /cas/login 一次通过（连续 2 次复现，OCR 残差全 0.000），302 签发 ST 且 Set-Cookie SOURCEID_TGC。历史 6 次失败的根因无法追溯（旧脚本未保留），可确定非"图片通道"问题、非 OCR 问题
- 前端 i18n 将 1320007 标注为"验证码有误，请确认后重新输入"，但服务端把它当通用失败码（对照实验证实），前后端语义不一致
- channel 登录请求体也有可选 `captchaCode` 字段（仅当 captchaInvisible 时前端才带）；其响应 `data` 同样可能携带 `captchaInvisible/captchaUrl` 要求验证码（实测本账号 4 次登录均未触发）

## 5. channel 登录（★免验证码，自动化首选）

```
POST https://sfgl.njtech.edu.cn/cas/protected/rest/login
Content-Type: application/json

{
  "username": "<学号>",
  "password": "<base64(3DES-EDE3-ECB(密码+','+毫秒时间戳, key=base64decode(croypto)))>",
  "timestamp": <毫秒时间戳>,
  "croypto": "<登录页内嵌值>"
}

成功: 200 {"code":200,"message":"登录成功","data":{"result":true,...}}
      Set-Cookie: SOURCEID_TGC=<JWT>; Path=/cas/; HttpOnly
```

要点：
- 密码加密内容 = `密码 + "," + 时间戳`（时间戳即 body 里的 timestamp，明文）
- 此通道**不校验验证码**
- SOURCEID_TGC = CAS SSO 会话（TGC），后续所有 CAS 交互靠它

## 6. OAuth2 链（应用接入方式）

```
GET /cas/oauth2.0/authorize?client_id=<id>&redirect_uri=<应用回调>&response_type=code&scope=...&state=...
  → 无SSO会话: 302 /cas/login?service=<callbackAuthorize 包装>
  → 有SSO会话: 302 /cas/oauth2.0/callbackAuthorize?...&ticket=ST-xxx (新ST)
  → 302 /cas/oauth2.0/authorize?...  (state 原样)
  → 302 <应用回调>?code=OC-<数字>-<随机>&state=...
```

授权码格式 `OC-xxxxxx-...`。已知 client_id：vpnlib=`nc2Upjt6MbtO8eVD30Cq`（state 静态 `ENLINK_OAUTH`）；办事大厅 gate=`OC4wNS4wNS4wNy4wMC4wMy4wMS4wMS4w`。

## 7. 会话 Cookie 一览

| Cookie | 域/路径 | 含义 |
|---|---|---|
| SESSION | sfgl /cas/ | CAS 会话（验证码等绑定） |
| SOURCEID_TGC | sfgl /cas/ | SSO 会话凭证（JWT） |
| SESSION | sfgl /gate/ | gate 门户会话（另一个应用） |

## 8. 其它发现

- 平台 API 加密通道（dictconfig 等 linkid 接口）：3DES-ECB，固定密钥 `SphG5lQmUoU=`（从 deploy.js 的 uncompile 混淆函数解出，已验证）；伪 CSRF 头 `Csrf-Key: FzgxPikIetYDlXZM4lRG9taclVDa99lB` / `Csrf-Value: 7964f321f00366a3a287a133dd307ed0` 是硬编码常量
- 验证码开关通过 CSS content 指纹传给 JS（deploy.js 检查 body 的 computed content 是否含 'x'）

## 9. 2026-08-18 实测：CAS 侧风控变化

- **channel 登录返回 403**：`POST /cas/protected/rest/login` → `{"code":403,"message":"无权限访问"}`（此前多日一直 code:200）。触发条件未明（疑为账号/IP 多次自动化登录被标记；GitHub 故障同期亦不能排除 IP 段影响）
- **验证码池疑似更新**：模板匹配 OCR 连续失败（此前残差全 0.000）；人工识别提交仍 1320007
- 表单登录页面/验证码生成/captchaInvisible 机制均未变（页面结构、DEFAULT 端点、findCaptchaCount 全部照旧）
- **影响**：自动化登录通道暂时受阻；待风控解除后恢复（可换 IP/等待，或用浏览器手动登录验证通道状态）
