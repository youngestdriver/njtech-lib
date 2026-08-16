# 隐藏接口清单（linkid CAS 平台 + 周边）

来源：`cas-login-main.js` / `deploy.js` 等前端 JS 的 HTTP 调用与 GraphQL 映射模块；标注 ✅ 的为本会话实测调用成功的接口。
宿主：默认 `sfgl.njtech.edu.cn`（CAS/linkid 平台）；带 `/center/`、`/faceid/`、`/dev-api/` 前缀的宿主未确认（疑为门户中心/人脸/工作流服务）。

## 1. 已验证（实测调用成功）

| 接口 | 方法 | 说明 |
|---|---|---|
| `/cas/protected/rest/login` | POST | ★channel 登录（免验证码通道）。JSON：`{username, password: base64(3DES(密码,毫秒时间戳)), timestamp, croypto}`；成功 Set-Cookie SOURCEID_TGC。可选字段 `captchaCode`（服务端要求时才带，实测不要求） |
| `/cas/login` | POST | ★经典表单登录。urlencoded 全字段：`username/passwordPre(明文)/password(3DES裸密码)/croypto/captcha_code/type=UsernamePassword/_eventId=submit/geolocation=(空)/execution=flowkey`；成功 302 ST + Set-Cookie SOURCEID_TGC（2026-08-16 实测） |
| `/cas/api/captcha/generate/DEFAULT` | GET | 验证码图片（160×70 PNG，需 /cas/ SESSION）；仅 DEFAULT 类型注册，其它类型参数 500 |
| `/cas/api/protected/user/findCaptchaCount/{username}` | GET | ★验证码开关（getCount）。响应 `{captchaInvisible: bool, captchaUrl: string}`。**必须带硬编码伪 CSRF 头**（Csrf-Key/Csrf-Value，见 §4）+ Referer `/cas/login`，否则 401 |
| `/cas/oauth2.0/authorize` + `/cas/oauth2.0/callbackAuthorize` | GET | OAuth2 发码端点（code 格式 `OC-<数字>-<随机>`） |
| `seat /index.php/graphql/` | POST | 选座系统 GraphQL 端点（introspection 关闭；30+ 条语句见 artifacts/graphql-queries.md） |
| `/api/protected/captcha/validate` | ? | 验证码校验端点（JS 中存在，未实测参数） |

## 2. 已发现未实测（按功能分组）

### 2.1 验证码 / 短信 / OTP

```
/api/protected/captcha/validate
/linkid/protected/api/aggregate/sms/publicNoToken/generate
/linkid/protected/api/aggregate/sms/publicNoToken/checkCaptcha
/linkid/protected/api/aggregate/sms/publicNoToken/sendCheckCaptcha/{n}/{t}/{e}/0008   (场景号 0005/0008)
/linkid/protected/api/aggregate/sms/publicNoToken/findTel/{n}
/linkid/protected/api/aggregate/sms/send/{n}/{t}
/linkid/protected/api/aggregate/sms/verify
/linkid/api/aggregate/sms/verify
/api/protected/sms/checkTokenResult
/api/protected/otpAuthn/{checkLogin,checkUser,generateSecret,getSessionCode,verifyToken}
```

seat GraphQL 对应：`captcha`（查询图片+code）、`verifyCaptcha($captcha,$code)`、`smsCaptcha($mobile,$captcha,$code)`、`getSchConfig($schId,$extra,$fields)`、`byMobile(...)`（见 artifacts/graphql-queries.md）。

### 2.2 密码重置 / 账号

```
/linkid/api/password/reset/sendsms/{n}/{t}
/linkid/api/password/admin/{reset,reset/checks,batch/reset}          ← 管理员批量重置！
/linkid/protected/api/password/{change,reset,reset/verifySend,type/find,mbemail/precheck,mbemail/reset}
/linkid/protected/api/password/realname/change/password
/linkid/protected/api/password/send/mbemail/{code,verifyCode}
/linkid/protected/api/password/sms/limit?userId={n}
/linkid/protected/api/user/password/{forcechange/check/{n},validate}
/linkid/api/aggregate/user/{update/v3,setIdsInvalid,changeIdentity,save/updateUserConfig}
```

### 2.3 二维码 / 企业微信 / 终端绑定

```
/api/protected/qrlogin/loginid        /api/protected/qrlogin/scan/
/api/public/qrlogin/qrgen/{n}/{t}     /api/qrlogin/loginid
/api/protected/wechat/checkEqualUser
/linkid/protected/wechat/open/getJsapiTicket
/api/protected/terminal/{get,getUserId/,unbinding/cookie}
/api/ssoAgainController/findXGAndUrlByUserObjectId
/api/public/redirect/auditing/qqQr     /api/qqQr/config/protected/audit/status
```

### 2.4 人脸（faceid 服务，宿主未确认）

```
/faceid/api/face/liveness          /faceid/api/face/protected/{liveness,quality,video/liveness}
/faceid/api/face/library/{get/user/app/{n},get/user/appList,get/userfacelogs,photo/get,show}
/faceid/api/face/config/get/{n}    /faceid/api/face/config/get/living.organisms
/api/face/privacy/log              /api/protected/face/{liveness,living/status}
/api/user/face/userName
```

### 2.5 组织 / 用户管理（/center/ 前缀疑似门户中心，宿主未确认）

```
/center/api/orgApp/*                     (~150 个路径：部门/岗位/组织树/编制，含 export、batchChange*、vacant/post 等)
/linkid/api/aggregate/users19/manager/{check/user/{n},merge/user/{n}}
/linkid/api/aggregate/users19/manager/self/batchUpdate
/linkid/api/aggregate/users/{isAdmin,org/center/pageQueryUsers,pageQueryUsersSimple}
/linkid/api/user/{edit/submit/userInfo,edit/realName/validate,del/user/byUserIdList,del/organization/user,getPersonId/}
/linkid/api/aggregate/organizationcenter/permission/permission/administrator/*
/api/aggregate/securitystrategy/{mobilesecurity,passwordsecurity/passwordinitial}/get
```

### 2.6 dictconfig（平台配置，3DES 加密通道）

```
/api/dictconfig/get            ${linkidUrl}/api/dictconfig/get
/linkid/api/dictconfig/{get,get/,get/new,get/scene/list,save,save/value,saveForThirdParty}
/linkid/dictconfig/            /linkid/dictconfig/save/
```

请求体 3DES-ECB 加密，**固定密钥 `SphG5lQmUoU=`**（从 deploy.js uncompile 混淆函数解出，已验证）；伪 CSRF 头见 §4。

### 2.7 其它杂项

```
/onlineCheck                     /getUser        /cas-success
/index.php/wxApp                 /index.php/index/boot
/api/protected/i18n/convertMessages
/api/portlet/find                 /api/portlet/find/publish
/api/protected/manufacturer/get
/api/protected/account/config
/api/protected/aggregate/app/{dict/portal,redirect}
/api/auth/strategy/aggregate/{active,all,app/get,create,deleteById,updateById}
/linkid/protected/api/filling/task/complete
/linkid/protected/api/filling/task/config/queryByObjectId
/dev-api/flowable/task/{myProcess,return}          (flowKey=flow_umdp0888)
/flow/flowable/task/{myProcess,return}  /flow/flowable/definition/checkProcEnabled
/api/service/protected/get/name
/api/aggregate/account/sleep/{config,validToNormal}
/api/aggregate/authmethod/usernames
/addressbook/api/dept/{children/find,find/parent/all,topDept}
/ankasourceid/common/account/{find/page,user/add,user/remove}
/ankasourceid/user/common/account/list
/api/user/identity/find/
/api/user/protected/api/aggregate/bind/mbemail/{bind,send/code}
/api/user/protected/api/aggregate/bindmobile/sms/bind
/api/user/protected/api/user/email/create
/data-sync/public/network/phoneVerifyConfig/get/{n}
/public/muti-industry/multi-industry-key-word.json
```

## 3. 安全观察（仅记录）

1. **伪 CSRF 硬编码常量**：`Csrf-Key: FzgxPikIetYDlXZM4lRG9taclVDa99lB` / `Csrf-Value: 7964f321f00366a3a287a133dd307ed0`——所有 linkid API 共用，形同虚设（findCaptchaCount 实测必需此头才放行）
2. **dictconfig 固定 3DES 密钥** `SphG5lQmUoU=` 内嵌前端，任何调用者可自行加解密
3. `findCaptchaCount` 无鉴权泄露账号验证码策略状态（captchaInvisible）
4. `/linkid/api/password/admin/{reset,batch/reset}` 管理员密码重置接口路径暴露（调用需管理员会话，未测试）
5. `captchaUrl` 相对路径 `api/captcha/generate/DEFAULT`——无 token 绑定（假说已否证）
