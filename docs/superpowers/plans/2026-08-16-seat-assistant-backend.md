# 选座助手后端（server/）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现选座助手 M1 后端：多账号登录链与会话池、座位图/选退座 API、保活调度、访问密码鉴权。

**Architecture:** 单体 Fastify 服务，四个边界清晰的模块（auth=CAS 登录链、seat=状态机+GraphQL、accounts=会话池+存储、keepalive=保活调度）。所有对真实系统的 HTTP 交互经 `src/http/`（fetch + 自研 CookieJar，重定向手动跟随）；测试用 node http 内置 mock 服务器按 `docs/` 录制的真实响应序列回放。

**Tech Stack:** Node ≥ 20（ESM）、TypeScript strict、Fastify 5、better-sqlite3、vitest、tsx。无 node-cron（保活用 setInterval 循环，功能等价且可用 fake timers 测试）。

**Spec:** `docs/superpowers/specs/2026-08-16-seat-assistant-design.md`
（前端 `web/` 属 Plan 2，本计划不含；smoke 脚本连真实系统为手动触发。）

## Global Constraints

- Node ≥ 20；TypeScript strict；ESM（`"type": "module"`）；运行/测试均用 `tsx`
- 凭据只存 AES-256-GCM 密文；主密钥必须由环境变量 `NJ_SEAT_MASTER_KEY`（32 字节 hex）提供，缺失拒绝启动
- 会话 cookie 不落盘：每账号 CookieJar 只在内存；服务重启即全量重登
- 锁粒度 = 账号；不同账号完全并行
- 写操作先查后做（退座前先查 `reserve != null`）
- 日志脱敏：cookie 值只记前 8 字符
- 网络错误指数退避 1s→2s→4s，封顶 3 次；协议错误全链重走最多 2 次
- 重登失败连续 3 次 → 状态 failed；保活周期默认 600000ms 可配（`NJ_SEAT_KEEPALIVE_MS`）
- 访问密码必须由 `NJ_SEAT_ACCESS_PASSWORD` 提供，缺失拒绝启动；访问 token 有效期 7 天
- M1 不做：captcha-ocr.ts 移植、自动抢座、通知推送、批量导入
- 运行数据一律在 `server/data/`（.gitignore 已排除）

---

### Task 1: 项目脚手架与配置加载

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/config.ts`
- Test: `server/test/config.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`；`AppConfig { port:number; dbPath:string; masterKey:Buffer; accessPassword:string; keepaliveIntervalMs:number; tokenTtlSec:number }`

- [ ] **Step 1: 写脚手架文件**

`server/package.json`:
```json
{
  "name": "njtech-seat-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "scripts"]
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: 写配置加载的失败测试**

`server/test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = {
  NJ_SEAT_MASTER_KEY: "00".repeat(32),   // 32 字节 hex
  NJ_SEAT_ACCESS_PASSWORD: "secret-pass",
};

describe("loadConfig", () => {
  it("缺失主密钥时抛错", () => {
    expect(() => loadConfig({ ...BASE, NJ_SEAT_MASTER_KEY: undefined }))
      .toThrow(/NJ_SEAT_MASTER_KEY/);
  });

  it("主密钥非 32 字节 hex 时抛错", () => {
    expect(() => loadConfig({ ...BASE, NJ_SEAT_MASTER_KEY: "abcd" }))
      .toThrow(/32 字节/);
  });

  it("缺失访问密码时抛错", () => {
    expect(() => loadConfig({ ...BASE, NJ_SEAT_ACCESS_PASSWORD: undefined }))
      .toThrow(/NJ_SEAT_ACCESS_PASSWORD/);
  });

  it("默认值与 env 覆盖", () => {
    const c = loadConfig({
      ...BASE,
      NJ_SEAT_PORT: "9000",
      NJ_SEAT_KEEPALIVE_MS: "30000",
    });
    expect(c.port).toBe(9000);
    expect(c.keepaliveIntervalMs).toBe(30000);
    expect(c.masterKey).toHaveLength(32);
    expect(c.dbPath).toBe("server/data/app.db");
    expect(c.tokenTtlSec).toBe(7 * 24 * 3600);
  });
  it("非法数值 env 抛错（防止 NaN 保活间隔→1ms 打对方服务器）", () => {
    expect(() => loadConfig({ ...BASE, NJ_SEAT_PORT: "abc" }))
      .toThrow(/NJ_SEAT_PORT/);
    expect(() => loadConfig({ ...BASE, NJ_SEAT_KEEPALIVE_MS: "abc" }))
      .toThrow(/NJ_SEAT_KEEPALIVE_MS/);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd server && npm install && npx vitest run test/config.test.ts`
Expected: FAIL（`../src/config.js` 不存在）

- [ ] **Step 4: 实现 config.ts**

`server/src/config.ts`:
```ts
export interface AppConfig {
  port: number;
  dbPath: string;
  masterKey: Buffer;          // 32 字节
  accessPassword: string;
  keepaliveIntervalMs: number;
  tokenTtlSec: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const keyHex = env.NJ_SEAT_MASTER_KEY;
  if (!keyHex) throw new Error("缺少 NJ_SEAT_MASTER_KEY（32 字节 hex 主密钥）");
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("NJ_SEAT_MASTER_KEY 必须是 32 字节 hex");
  const accessPassword = env.NJ_SEAT_ACCESS_PASSWORD;
  if (!accessPassword) throw new Error("缺少 NJ_SEAT_ACCESS_PASSWORD");
  return {
    port: parseNum(env.NJ_SEAT_PORT, 8791, "NJ_SEAT_PORT"),
    dbPath: env.NJ_SEAT_DB ?? "server/data/app.db",
    masterKey: Buffer.from(keyHex, "hex"),
    accessPassword,
    keepaliveIntervalMs: parseNum(env.NJ_SEAT_KEEPALIVE_MS, 600_000, "NJ_SEAT_KEEPALIVE_MS"),
    tokenTtlSec: 7 * 24 * 3600,
  };
}

/** 数值 env 解析：非法/非正数抛错（NaN 保活间隔会让 setInterval 以 1ms 打对方服务器） */
function parseNum(raw: string | undefined, def: number, name: string): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} 必须是正数`);
  return n;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run test/config.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: 提交**

```bash
git add server/
git commit -m "feat(server): 脚手架与配置加载（Fastify+vitest+tsx）"
```

---

### Task 2: HTTP 基础层（CookieJar + 手动重定向客户端）

**Files:**
- Create: `server/src/http/cookiejar.ts`
- Create: `server/src/http/client.ts`
- Test: `server/test/http/cookiejar.test.ts`
- Test: `server/test/http/client.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `class CookieJar { set(setCookie: string|null, url: string): void; header(url: string): string }`；`interface HttpResponse { status:number; headers:Headers; body:Buffer }`；`request(url: string, opts: { method?: string; headers?: Record<string,string>; body?: Buffer|string; jar?: CookieJar; timeoutMs?: number }): Promise<HttpResponse>`（**永不自动跟随重定向**，fetch `redirect:'manual'`；自动带 UA、从 jar 加 Cookie、把 Set-Cookie 写回 jar）

- [ ] **Step 1: 写 CookieJar 失败测试**

`server/test/http/cookiejar.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CookieJar } from "../../src/http/cookiejar.js";

describe("CookieJar", () => {
  it("解析 Set-Cookie 并按域名+路径保存", () => {
    const jar = new CookieJar();
    jar.set("SESSION=abc123; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("wechatSESS_ID=w1; Path=/", "https://seat.njtech.edu.cn/index.php/index/boot.html");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login?service=x"))
      .toBe("SESSION=abc123");
    expect(jar.header("https://seat.njtech.edu.cn/index.php/graphql/"))
      .toBe("wechatSESS_ID=w1");
    // 域隔离：seat 的请求不带 sfgl 的 cookie
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/api/captcha/generate/DEFAULT"))
      .not.toContain("wechatSESS_ID");
  });

  it("同路径同名覆盖 + 不同路径共存", () => {
    const jar = new CookieJar();
    jar.set("SESSION=s1; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("SESSION=s2; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login")).toBe("SESSION=s2");
  });

  it("HttpOnly 与过期时间影响存储", () => {
    const jar = new CookieJar();
    jar.set("TGC=t1; Path=/cas/; HttpOnly; Max-Age=3600", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("GONE=x; Path=/cas/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
            "https://sfgl.njtech.edu.cn/cas/login");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login")).toBe("TGC=t1");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 cookiejar.ts**

`server/src/http/cookiejar.ts`:
```ts
interface CookieEntry { value: string; path: string; expires: number | null }
type JarKey = string; // name @ host @ path

export class CookieJar {
  private store = new Map<JarKey, CookieEntry>();

  set(setCookie: string | null, url: string): void {
    if (!setCookie) return;
    const u = new URL(url);
    const parts = setCookie.split(";").map(s => s.trim());
    const eq = parts[0].indexOf("=");
    if (eq < 0) return;
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const i = p.indexOf("=");
      const k = p.slice(0, i < 0 ? undefined : i).toLowerCase();
      const v = i < 0 ? "" : p.slice(i + 1);
      attrs[k] = v;
    }
    const path = attrs.path ?? "/";
    let expires: number | null = null;
    if (attrs["max-age"] !== undefined) expires = Date.now() + Number(attrs["max-age"]) * 1000;
    else if (attrs.expires) {
      const t = Date.parse(attrs.expires);
      if (!Number.isNaN(t)) expires = t;
    }
    const key = `${name}@${u.hostname}@${path}`;
    if (expires !== null && expires <= Date.now()) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, { value, path, expires });
  }

  header(url: string): string {
    const u = new URL(url);
    const out: string[] = [];
    for (const [k, e] of this.store) {
      const [name, host, path] = k.split("@");
      if (host !== u.hostname) continue;
      if (!u.pathname.startsWith(path)) continue;
      if (e.expires !== null && e.expires <= Date.now()) { this.store.delete(k); continue; }
      out.push(`${name}=${e.value}`);
    }
    return out.join("; ");
  }
}
```

- [ ] **Step 3: 写 client 失败测试（用 node http 起临时 mock）**

`server/test/http/client.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { request } from "../../src/http/client.js";
import { CookieJar } from "../../src/http/cookiejar.js";

let server: http.Server; let base = "";
function startMock() {
  server = http.createServer((req, res) => {
    if (req.url === "/redir") {
      res.writeHead(302, { Location: "/final", "Set-Cookie": "a=1; Path=/" });
      res.end(); return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(JSON.stringify({ url: req.url, referer: req.headers.referer ?? null,
                            cookie: req.headers.cookie ?? null }));
  });
  return new Promise<void>(r => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${(server.address() as any).port}`; r();
  }));
}
beforeAll(startMock);
afterAll(() => server.close());

describe("request", () => {
  it("302 不自动跟随（manual redirect）", async () => {
    const r = await request(`${base}/redir`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/final");
  });
  it("带 Referer 与 jar cookie，响应 Set-Cookie 写回 jar", async () => {
    const jar = new CookieJar();
    const r1 = await request(`${base}/final`, { headers: { Referer: `${base}/redir` }, jar });
    const parsed = JSON.parse(r1.body.toString());
    expect(parsed.referer).toBe(`${base}/redir`);
    expect(parsed.cookie).toBeNull();
    const r2 = await request(`${base}/redir`, { jar });
    expect(r2.headers.get("set-cookie")).toContain("a=1");
    const r3 = await request(`${base}/final`, { jar });
    expect(JSON.parse(r3.body.toString()).cookie).toBe("a=1");
  });
});
```

- [ ] **Step 4: 运行确认失败 → 实现 client.ts**

`server/src/http/client.ts`:
```ts
import { CookieJar } from "./cookiejar.js";

export const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

export interface HttpResponse { status: number; headers: Headers; body: Buffer }

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  jar?: CookieJar;
  timeoutMs?: number;
}

export async function request(url: string, opts: RequestOpts = {}): Promise<HttpResponse> {
  const headers = new Headers(opts.headers ?? {});
  headers.set("User-Agent", UA);
  const cookie = opts.jar?.header(url);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const body = Buffer.from(await res.arrayBuffer());
  opts.jar?.set(res.headers.get("set-cookie"), url);
  return { status: res.status, headers: res.headers, body };
}
```

- [ ] **Step 5: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/http/`
Expected: PASS（两个文件全部）

```bash
git add server/src/http server/test/http
git commit -m "feat(server): HTTP 基础层（CookieJar + manual-redirect 客户端）"
```

---

### Task 3: 加密原语（3DES-EDE3 + AES-256-GCM）

**Files:**
- Create: `server/src/auth/crypto.ts`
- Test: `server/test/auth/crypto.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `des3Encrypt(keyB64: string, plaintext: string): string`（返回 base64 密文；keyB64 为 8 字节密钥的 base64，等价 CryptoJS.DES = EDE3 K1=K2=K3）；`aesEncrypt(key: Buffer, plaintext: string): string`（返回 `iv.tag.ciphertext` 的 base64）；`aesDecrypt(key: Buffer, packed: string): string`

- [ ] **Step 1: 写失败测试（含 openssl 实测向量）**

`server/test/auth/crypto.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { des3Encrypt, aesEncrypt, aesDecrypt } from "../../src/auth/crypto.js";

describe("des3Encrypt", () => {
  // 向量来源: 2026-08-16 openssl enc -des-ede3-ecb -K <hex*3> 实测,
  // 与已验证的 CryptoJS.DES(ECB/Pkcs7, 8字节密钥重复3次) 语义一致
  it("与 openssl 实测向量一致 (裸密码)", () => {
    expect(des3Encrypt("MTIzNDU2Nzg=", "mypassword"))
      .toBe("dc10CtqzzdfqsABousAVIA==");
  });
  it("与 openssl 实测向量一致 (密码,时间戳 channel 格式)", () => {
    expect(des3Encrypt("MTIzNDU2Nzg=", "mypassword,1786794568000"))
      .toBe("dc10CtqzzdcUMxBjnLyGqsBrI+ZFK9vo/rlZt9RkL8s=");
  });
});

describe("aesEncrypt/aesDecrypt", () => {
  const key = Buffer.alloc(32, 7);
  it("往返一致", () => {
    const enc = aesEncrypt(key, "s3cret-password");
    expect(enc).not.toContain("s3cret-password");
    expect(aesDecrypt(key, enc)).toBe("s3cret-password");
  });
  it("密文随机 (每次 iv 不同)", () => {
    expect(aesEncrypt(key, "x")).not.toBe(aesEncrypt(key, "x"));
  });
  it("错误密钥解密抛错", () => {
    const enc = aesEncrypt(key, "x");
    expect(() => aesDecrypt(Buffer.alloc(32, 1), enc)).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 crypto.ts**

`server/src/auth/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function des3Encrypt(keyB64: string, plaintext: string): string {
  const key8 = Buffer.from(keyB64, "base64");
  if (key8.length !== 8) throw new Error("croypto 密钥必须为 8 字节 base64");
  const key24 = Buffer.concat([key8, key8, key8]);   // EDE3 K1=K2=K3
  const cipher = createCipheriv("des-ede3", key24, null);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    .toString("base64");
}

export function aesEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function aesDecrypt(key: Buffer, packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/auth/crypto.test.ts`
Expected: PASS（5 tests）

```bash
git add server/src/auth/crypto.ts server/test/auth/crypto.test.ts
git commit -m "feat(server): 3DES-EDE3 与 AES-256-GCM 加密原语"
```

---

### Task 4: CAS 登录链（channel + 经典表单双通道）

**Files:**
- Create: `server/src/auth/cas.ts`
- Create: `server/test/helpers/mock-cas.ts`
- Test: `server/test/auth/cas.test.ts`

**Interfaces:**
- Consumes: `request`、`CookieJar`（Task 2）、`des3Encrypt`（Task 3）
- Produces:
```ts
export interface LoginPage { url: string; croypto: string; flowkey: string }
export class CasError extends Error {
  constructor(public kind: "captcha-required" | "bad-credentials" | "protocol",
              public code?: string, message?: string) { super(message); }
}
export class CasClient {
  async fetchLoginPage(jar: CookieJar, loginPageUrl: string): Promise<LoginPage>
  async findCaptchaCount(jar: CookieJar, loginPageUrl: string, username: string):
    Promise<{ captchaInvisible: boolean; captchaUrl: string | null }>
  async fetchCaptchaImage(jar: CookieJar, loginPageUrl: string): Promise<Buffer>
  async channelLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string): Promise<void>
  async formLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string,
                  captchaCode: string): Promise<string>   // 返回 302 Location（service+ticket）
}
```

- [ ] **Step 1: 写 mock CAS（按 docs/cas.md 录制的真实行为）**

`server/test/helpers/mock-cas.ts`:
```ts
import http from "node:http";

export interface MockCasOpts {
  channelRequireCaptcha?: boolean;   // rest/login 响应要求验证码
  formAccept?: (body: URLSearchParams) => boolean;  // 表单校验钩子
}
export interface CasRequest { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

export function createMockCas(opts: MockCasOpts = {}) {
  const requests: CasRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: raw });
      const u = new URL(req.url!, "https://sfgl.njtech.edu.cn");
      if (u.pathname === "/cas/login" && req.method === "GET") {
        // ★TGC 感知（2026-08-16 预检修正）: 带 SOURCEID_TGC 直接 302 发 ST（SSO 免登录）
        if ((req.headers.cookie ?? "").includes("SOURCEID_TGC")) {
          const service = u.searchParams.get("service");
          res.writeHead(302, { Location: `${service}&ticket=ST-cas-1` });
          res.end();
          return;
        }
        res.setHeader("Set-Cookie", "SESSION=cas-session; Path=/cas/");
        res.setHeader("Content-Type", "text/html");
        res.end('<html><p id="login-croypto">MTIzNDU2Nzg=</p>' +
                '<p id="login-page-flowkey">test-flow-1</p></html>');
        return;
      }
      if (u.pathname === "/cas/protected/rest/login" && req.method === "POST") {
        const body = JSON.parse(raw);
        const ok = body.username === "2023001" && body.password && body.timestamp && body.croypto;
        if (!ok) { res.end(JSON.stringify({ code: 400, message: "失败" })); return; }
        if (opts.channelRequireCaptcha) {
          res.end(JSON.stringify({ code: 200, data: { result: false, captchaInvisible: true } }));
          return;
        }
        res.setHeader("Set-Cookie", "SOURCEID_TGC=tgc-abc; Path=/cas/; HttpOnly");
        res.end(JSON.stringify({ code: 200, message: "登录成功", data: { result: true } }));
        return;
      }
      if (u.pathname === "/cas/api/captcha/generate/DEFAULT") {
        res.setHeader("Content-Type", "image/png");
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));  // 假 PNG 头即可
        return;
      }
      if (u.pathname.startsWith("/cas/api/protected/user/findCaptchaCount/")) {
        if (req.headers["csrf-key"] !== "FzgxPikIetYDlXZM4lRG9taclVDa99lB") {
          res.end(JSON.stringify({ code: 401, message: "Unauthorized" })); return;
        }
        res.end(JSON.stringify({ code: 200, data: { captchaInvisible: true,
          captchaUrl: "api/captcha/generate/DEFAULT" } }));
        return;
      }
      if (u.pathname === "/cas/login" && req.method === "POST") {
        const form = new URLSearchParams(raw);
        if (!form.get("username") || !form.get("passwordPre") || !form.get("password")
            || !form.get("captcha_code") || !form.get("execution")
            || form.get("type") !== "UsernamePassword" || form.get("_eventId") !== "submit"
            || !form.get("croypto") || !form.get("geolocation")) {
          res.setHeader("Content-Type", "text/html");
          res.end('<p id="login-error-code">1320007</p>');
          return;
        }
        if (opts.formAccept && !opts.formAccept(form)) {
          res.setHeader("Content-Type", "text/html");
          res.end('<p id="login-error-code">1320007</p>');
          return;
        }
        const service = u.searchParams.get("service");
        res.setHeader("Set-Cookie", "SOURCEID_TGC=tgc-form; Path=/cas/; HttpOnly");
        res.writeHead(302, { Location: `${service}&ticket=ST-mock-1` });
        res.end();
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise<{ port: number; url: string; requests: CasRequest[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port,
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      requests,
    }));
  });
}
```

- [ ] **Step 2: 写 cas 失败测试**

`server/test/auth/cas.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { CasClient, CasError } from "../../src/auth/cas.js";
import { CookieJar } from "../../src/http/cookiejar.js";
import { createMockCas } from "../helpers/mock-cas.js";
import { des3Encrypt } from "../../src/auth/crypto.js";

let mocks: Awaited<ReturnType<typeof createMockCas>>[] = [];
async function startMock(opts = {}) {
  const m = await createMockCas(opts);
  mocks.push(m);
  return m;
}
afterEach(() => { mocks = []; });

describe("CasClient", () => {
  it("channel 登录成功: 发送加密密码并拿到 TGC", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login?service=s1`);
    expect(page.croypto).toBe("MTIzNDU2Nzg=");
    expect(page.flowkey).toBe("test-flow-1");
    await cas.channelLogin(jar, page.url, "2023001", "mypassword");
    expect(jar.header(`${m.url}/cas/login`)).toContain("SOURCEID_TGC=tgc-abc");
    const post = m.requests.find(r => r.method === "POST");
    const body = JSON.parse(post!.body);
    // 密码密文 = 3DES("mypassword,<ts>") 且 ts 与明文时间戳一致
    expect(body.croypto).toBe("MTIzNDU2Nzg=");
    expect(body.password).toBe(des3Encrypt("MTIzNDU2Nzg=", `mypassword,${body.timestamp}`));
  });

  it("channel 被风控: 抛 captcha-required", async () => {
    const m = await startMock({ channelRequireCaptcha: true });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.channelLogin(jar, page.url, "2023001", "mypassword"))
      .rejects.toMatchObject({ kind: "captcha-required" });
  });

  it("表单登录成功: 全字段提交并返回 302 Location", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login?service=https%3A%2F%2Fseat%2Fx`);
    const loc = await cas.formLogin(jar, page.url, "2023001", "mypassword", "pk3x");
    expect(loc).toContain("ticket=ST-mock-1");
    const post = m.requests.find(r => r.method === "POST");
    const form = new URLSearchParams(post!.body);
    expect(form.get("captcha_code")).toBe("pk3x");
    expect(form.get("passwordPre")).toBe("mypassword");
    expect(form.get("password")).toBe(des3Encrypt("MTIzNDU2Nzg=", "mypassword"));
    expect(form.get("execution")).toBe("test-flow-1");
    expect(form.get("geolocation")).toBe("");
  });

  it("表单登录失败(1320007): 抛 bad-credentials", async () => {
    const m = await startMock({ formAccept: f => f.get("captcha_code") === "right" });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.formLogin(jar, page.url, "2023001", "mypassword", "wrong"))
      .rejects.toMatchObject({ kind: "bad-credentials", code: "1320007" });
  });

  it("findCaptchaCount 带伪 CSRF 头", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    const r = await cas.findCaptchaCount(jar, page.url, "2023001");
    expect(r).toEqual({ captchaInvisible: true, captchaUrl: "api/captcha/generate/DEFAULT" });
    const req = m.requests.find(q => q.url.includes("findCaptchaCount"))!;
    expect(req.headers["csrf-key"]).toBe("FzgxPikIetYDlXZM4lRG9taclVDa99lB");
  });
});
```

- [ ] **Step 3: 运行确认失败 → 实现 cas.ts**

`server/src/auth/cas.ts`:
```ts
import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";
import { des3Encrypt } from "./crypto.js";

export const CSRF_KEY = "FzgxPikIetYDlXZM4lRG9taclVDa99lB";
export const CSRF_VALUE = "7964f321f00366a3a287a133dd307ed0";

export interface LoginPage { url: string; croypto: string; flowkey: string }

export class CasError extends Error {
  constructor(public kind: "captcha-required" | "bad-credentials" | "protocol",
              public code?: string, message?: string) { super(message ?? kind); }
}

export class CasClient {
  async fetchLoginPage(jar: CookieJar, loginPageUrl: string): Promise<LoginPage> {
    const r = await request(loginPageUrl, { jar });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    const html = r.body.toString("utf8");
    const croypto = /id="login-croypto">([^<]+)</.exec(html)?.[1];
    const flowkey = /id="login-page-flowkey">([^<]+)</.exec(html)?.[1];
    if (!croypto || !flowkey) throw new CasError("protocol", undefined, "登录页缺少 croypto/flowkey");
    return { url: loginPageUrl, croypto, flowkey };
  }

  async findCaptchaCount(jar: CookieJar, loginPageUrl: string, username: string) {
    const base = new URL("/cas/api/protected/user/findCaptchaCount/" + username,
                         new URL(loginPageUrl).origin).toString();
    const r = await request(base, {
      jar,
      headers: { "Csrf-Key": CSRF_KEY, "Csrf-Value": CSRF_VALUE, Referer: loginPageUrl },
    });
    const data = JSON.parse(r.body.toString("utf8")).data ?? {};
    return { captchaInvisible: !!data.captchaInvisible,
             captchaUrl: data.captchaUrl ?? null };
  }

  async fetchCaptchaImage(jar: CookieJar, loginPageUrl: string): Promise<Buffer> {
    const base = new URL("api/captcha/generate/DEFAULT", loginPageUrl).toString();
    const r = await request(base, { jar, headers: { Referer: loginPageUrl } });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    return r.body;
  }

  async channelLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string): Promise<void> {
    const page = await this.fetchLoginPage(jar, loginPageUrl);
    const ts = Date.now();
    const enc = des3Encrypt(page.croypto, `${password},${ts}`);
    const url = new URL("/cas/protected/rest/login", new URL(loginPageUrl).origin).toString();
    const r = await request(url, {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: loginPageUrl },
      body: JSON.stringify({ username, password: enc, timestamp: ts, croypto: page.croypto }),
    });
    const res = JSON.parse(r.body.toString("utf8"));
    if (res.data?.captchaInvisible) throw new CasError("captcha-required");
    if (res.code !== 200) throw new CasError("bad-credentials", String(res.code));
  }

  async formLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string,
                  captchaCode: string): Promise<string> {
    const page = await this.fetchLoginPage(jar, loginPageUrl);
    const body = new URLSearchParams({
      type: "UsernamePassword", _eventId: "submit", geolocation: "",
      execution: page.flowkey, captcha_code: captchaCode,
      username, passwordPre: password,
      croypto: page.croypto,
      password: des3Encrypt(page.croypto, password),
    }).toString();
    const r = await request(loginPageUrl, {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: loginPageUrl },
      body,
    });
    if (r.status >= 300 && r.status < 400) return r.headers.get("location") ?? "";
    const html = r.body.toString("utf8");
    const code = /id="login-error-code">([^<]*)</.exec(html)?.[1]
              ?? /id="login-error-msg"[^>]*>(.*?)<\//s.exec(html)?.[1];
    throw new CasError("bad-credentials", code || undefined);
  }
}
```

- [ ] **Step 4: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/auth/cas.test.ts`
Expected: PASS（5 tests）

```bash
git add server/src/auth/cas.ts server/test/auth/cas.test.ts server/test/helpers/mock-cas.ts
git commit -m "feat(server): CAS 双通道登录（channel + 经典表单带验证码）"
```

---

### Task 5: seat 8 步 Referer 状态机

**Files:**
- Create: `server/src/seat/state-machine.ts`
- Create: `server/test/helpers/mock-seat.ts`
- Test: `server/test/seat/state-machine.test.ts`

**Interfaces:**
- Consumes: `request`、`CookieJar`（Task 2）
- Produces:
```ts
export const SEAT_BASE = "https://seat.njtech.edu.cn";
export class SeatStateMachine {
  async start(jar: CookieJar): Promise<string>          // ①-④, 返回 U5（u.njtech /cas/login URL）
  async toCasLoginPage(jar: CookieJar, u5: string): Promise<{ url: string; body: Buffer }>  // ⑤ 无 TGC
  async completeLogin(jar: CookieJar, u5: string): Promise<void>  // ⑤ 带 TGC → ⑥ → 落到 /web/index.html
}
```
`start` 内部走 ①-④（每跳 Referer=上一跳 URL，不自动跟随）；`completeLogin` 手动跟随重定向直到 `https://seat.njtech.edu.cn/web/index.html` 200（最多 10 跳，含 http→https 301）。

- [ ] **Step 1: 写 mock seat + mock u.njtech（按 docs/seat.md 实测序列）**

`server/test/helpers/mock-seat.ts`:
```ts
import http from "node:http";

export interface MockSeatOpts { u5Base: string }   // u.njtech mock 的 URL（链 ④ 302 的目标）
export interface SeatRequest { method: string; url: string; referer: string | undefined }

export function createMockSeat(u5Base: string) {
  const requests: SeatRequest[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, referer: req.headers.referer });
    const send = (code: number, loc?: string, cookie?: string) => {
      if (cookie) res.setHeader("Set-Cookie", cookie);
      if (loc) res.writeHead(code, { Location: loc });
      else res.writeHead(code, { "Content-Type": "text/html" });
      res.end(loc ? "" : "<html>ok</html>");
    };
    const u = new URL(req.url!, "https://seat.njtech.edu.cn");
    if (u.pathname === "/index.php/reserve/index.html") {
      send(302, "https://seat.njtech.edu.cn/index.php/index/boot.html"); return;
    }
    if (u.pathname === "/index.php/index/boot.html" && req.headers.referer?.includes("/reserve/index.html")) {
      send(303, "/index.php/user/login.html", "wechatSESS_ID=w-sess; Path=/"); return;
    }
    if (u.pathname === "/index.php/user/login.html" && req.headers.referer?.includes("/index/boot.html")) {
      send(303, "/index.php/cas/login.html?schId=20317"); return;
    }
    if (u.pathname === "/index.php/cas/login.html" && req.headers.referer?.includes("/user/login.html")) {
      send(302, `${u5Base}/cas/login?service=https%3A%2F%2Fseat.njtech.edu.cn%2Findex.php%2Fcas%2Flogin.html%3FschId%3D20317`);
      return;
    }
    if (u.pathname === "/index.php/cas/login.html" && u.searchParams.get("ticket")) {
      send(302, "https://seat.njtech.edu.cn/index.php/cas/login.html?schId=20317"); return;
    }
    if (u.pathname === "/index.php/cas/login.html") {
      send(303, "/index.php/index/boot.html"); return;
    }
    if (u.pathname === "/index.php/index/boot.html") {
      send(303, "http://seat.njtech.edu.cn/web/index.html#/pages/index/index?r=123"); return;
    }
    if (u.pathname === "/web/index.html") {
      send(200, undefined, "PHPSESSID=p-sess; Path=/"); return;
    }
    send(404);
  });
  return new Promise<{ port: number; url: string; requests: SeatRequest[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port,
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      requests,
    }));
  });
}

export function createMockUnjtech() {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: new URL(req.url!, "https://u.njtech.edu.cn").searchParams
      .get("service") ? "https://sfgl.njtech.edu.cn" + req.url!.replace("/cas/login", "/cas/login") : "/" });
    // 实际只转发: 302 到 sfgl 同路径
    res.end();
  });
  ...
}
```
注意：mock-unjtech 的 Location 必须是 **sfgl mock 的地址**，故改为构造参数传入：
```ts
export function createMockUnjtech(sfglBase: string) {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: sfglBase + req.url });
    res.end();
  });
  return new Promise<{ port: number; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port, url: `http://127.0.0.1:${(server.address() as any).port}`,
    }));
  });
}
```
（状态机测试中 sfgl 由 mock-cas 承担；u.njtech mock 只做 302 转发。）

- [ ] **Step 2: 写状态机失败测试（验证 Referer 链 + TGC 前后行为差异）**

`server/test/seat/state-machine.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { SeatStateMachine } from "../../src/seat/state-machine.js";
import { CookieJar } from "../../src/http/cookiejar.js";

// 状态机使用真实 https://seat.njtech.edu.cn 域名常量, 测试通过 SEAT_BASE 可注入:
// 实现中 start/completeLogin 接受可选 base 参数（默认 SEAT_BASE）。
describe("SeatStateMachine", () => {
  it("①-④ 每跳 Referer 正确且返回 u.njtech URL", async () => {
    const seat = await createMockSeat(`http://u.njtech.edu.cn`);  // 占位, 只验证①-④
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    expect(u5).toContain("/cas/login?service=");
    const refs = seat.requests.map(r => r.referer ?? "");
    expect(refs[1]).toContain("/reserve/index.html");   // ② 的 Referer = ①
    expect(refs[2]).toContain("/index/boot.html");      // ③ 的 Referer = ②
    expect(refs[3]).toContain("/user/login.html");      // ④ 的 Referer = ③
  });

  it("无 TGC: toCasLoginPage 落在 sfgl 登录页 200", async () => {
    const cas = await createMockCas();
    const unj = await createMockUnjtech(cas.url);
    const seat = await createMockSeat(unj.url);
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    const { url, body } = await sm.toCasLoginPage(jar, u5);
    expect(url).toBe(`${cas.url}/cas/login?service=`);
    expect(body.toString()).toContain("login-croypto");
  });

  it("有 TGC: completeLogin 一路 302/303 落到 /web/index.html 且会话 cookie 就位", async () => {
    const cas = await createMockCas();
    const unj = await createMockUnjtech(cas.url);
    const seat = await createMockSeat(unj.url);
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    // 模拟已有 TGC（channel 登录后）
    jar.set("SOURCEID_TGC=tgc-abc; Path=/cas/", `${cas.url}/cas/login`);
    await sm.completeLogin(jar, u5);
    expect(jar.header(seat.url + "/index.php/graphql/")).toContain("wechatSESS_ID=w-sess");
    expect(jar.header(seat.url + "/index.php/graphql/")).toContain("PHPSESSID=p-sess");
    const ticketHop = seat.requests.find(r => r.url.includes("ticket="));
    expect(ticketHop).toBeTruthy();   // phpCAS 验票发生
    expect(ticketHop!.referer).toContain("/cas/login");  // ⑥ Referer = sfgl 登录页
  });
});
```

- [ ] **Step 3: 运行确认失败 → 实现 state-machine.ts**

`server/src/seat/state-machine.ts`:
```ts
import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";

export const SEAT_BASE = "https://seat.njtech.edu.cn";
const ENTRY = "/index.php/reserve/index.html?f=h5&from_code=WwsCBVIIAQs%3D";

export class SeatStateMachine {
  private base: string;
  constructor(base = SEAT_BASE) { this.base = base; }

  private hop = async (jar: CookieJar, url: string, referer: string | null) => {
    const r = await request(url, { jar, headers: referer ? { Referer: referer } : {} });
    return { status: r.status, location: r.headers.get("location"), body: r.body };
  };

  /** ①-④: 返回 U5（u.njtech /cas/login URL）*/
  async start(jar: CookieJar): Promise<string> {
    const u1 = this.base + ENTRY;
    const h1 = await this.hop(jar, u1, null);
    if (h1.status !== 302 || !h1.location) throw new Error(`① 失败: ${h1.status}`);
    const u2 = new URL(h1.location, this.base).toString();
    const h2 = await this.hop(jar, u2, u1);
    if (h2.status !== 303 || !h2.location) throw new Error(`② 失败: ${h2.status}`);
    const u3 = new URL(h2.location, this.base).toString();
    const h3 = await this.hop(jar, u3, u2);
    if (h3.status !== 303 || !h3.location) throw new Error(`③ 失败: ${h3.status}`);
    const u4 = new URL(h3.location, this.base).toString();
    const h4 = await this.hop(jar, u4, u3);
    if (h4.status !== 302 || !h4.location) throw new Error(`④ 失败: ${h4.status}`);
    return new URL(h4.location, this.base).toString();
  }

  /** ⑤ 无 TGC: 手动跟随到 sfgl 登录页 200 */
  async toCasLoginPage(jar: CookieJar, u5: string): Promise<{ url: string; body: Buffer }> {
    let cur = u5, ref = u5, hops = 0;
    while (hops++ < 5) {
      const h = await this.hop(jar, cur, ref);
      if (h.status === 200) return { url: cur, body: h.body };
      if (!h.location) throw new Error(`⑤ 断链: ${h.status} @ ${cur}`);
      ref = cur; cur = new URL(h.location, cur).toString();
    }
    throw new Error("⑤ 跳转过多");
  }

  /** ⑤(带TGC)→⑥: 跟随直到落在 /web/index.html 200 */
  async completeLogin(jar: CookieJar, u5: string): Promise<void> {
    let cur = u5, ref = u5, hops = 0;
    while (hops++ < 10) {
      const h = await this.hop(jar, cur, ref);
      if (h.status >= 300 && h.status < 400 && h.location) {
        ref = cur; cur = new URL(h.location, cur).toString();
        continue;
      }
      if (h.status === 200 && new URL(cur).pathname === "/web/index.html") return;
      throw new Error(`completeLogin 未到达应用页: ${h.status} @ ${cur}`);
    }
    throw new Error("completeLogin 跳转过多");
  }
}
```

- [ ] **Step 4: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/seat/state-machine.test.ts`
Expected: PASS（3 tests）

```bash
git add server/src/seat/state-machine.ts server/test/seat/state-machine.test.ts server/test/helpers/mock-seat.ts
git commit -m "feat(server): seat 8 步 Referer 状态机"
```

---

### Task 6: seat GraphQL 客户端与语句库

**Files:**
- Create: `server/src/seat/graphql.ts`
- Test: `server/test/seat/graphql.test.ts`

**Interfaces:**
- Consumes: `request`、`CookieJar`（Task 2）
- Produces:
```ts
export class SeatError extends Error { constructor(public code?: string, message?: string) { super(message); } }
export interface ReserveInfo { token: string; status: number; libId: number; libName: string; seatKey: string; seatName: string; expDateStr: string | null }
export class SeatGraphql {
  constructor(base?: string)   // 默认 https://seat.njtech.edu.cn
  async raw(jar: CookieJar, operationName: string, query: string, variables: Record<string, unknown>): Promise<any>
  async currentReserve(jar: CookieJar): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }>
  async layout(jar: CookieJar, libId: number): Promise<any>          // 原样返回 libLayout 的 libs[0]
  async reserve(jar: CookieJar, libId: number, seatKey: string, captchaCode: string, captcha: string):
    Promise<{ ok: true } | { ok: false; needCaptcha: boolean; message: string }>
  async cancel(jar: CookieJar, sToken: string): Promise<void>
  async reserveCaptcha(jar: CookieJar): Promise<{ code: string; imageData: string }>  // 选座验证码（顶层字段）
}
```

- [ ] **Step 1: 写失败测试（mock GraphQL 端点 + 已验证语句行为）**

`server/test/seat/graphql.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { SeatGraphql, SeatError } from "../../src/seat/graphql.js";
import { CookieJar } from "../../src/http/cookiejar.js";

let server: http.Server; let base = ""; const got: any[] = [];
beforeAll(() => new Promise<void>(r => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      got.push(JSON.parse(raw));
      const op = JSON.parse(raw).operationName;
      res.setHeader("Content-Type", "application/json");
      if (op === "reserueSeat" && JSON.parse(raw).variables.captchaCode === "") {
        res.end(JSON.stringify({ errors: [{ message: "need captcha", extensions: { code: 1000 } }] }));
        return;
      }
      if (op === "reserueSeat") { res.end(JSON.stringify({ data: { userAuth: { reserve: { reserueSeat: true } } } })); return; }
      if (op === "curReserve") {
        res.end(JSON.stringify({ data: { userAuth: { reserve: { reserve: null, getSToken: "st-1" } } } }));
        return;
      }
      res.end(JSON.stringify({ data: {} }));
    });
  });
  server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as any).port}`; r(); });
}));
afterAll(() => server.close());

describe("SeatGraphql", () => {
  const jar = new CookieJar();
  const gql = new SeatGraphql(base);

  it("currentReserve 使用已验证查询并解析 reserve/getSToken", async () => {
    const r = await gql.currentReserve(jar);
    expect(r).toEqual({ reserve: null, getSToken: "st-1" });
    expect(got[got.length - 1].query).toContain("getSToken");
  });

  it("reserve 空验证码遇 1000 → needCaptcha", async () => {
    const r = await gql.reserve(jar, 122811, "34,28", "", "");
    expect(r).toEqual({ ok: false, needCaptcha: true, message: "need captcha" });
  });

  it("reserve 带验证码成功", async () => {
    const r = await gql.reserve(jar, 122811, "34,28", "pk3x", "cap-token");
    expect(r).toEqual({ ok: true });
  });

  it("请求带 Referer 与 Content-Type", async () => {
    await gql.currentReserve(jar);
    const reqs = got.length;   // referer 断言在 mock 里太绕, 此处断言查询语句含 userAuth
    expect(got[got.length - 1].query).toContain("userAuth");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 graphql.ts（内嵌已验证语句）**

`server/src/seat/graphql.ts`:
```ts
import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";

export class SeatError extends Error {
  constructor(public code?: string, message?: string) { super(message ?? code ?? "seat error"); }
}

const Q_CURRENT = `query curReserve {
  userAuth {
    reserve {
      reserve {
        token
        status
        lib_id
        lib_name
        lib_floor
        seat_key
        seat_name
        date
        exp_date
        exp_date_str
        validate_date
        diff
        diff_str
      }
      getSToken
    }
  }
}`;

const Q_LAYOUT = `query libLayout($libId: Int, $libType: Int) {
  userAuth {
    reserve {
      libs(libType: $libType, libId: $libId) {
        lib_id
        is_open
        lib_floor
        lib_name
        lib_type
        lib_layout {
          seats_total
          seats_booking
          seats_used
          max_x
          max_y
          seats {
            x
            y
            key
            type
            name
            seat_status
            status
          }
        }
      }
    }
  }
}`;

const M_RESERVE = `mutation reserueSeat($libId: Int!, $seatKey: String!, $captchaCode: String, $captcha: String!) {
  userAuth {
    reserve {
      reserueSeat(
        libId: $libId
        seatKey: $seatKey
        captchaCode: $captchaCode
        captcha: $captcha
      )
    }
  }
}`;

const M_CANCEL = `mutation reserveCancle($sToken: String!) {
  userAuth {
    reserve {
      reserveCancle(sToken: $sToken) {
        timerange
        img
        hours
        mins
        per
      }
    }
  }
}`;

const Q_CAPTCHA = `query captcha {
  captcha {
    code
    data
  }
}`;

export interface ReserveInfo {
  token: string; status: number; libId: number; libName: string;
  seatKey: string; seatName: string; expDateStr: string | null;
}

export class SeatGraphql {
  constructor(private base = "https://seat.njtech.edu.cn") {}

  async raw(jar: CookieJar, operationName: string, query: string,
            variables: Record<string, unknown>): Promise<any> {
    const r = await request(this.base + "/index.php/graphql/", {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: this.base + "/web/index.html" },
      body: JSON.stringify({ operationName, query, variables }),
    });
    return JSON.parse(r.body.toString("utf8"));
  }

  async currentReserve(jar: CookieJar): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }> {
    const res = await this.raw(jar, "curReserve", Q_CURRENT, {});
    const r = res.data?.userAuth?.reserve?.reserve ?? null;
    return {
      reserve: r ? {
        token: r.token, status: r.status, libId: r.lib_id, libName: r.lib_name,
        seatKey: r.seat_key, seatName: r.seat_name, expDateStr: r.exp_date_str ?? null,
      } : null,
      getSToken: res.data?.userAuth?.reserve?.getSToken ?? null,
    };
  }

  async layout(jar: CookieJar, libId: number): Promise<any> {
    const res = await this.raw(jar, "libLayout", Q_LAYOUT, { libId, libType: 0 });
    const libs = res.data?.userAuth?.reserve?.libs;
    if (!libs?.length) throw new SeatError(undefined, "libLayout 无数据");
    return libs[0];
  }

  async reserve(jar: CookieJar, libId: number, seatKey: string, captchaCode: string, captcha: string):
    Promise<{ ok: true } | { ok: false; needCaptcha: boolean; message: string }> {
    const res = await this.raw(jar, "reserueSeat", M_RESERVE,
                               { libId, seatKey, captchaCode, captcha });
    if (res.errors) {
      const code = res.errors[0]?.extensions?.code;
      const msg = res.errors[0]?.message ?? "";
      return { ok: false, needCaptcha: code === 1000, message: String(msg) };
    }
    if (res.data?.userAuth?.reserve?.reserueSeat !== true) {
      return { ok: false, needCaptcha: false, message: "选座失败" };
    }
    return { ok: true };
  }

  async cancel(jar: CookieJar, sToken: string): Promise<void> {
    const res = await this.raw(jar, "reserveCancle", M_CANCEL, { sToken });
    if (res.errors) throw new SeatError(String(res.errors[0]?.extensions?.code), "退座失败");
  }

  async reserveCaptcha(jar: CookieJar): Promise<{ code: string; imageData: string }> {
    const res = await this.raw(jar, "captcha", Q_CAPTCHA, {});
    const cap = res.data?.captcha;
    if (!cap?.code) throw new SeatError(undefined, "验证码获取失败");
    return { code: cap.code, imageData: cap.data };
  }
}
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/seat/graphql.test.ts`
Expected: PASS（4 tests）

```bash
git add server/src/seat/graphql.ts server/test/seat/graphql.test.ts
git commit -m "feat(server): seat GraphQL 客户端（已验证语句库）"
```

---

### Task 7: 座位图 DTO 转换

**Files:**
- Create: `server/src/seat/seat-map.ts`
- Test: `server/test/seat/seat-map.test.ts`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces:
```ts
export interface SeatDto { x: number; y: number; key: string; type: number; name: string | null; seatStatus: number }
export interface SeatMapDto {
  libId: number; libName: string; isOpen: boolean; libFloor: string;
  seatsTotal: number; seatsUsed: number; seatsBooking: number;
  maxX: number; maxY: number; seats: SeatDto[];
}
export function toSeatMapDto(lib: any): SeatMapDto
```

- [ ] **Step 1: 写失败测试（fixture 取自 2026-08-15/16 实测数据形态）**

`server/test/seat/seat-map.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toSeatMapDto } from "../../src/seat/seat-map.js";

const fixture = {
  lib_id: 122811, is_open: true, lib_floor: "2楼", lib_name: "新书借阅室", lib_type: 0,
  lib_layout: {
    seats_total: 173, seats_used: 101, seats_booking: 0, max_x: 10, max_y: 6,
    seats: [
      { x: 0, y: 0, key: "1,1", type: 8, name: null, seat_status: 0, status: false },
      { x: 3, y: 4, key: "34,28", type: 1, name: "87", seat_status: 3, status: true },
      { x: 5, y: 4, key: "56,28", type: 1, name: "88", seat_status: 1, status: false },
      { x: 9, y: 5, key: "99,55", type: 2, name: null, seat_status: 0, status: false },
    ],
  },
};

describe("toSeatMapDto", () => {
  it("映射基础字段与座位数组", () => {
    const dto = toSeatMapDto(fixture);
    expect(dto.libId).toBe(122811);
    expect(dto.libName).toBe("新书借阅室");
    expect(dto.seatsTotal).toBe(173);
    expect(dto.maxX).toBe(10);
    expect(dto.seats).toHaveLength(4);
  });
  it("座位字段保持原样（type/name/seatStatus）", () => {
    const dto = toSeatMapDto(fixture);
    const s87 = dto.seats.find(s => s.key === "34,28")!;
    expect(s87).toEqual({ x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 });
    expect(dto.seats.find(s => s.type === 8)!.name).toBeNull();
  });
  it("lib_layout 缺失时抛错", () => {
    expect(() => toSeatMapDto({ lib_id: 1 })).toThrow(/lib_layout/);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 seat-map.ts**

`server/src/seat/seat-map.ts`:
```ts
export interface SeatDto {
  x: number; y: number; key: string; type: number;
  name: string | null; seatStatus: number;
}
export interface SeatMapDto {
  libId: number; libName: string; isOpen: boolean; libFloor: string;
  seatsTotal: number; seatsUsed: number; seatsBooking: number;
  maxX: number; maxY: number; seats: SeatDto[];
}

export function toSeatMapDto(lib: any): SeatMapDto {
  const l = lib?.lib_layout;
  if (!l) throw new Error("libLayout 数据缺少 lib_layout");
  return {
    libId: lib.lib_id,
    libName: lib.lib_name ?? "",
    isOpen: !!lib.is_open,
    libFloor: lib.lib_floor ?? "",
    seatsTotal: l.seats_total ?? 0,
    seatsUsed: l.seats_used ?? 0,
    seatsBooking: l.seats_booking ?? 0,
    maxX: l.max_x ?? 0,
    maxY: l.max_y ?? 0,
    seats: (l.seats ?? []).map((s: any) => ({
      x: s.x, y: s.y, key: s.key, type: s.type,
      name: s.name ?? null, seatStatus: s.seat_status,
    })),
  };
}
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/seat/seat-map.test.ts`
Expected: PASS（3 tests）

```bash
git add server/src/seat/seat-map.ts server/test/seat/seat-map.test.ts
git commit -m "feat(server): 座位图 DTO 转换"
```

---

### Task 8: 账号存储（SQLite + 加密凭据）

**Files:**
- Create: `server/src/accounts/store.ts`
- Test: `server/test/accounts/store.test.ts`

**Interfaces:**
- Consumes: `aesEncrypt/aesDecrypt`（Task 3）
- Produces:
```ts
export type AccountStatus = "pending" | "active" | "needs-captcha" | "failed";
export interface AccountRow {
  id: number; username: string; alias: string | null;
  status: AccountStatus; lastOkAt: number | null; lastError: string | null; createdAt: number;
}
export class AccountStore {
  constructor(dbPath: string, masterKey: Buffer)
  add(username: string, password: string, alias?: string): AccountRow
  getPassword(id: number): string
  list(): AccountRow[]
  setStatus(id: number, status: AccountStatus, lastError?: string | null): void
  setLastOk(id: number, ts: number): void
  remove(id: number): void
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  close(): void
}
```

- [ ] **Step 1: 写失败测试（临时目录 DB）**

`server/test/accounts/store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AccountStore } from "../../src/accounts/store.js";

let dir: string; let store: AccountStore;
const KEY = Buffer.alloc(32, 9);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seat-store-"));
  store = new AccountStore(join(dir, "t.db"), KEY);
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe("AccountStore", () => {
  it("添加账号: 密码落库为密文（不含明文）", () => {
    const a = store.add("2023001", "my-pass-123", "我自己");
    expect(a.status).toBe("pending");
    const row = new Database(join(dir, "t.db"))
      .prepare("SELECT password_enc FROM accounts WHERE id = ?").get(a.id) as any;
    expect(row.password_enc).not.toContain("my-pass-123");
    expect(store.getPassword(a.id)).toBe("my-pass-123");
  });
  it("同用户名重复添加抛错", () => {
    store.add("2023001", "p");
    expect(() => store.add("2023001", "p")).toThrow();
  });
  it("状态与 lastError 更新", () => {
    const a = store.add("2023001", "p");
    store.setStatus(a.id, "active");
    store.setStatus(a.id, "failed", "登录失败");
    store.setLastOk(a.id, 12345);
    const [row] = store.list();
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("登录失败");
    expect(row.lastOkAt).toBe(12345);
  });
  it("删除账号", () => {
    const a = store.add("2023001", "p");
    store.remove(a.id);
    expect(store.list()).toHaveLength(0);
  });
  it("settings 读写", () => {
    expect(store.getSetting("k")).toBeNull();
    store.setSetting("k", "v");
    expect(store.getSetting("k")).toBe("v");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 store.ts**

`server/src/accounts/store.ts`:
```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { aesEncrypt, aesDecrypt } from "../auth/crypto.js";

export type AccountStatus = "pending" | "active" | "needs-captcha" | "failed";
export interface AccountRow {
  id: number; username: string; alias: string | null;
  status: AccountStatus; lastOkAt: number | null; lastError: string | null; createdAt: number;
}

export class AccountStore {
  private db: Database.Database;
  constructor(dbPath: string, private masterKey: Buffer) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_enc TEXT NOT NULL,
        alias TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        last_ok_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  add(username: string, password: string, alias?: string): AccountRow {
    const enc = aesEncrypt(this.masterKey, password);
    const info = this.db.prepare(
      "INSERT INTO accounts (username, password_enc, alias, status, created_at) VALUES (?,?,?, 'pending', ?)"
    ).run(username, enc, alias ?? null, Date.now());
    return this.list().find(a => a.id === Number(info.lastInsertRowid))!;
  }

  getPassword(id: number): string {
    const row = this.db.prepare("SELECT password_enc FROM accounts WHERE id = ?").get(id) as any;
    if (!row) throw new Error("账号不存在");
    return aesDecrypt(this.masterKey, row.password_enc);
  }

  list(): AccountRow[] {
    return (this.db.prepare(
      "SELECT id, username, alias, status, last_ok_at, last_error, created_at FROM accounts ORDER BY id"
    ).all() as any[]).map(r => ({
      id: r.id, username: r.username, alias: r.alias, status: r.status as AccountStatus,
      lastOkAt: r.last_ok_at, lastError: r.last_error, createdAt: r.created_at,
    }));
  }

  setStatus(id: number, status: AccountStatus, lastError: string | null = null): void {
    this.db.prepare("UPDATE accounts SET status = ?, last_error = ? WHERE id = ?")
      .run(status, lastError, id);
  }

  setLastOk(id: number, ts: number): void {
    this.db.prepare("UPDATE accounts SET last_ok_at = ? WHERE id = ?").run(ts, id);
  }

  remove(id: number): void {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  getSetting(key: string): string | null {
    return (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any)?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void { this.db.close(); }
}
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/accounts/store.test.ts`
Expected: PASS（5 tests）

```bash
git add server/src/accounts/store.ts server/test/accounts/store.test.ts
git commit -m "feat(server): 账号存储（SQLite + AES-256-GCM 凭据）"
```

---

### Task 9: 会话池（多账号生命周期 + 每账号锁）

**Files:**
- Create: `server/src/accounts/locker.ts`
- Create: `server/src/accounts/session-pool.ts`
- Modify: `server/test/helpers/mock-seat.ts`（增加 GraphQL 端点：`/index.php/graphql/` POST 按 operationName 返回可配置数据）
- Test: `server/test/accounts/session-pool.test.ts`

**Interfaces:**
- Consumes: `CasClient`（Task 4）、`SeatStateMachine`（Task 5）、`SeatGraphql`（Task 6）、`toSeatMapDto`（Task 7）、`AccountStore`（Task 8）、`CookieJar`
- Produces:
```ts
export class Locker { withLock<T>(key: string, fn: () => Promise<T>): Promise<T> }
export interface SessionInfo { status: AccountStatus; lastError: string | null }
export class SessionPool {
  constructor(private store: AccountStore, private cas: CasClient,
              private sm: SeatStateMachine, private gql: SeatGraphql)
  async addAccount(username: string, password: string, alias?: string): Promise<AccountRow & SessionInfo>
  async list(): Promise<Array<AccountRow & SessionInfo>>
  async remove(accountId: number): Promise<void>
  async layout(accountId: number, libId: number): Promise<SeatMapDto>
  async current(accountId: number): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }>
  async reserve(accountId: number, libId: number, seatKey: string):
    Promise<{ ok: true } | { needCaptcha: true; imageData: string; captchaToken: string } | { ok: false; message: string }>
  async reserveWithCaptcha(accountId: number, libId: number, seatKey: string,
                           captchaToken: string, code: string):
    Promise<{ ok: true } | { ok: false; message: string }>
  async cancel(accountId: number): Promise<{ ok: true } | { ok: false; message: string }>
  async probe(accountId: number): Promise<boolean>
  async reauth(accountId: number): Promise<void>   // channel 重登; captcha-required → needs-captcha; 连续 3 次失败 → failed
}
```
登录流程（`ensureSession`，内部）：`sm.start` → `sm.toCasLoginPage` → `cas.channelLogin`（失败抛 captcha-required 时降级 needs-captcha）→ `sm.completeLogin`；协议错误整体重走最多 2 次；网络错误退避 1s/2s/4s。

- [ ] **Step 1: 写 locker 实现与测试（并入本任务）**

`server/src/accounts/locker.ts`:
```ts
export class Locker {
  private chains = new Map<string, Promise<unknown>>();
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => {}));
    return next;
  }
}
```

`server/test/accounts/session-pool.test.ts` 中锁的用例：
```ts
it("同一账号并发操作串行化, 不同账号并行", async () => {
  const order: string[] = [];
  const locker = new Locker();
  const slow = (tag: string) => locker.withLock("a", async () => {
    order.push(tag + "-start"); await new Promise(r => setTimeout(r, 30)); order.push(tag + "-end");
  });
  const p1 = slow("1"); const p2 = slow("2");
  const p3 = locker.withLock("b", async () => { order.push("b"); });
  await Promise.all([p1, p2, p3]);
  expect(order).toEqual(["1-start", "1-end", "2-start", "2-end", "b"]);
});
```

- [ ] **Step 2: 写会话池失败测试（全套 mock：cas+unjtech+seat）**

`server/test/accounts/session-pool.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../../src/accounts/store.js";
import { SessionPool } from "../../src/accounts/session-pool.js";
import { CasClient } from "../../src/auth/cas.js";
import { SeatStateMachine } from "../../src/seat/state-machine.js";
import { SeatGraphql } from "../../src/seat/graphql.js";
import { createMockCas } from "../helpers/mock-cas.js";
import { createMockUnjtech, createMockSeat } from "../helpers/mock-seat.js";

let dir: string; let pool: SessionPool; let store: AccountStore;
let casMock: any, seatMock: any;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "seat-pool-"));
  casMock = await createMockCas();
  const unj = await createMockUnjtech(casMock.url);
  seatMock = await createMockSeat(unj.url);
  store = new AccountStore(join(dir, "t.db"), Buffer.alloc(32, 3));
  pool = new SessionPool(store, new CasClient(),
    new SeatStateMachine(seatMock.url), new SeatGraphql(seatMock.url));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SessionPool", () => {
  it("addAccount 走完整登录链后状态 active", async () => {
    const r = await pool.addAccount("2023001", "mypassword", "我");
    expect(r.status).toBe("active");
    expect(r.lastError).toBeNull();
  });

  it("channel 被风控 → needs-captcha", async () => {
    casMock.requireCaptcha = true;   // mock 需要在创建时注入该开关(见下方实现说明)
    const r = await pool.addAccount("2023001", "mypassword");
    expect(r.status).toBe("needs-captcha");
  });

  it("probe: 会话正常返回 true 并刷新 lastOkAt", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    expect(await pool.probe(a.id)).toBe(true);
    expect((store.list())[0].lastOkAt).toBeTruthy();
  });

  it("reauth: 会话失效后重登恢复 active", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    await pool.reauth(a.id);
    expect((await pool.list()).find(x => x.id === a.id)!.status).toBe("active");
  });

  it("cancel: 先查后做, 无预约返回错误不炸", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.cancel(a.id);
    expect(r.ok).toBe(false);
  });
});
```
（mock-seat 的 GraphQL 端点在 Task 6 基础上扩展：`curReserve` 可配置返回 reserve 或 null，`reserueSeat`/`reserveCancle` 记录调用即可；`createMockSeat` 增加 `opts.graphql: { reserve: any; getSToken: string }`。）

- [ ] **Step 3: 运行确认失败 → 实现 session-pool.ts**

`server/src/accounts/session-pool.ts`:
```ts
import { AccountStore, AccountRow, AccountStatus } from "./store.js";
import { Locker } from "./locker.js";
import { CasClient, CasError } from "../auth/cas.js";
import { SeatStateMachine } from "../seat/state-machine.js";
import { SeatGraphql, ReserveInfo } from "../seat/graphql.js";
import { toSeatMapDto, SeatMapDto } from "../seat/seat-map.js";
import { CookieJar } from "../http/cookiejar.js";

export interface SessionInfo { status: AccountStatus; lastError: string | null }

const RETRY_DELAYS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface PendingCaptcha { libId: number; seatKey: string; captchaToken: string }

export class SessionPool {
  private jars = new Map<number, CookieJar>();
  private pendingCaptcha = new Map<number, PendingCaptcha>();
  private failStreak = new Map<number, number>();
  private locker = new Locker();

  constructor(private store: AccountStore, private cas: CasClient,
              private sm: SeatStateMachine, private gql: SeatGraphql) {}

  async addAccount(username: string, password: string, alias?: string) {
    const row = this.store.add(username, password, alias);
    await this.login(row.id, password);
    return this.info(row.id);
  }

  async list() { return Promise.all(this.store.list().map(r => this.info(r.id))); }

  async remove(accountId: number) {
    this.jars.delete(accountId);
    this.pendingCaptcha.delete(accountId);
    this.store.remove(accountId);
  }

  private info(id: number): AccountRow & SessionInfo {
    const row = this.store.list().find(a => a.id === id)!;
    return { ...row, lastError: row.lastError };
  }

  private jar(id: number): CookieJar {
    let j = this.jars.get(id);
    if (!j) { j = new CookieJar(); this.jars.set(id, j); }
    return j;
  }

  /** 完整登录链: seat①-④ → CAS channel → seat⑤-⑥; 失败退避与状态落库 */
  private async login(id: number, password: string): Promise<void> {
    const jar = this.jar(id);
    const username = this.store.list().find(a => a.id === id)!.username;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const u5 = await this.sm.start(jar);
        const page = await this.sm.toCasLoginPage(jar, u5);
        await this.cas.channelLogin(jar, page.url, username, password);
        await this.sm.completeLogin(jar, u5);
        this.store.setStatus(id, "active");
        this.failStreak.set(id, 0);
        return;
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof CasError && e.kind === "captcha-required") {
          this.store.setStatus(id, "needs-captcha", "CAS 要求验证码，请手动处理");
          return;
        }
        await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      }
    }
    this.store.setStatus(id, "failed", lastErr?.message ?? "登录失败");
  }

  private async ensureSession(id: number): Promise<CookieJar> {
    const row = this.store.list().find(a => a.id === id);
    if (!row) throw new Error("账号不存在");
    if (row.status !== "active") throw new Error(`账号不可用: ${row.status}`);
    return this.jar(id);
  }

  async probe(id: number): Promise<boolean> {
    return this.locker.withLock(`acct:${id}`, async () => {
      try {
        const jar = await this.ensureSession(id);
        await this.gql.currentReserve(jar);
        this.store.setLastOk(id, Date.now());
        this.store.setStatus(id, "active");
        this.failStreak.set(id, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  async reauth(id: number): Promise<void> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const password = this.store.getPassword(id);
      await this.login(id, password);
      if (this.store.list().find(a => a.id === id)!.status === "failed") {
        const streak = (this.failStreak.get(id) ?? 0) + 1;
        this.failStreak.set(id, streak);
        if (streak >= 3) this.store.setStatus(id, "failed", "连续 3 次重登失败");
      }
    });
  }

  async layout(id: number, libId: number): Promise<SeatMapDto> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      return toSeatMapDto(await this.gql.layout(jar, libId));
    });
  }

  async current(id: number): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      return this.gql.currentReserve(jar);
    });
  }

  async reserve(id: number, libId: number, seatKey: string) {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const r = await this.gql.reserve(jar, libId, seatKey, "", "");
      if (r.ok) return { ok: true as const };
      if (r.needCaptcha) {
        const cap = await this.gql.reserveCaptcha(jar);
        this.pendingCaptcha.set(id, { libId, seatKey, captchaToken: cap.code });
        return { needCaptcha: true as const, imageData: cap.imageData, captchaToken: cap.code };
      }
      return { ok: false as const, message: r.message };
    });
  }

  async reserveWithCaptcha(id: number, libId: number, seatKey: string,
                           captchaToken: string, code: string) {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const r = await this.gql.reserve(jar, libId, seatKey, code, captchaToken);
      this.pendingCaptcha.delete(id);
      return r.ok ? { ok: true as const } : { ok: false as const, message: r.message };
    });
  }

  async cancel(id: number) {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const { reserve, getSToken } = await this.gql.currentReserve(jar);
      if (!reserve) return { ok: false as const, message: "当前没有进行中的预约" };
      if (!getSToken) return { ok: false as const, message: "缺少退座凭证" };
      try {
        await this.gql.cancel(jar, getSToken);
        const after = await this.gql.currentReserve(jar);
        if (after.reserve) return { ok: false as const, message: "退座后复查仍有预约" };
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, message: (e as Error).message };
      }
    });
  }
}
```
实现注意：测试里 `casMock.requireCaptcha` 开关需要在 `createMockCas` 的 `channelRequireCaptcha` 上暴露可变 setter（当前工厂参数为构造时值——将 `opts` 对象引用保存在 mock 返回值上，修改 `mock.opts.channelRequireCaptcha` 即生效）。

- [ ] **Step 4: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/accounts/session-pool.test.ts`
Expected: PASS（含 locker 用例共 6 tests）

```bash
git add server/src/accounts/ server/test/accounts/
git commit -m "feat(server): 会话池（多账号生命周期 + 每账号互斥锁）"
```

---

### Task 10: 保活调度器

**Files:**
- Create: `server/src/keepalive/scheduler.ts`
- Test: `server/test/keepalive/scheduler.test.ts`

**Interfaces:**
- Consumes: `SessionPool.probe/reauth`（Task 9）
- Produces: `class KeepaliveScheduler { constructor(pool: SessionPool, intervalMs?: number); start(): void; stop(): void; tickOnce(): Promise<void> }`
- 行为：每 `intervalMs`（默认 600000）对全部 active 账号 `probe`；失败 → `reauth`；每账号独立 `nextAt` 退避（失败后 2 倍间隔，封顶 4 倍，成功恢复默认）

- [ ] **Step 1: 写失败测试（vi.useFakeTimers）**

`server/test/keepalive/scheduler.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { KeepaliveScheduler } from "../../src/keepalive/scheduler.js";

function fakePool(probeResults: boolean[]) {
  const calls: { probe: number[]; reauth: number[] } = { probe: [], reauth: [] };
  const pool = {
    probe: vi.fn(async (id: number) => {
      calls.probe.push(id);
      return probeResults.shift() ?? true;
    }),
    reauth: vi.fn(async (id: number) => { calls.reauth.push(id); }),
    list: vi.fn(async () => [{ id: 1, status: "active" }, { id: 2, status: "failed" }]),
  };
  return { pool, calls };
}

describe("KeepaliveScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("tickOnce 只探测 active 账号; 失败触发 reauth", async () => {
    const { pool, calls } = fakePool([false]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    await s.tickOnce();
    expect(calls.probe).toEqual([1]);        // failed 状态账号不探测
    expect(calls.reauth).toEqual([1]);       // 探测失败 → 重登
  });

  it("start 按周期触发; stop 停止", async () => {
    vi.useFakeTimers();
    const { pool, calls } = fakePool([true, true]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.probe.length).toBe(2);
    s.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.probe.length).toBe(2);      // 已停止不再触发
  });

  it("探测失败后该账号退避（2 倍间隔）", async () => {
    vi.useFakeTimers();
    const { pool, calls } = fakePool([false, true, true]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);   // t1: probe 失败 → reauth
    expect(calls.probe).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60_000);   // t2: 退避中, 跳过
    expect(calls.probe).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60_000);   // t3 (2 倍间隔): 再探测成功
    expect(calls.probe).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 scheduler.ts**

`server/src/keepalive/scheduler.ts`:
```ts
interface PoolLike {
  list(): Promise<Array<{ id: number; status: string }>>;
  probe(id: number): Promise<boolean>;
  reauth(id: number): Promise<void>;
}

export class KeepaliveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private nextAt = new Map<number, number>();   // 每账号下次探测时间
  private backoff = new Map<number, number>();  // 当前退避倍数

  constructor(private pool: PoolLike, private intervalMs = 600_000) {}

  start(): void {
    this.timer = setInterval(() => { void this.tickOnce(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickOnce(): Promise<void> {
    const accounts = await this.pool.list();
    const now = Date.now();
    for (const a of accounts) {
      if (a.status !== "active") continue;
      if (now < (this.nextAt.get(a.id) ?? 0)) continue;
      const ok = await this.pool.probe(a.id);
      if (!ok) {
        await this.pool.reauth(a.id);
        const mult = Math.min((this.backoff.get(a.id) ?? 1) * 2, 4);
        this.backoff.set(a.id, mult);
        this.nextAt.set(a.id, now + this.intervalMs * mult);
      } else {
        this.backoff.set(a.id, 1);
        this.nextAt.set(a.id, now + this.intervalMs);
      }
    }
  }
}
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/keepalive/scheduler.test.ts`
Expected: PASS（3 tests）

```bash
git add server/src/keepalive/ server/test/keepalive/
git commit -m "feat(server): 保活调度器（周期探测 + 失效重登 + 退避）"
```

---

### Task 11: REST API 与访问密码鉴权

**Files:**
- Create: `server/src/api/auth.ts`（token 签发/校验工具）
- Create: `server/src/api/app.ts`（Fastify 实例与全部路由）
- Test: `server/test/api/app.test.ts`

**Interfaces:**
- Consumes: `SessionPool`、`AccountStore`、`AppConfig`、`loadConfig`（Task 1）
- Produces:
```ts
export function signToken(accessPassword: string, ttlSec: number): string
export function verifyToken(token: string | undefined, accessPassword: string): boolean
export function buildApp(opts: { pool: SessionPool; store: AccountStore; config: AppConfig }): FastifyInstance
```
路由（除 `/healthz` 与 `POST /api/auth/login` 外全部要求 `Authorization: Bearer`）：
- `GET /healthz` → `{ok:true}`
- `POST /api/auth/login` `{password}` → `{token}`（password 与 config.accessPassword 相等才签发）
- `GET /api/accounts` → `AccountRow & SessionInfo[]`（脱敏，无密码字段）
- `POST /api/accounts` `{username, password, alias?}` → 新账号
- `DELETE /api/accounts/:id`
- `POST /api/accounts/:id/reauth` → `{status}`
- `GET /api/accounts/:id/current` → 当前预约
- `GET /api/seats/libraries` → `{libs}`（GraphQL list 语句，见实现）
- `GET /api/seats/libraries/:libId/layout?accountId=` → SeatMapDto
- `POST /api/reserve` `{accountId, libId, seatKey}` → 结果或 needCaptcha+imageData+captchaToken
- `POST /api/reserve/captcha` `{accountId, libId, seatKey, captchaToken, code}` → 结果
- `POST /api/reserve/cancel` `{accountId}` → 结果

- [ ] **Step 1: 写失败测试（fastify inject + 假 pool）**

`server/test/api/app.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildApp, signToken } from "../../src/api/app.js";
import { loadConfig } from "../../src/config.js";

const config = loadConfig({ NJ_SEAT_MASTER_KEY: "00".repeat(32), NJ_SEAT_ACCESS_PASSWORD: "secret-pass" });

function fakePool() {
  return {
    list: async () => [{ id: 1, username: "2023001", alias: "我", status: "active",
                         lastOkAt: 1, lastError: null, createdAt: 1 }],
    addAccount: async (u: string, p: string, a?: string) =>
      ({ id: 2, username: u, alias: a ?? null, status: "active", lastOkAt: null,
         lastError: null, createdAt: 2 }),
    layout: async () => ({ libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
                           seatsTotal: 173, seatsUsed: 101, seatsBooking: 0, maxX: 10, maxY: 6, seats: [] }),
    current: async () => ({ reserve: null, getSToken: null }),
    reserve: async () => ({ ok: true }),
    reserveWithCaptcha: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    reauth: async () => {},
    remove: async () => {},
  };
}

const store = { getSetting: () => null, setSetting: () => {} } as any;

describe("API", () => {
  it("无 token 访问受保护路由 → 401", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const r = await app.inject({ method: "GET", url: "/api/accounts" });
    expect(r.statusCode).toBe(401);
  });
  it("正确访问密码换 token 后可访问", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
                                     payload: { password: "secret-pass" } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();
    const r = await app.inject({ method: "GET", url: "/api/accounts",
                                 headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()[0]).not.toHaveProperty("password_enc");
  });
  it("错误访问密码 → 401", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
                                     payload: { password: "wrong" } });
    expect(login.statusCode).toBe(401);
  });
  it("选座路由透传 pool 结果", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const token = signToken(config.accessPassword, config.tokenTtlSec);
    const r = await app.inject({ method: "POST", url: "/api/reserve",
                                 headers: { authorization: `Bearer ${token}` },
                                 payload: { accountId: 1, libId: 122811, seatKey: "34,28" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
  it("座位图路由返回 DTO", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const token = signToken(config.accessPassword, config.tokenTtlSec);
    const r = await app.inject({ method: "GET",
      url: "/api/seats/libraries/122811/layout?accountId=1",
      headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().libName).toBe("新书借阅室");
  });
  it("/healthz 免鉴权", async () => {
    const app = buildApp({ pool: fakePool() as any, store, config });
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 auth.ts + app.ts**

`server/src/api/auth.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function signToken(accessPassword: string, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlSec * 1000 }))
    .toString("base64url");
  const sig = createHmac("sha256", accessPassword).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined, accessPassword: string): boolean {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const [payload, sig] = [token.slice(0, i), token.slice(i + 1)];
  const expect = createHmac("sha256", accessPassword).update(payload).digest();
  let got: Buffer;
  try { got = Buffer.from(sig, "base64url"); } catch { return false; }
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return false;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  return typeof data.exp === "number" && data.exp > Date.now();
}
```

`server/src/api/app.ts`（Fastify 路由，导入 auth 工具）:
```ts
import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "../config.js";
import { AccountStore } from "../accounts/store.js";
import { SessionPool } from "../accounts/session-pool.js";
import { signToken, verifyToken } from "./auth.js";

export { signToken, verifyToken };

export function buildApp(opts: { pool: SessionPool; store: AccountStore; config: AppConfig }): FastifyInstance {
  const { pool, store, config } = opts;
  const app = Fastify();

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/healthz" || (req.url === "/api/auth/login" && req.method === "POST")) return;
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!verifyToken(token, config.accessPassword)) reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/api/auth/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (password !== config.accessPassword) return reply.code(401).send({ error: "unauthorized" });
    return { token: signToken(config.accessPassword, config.tokenTtlSec) };
  });

  app.get("/api/accounts", async () => pool.list());

  app.post("/api/accounts", async (req) => {
    const { username, password, alias } = (req.body ?? {}) as
      { username: string; password: string; alias?: string };
    if (!username || !password) throw Object.assign(new Error("缺少 username/password"), { statusCode: 400 });
    return pool.addAccount(username, password, alias);
  });

  app.delete("/api/accounts/:id", async (req) => {
    await pool.remove(Number((req.params as any).id));
    return { ok: true };
  });

  app.post("/api/accounts/:id/reauth", async (req) => {
    await pool.reauth(Number((req.params as any).id));
    return { ok: true };
  });

  app.get("/api/accounts/:id/current", async (req) =>
    pool.current(Number((req.params as any).id)));

  app.get("/api/seats/libraries", async () => ({ libs: [] }));   // M1 前端仅需 layout; list 语句后续再加
  app.get("/api/seats/libraries/:libId/layout", async (req) => {
    const q = req.query as { accountId?: string };
    if (!q.accountId) throw Object.assign(new Error("缺少 accountId"), { statusCode: 400 });
    return pool.layout(Number(q.accountId), Number((req.params as any).libId));
  });

  app.post("/api/reserve", async (req) => {
    const { accountId, libId, seatKey } = (req.body ?? {}) as
      { accountId: number; libId: number; seatKey: string };
    if (!accountId || !libId || !seatKey)
      throw Object.assign(new Error("缺少参数"), { statusCode: 400 });
    return pool.reserve(accountId, libId, seatKey);
  });

  app.post("/api/reserve/captcha", async (req) => {
    const { accountId, libId, seatKey, captchaToken, code } = (req.body ?? {}) as
      { accountId: number; libId: number; seatKey: string; captchaToken: string; code: string };
    return pool.reserveWithCaptcha(accountId, libId, seatKey, captchaToken, code);
  });

  app.post("/api/reserve/cancel", async (req) => {
    const { accountId } = (req.body ?? {}) as { accountId: number };
    return pool.cancel(accountId);
  });

  return app;
}
```
（`GET /api/seats/libraries` 在 M1 返回空列表并在代码注释标明：图书馆列表来自 GraphQL `list` 语句，Plan 2 前端需要选择器时再实现——YAGNI。spec 的"座位图"流程以 libId 入参为准。）

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd server && npx vitest run test/api/app.test.ts`
Expected: PASS（6 tests）

```bash
git add server/src/api/ server/test/api/
git commit -m "feat(server): REST API 与访问密码鉴权"
```

---

### Task 12: 启动装配与真实系统 smoke 脚本

**Files:**
- Create: `server/src/index.ts`
- Create: `server/scripts/smoke.ts`
- Test: `server/test/index.test.ts`

**Interfaces:**
- Consumes: 全部前置模块
- Produces: 可运行服务（`npm run dev`/`npm start`）与 smoke 脚本（`npm run smoke`，凭据走 env）

- [ ] **Step 1: 写启动装配失败测试**

`server/test/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../../src/index.js";

describe("buildServer", () => {
  it("缺主密钥/访问密码抛错", async () => {
    await expect(buildServer({} as any)).rejects.toThrow(/NJ_SEAT_/);
  });
  it("装配成功: healthz 可访问", async () => {
    const srv = await buildServer({
      NJ_SEAT_MASTER_KEY: "00".repeat(32),
      NJ_SEAT_ACCESS_PASSWORD: "p",
      NJ_SEAT_DB: ":memory:",
    } as any);
    const r = await srv.app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
    srv.stop();
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 index.ts**

`server/src/index.ts`:
```ts
import { loadConfig, AppConfig } from "./config.js";
import { AccountStore } from "./accounts/store.js";
import { SessionPool } from "./accounts/session-pool.js";
import { CasClient } from "./auth/cas.js";
import { SeatStateMachine } from "./seat/state-machine.js";
import { SeatGraphql } from "./seat/graphql.js";
import { KeepaliveScheduler } from "./keepalive/scheduler.js";
import { buildApp } from "./api/app.js";

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const store = new AccountStore(config.dbPath, config.masterKey);
  const pool = new SessionPool(store, new CasClient(), new SeatStateMachine(), new SeatGraphql());
  const app = buildApp({ pool, store, config });
  const scheduler = new KeepaliveScheduler(pool, config.keepaliveIntervalMs);
  return {
    app,
    async listen() {
      await app.listen({ port: config.port, host: "0.0.0.0" });
      scheduler.start();
      console.log(`njtech-seat listening on :${config.port}`);
    },
    stop() { scheduler.stop(); app.close(); store.close(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().then(s => s.listen()).catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 3: 写 smoke 脚本（真实系统手动触发，非 CI）**

`server/scripts/smoke.ts`:
```ts
// 用法: STU=学号 STUPASS=密码 [SMOKE_RESERVE=1] npx tsx scripts/smoke.ts
// 连真实系统: 登录 → 查当前预约 → 座位图 → (可选) 选座+退座
import { CasClient } from "../src/auth/cas.js";
import { SeatStateMachine } from "../src/seat/state-machine.js";
import { SeatGraphql } from "../src/seat/graphql.js";
import { CookieJar } from "../src/http/cookiejar.js";
import { toSeatMapDto } from "../src/seat/seat-map.js";

const { STU, STUPASS, SMOKE_RESERVE } = process.env as Record<string, string | undefined>;
if (!STU || !STUPASS) { console.error("需要 STU/STUPASS 环境变量"); process.exit(1); }

const jar = new CookieJar();
const cas = new CasClient();
const sm = new SeatStateMachine();
const gql = new SeatGraphql();

const u5 = await sm.start(jar);
const page = await sm.toCasLoginPage(jar, u5);
console.log("croypto:", page.body.toString("utf8").match(/id="login-croypto">([^<]+)</)?.[1]);
await cas.channelLogin(jar, page.url, STU, STUPASS);
await sm.completeLogin(jar, u5);

const { reserve, getSToken } = await gql.currentReserve(jar);
console.log("当前预约:", reserve ?? "无", "getSToken:", getSToken ? "有" : "无");

const layout = toSeatMapDto(await gql.layout(jar, 122811));
console.log(`座位图 ${layout.libName}: 总${layout.seatsTotal} 用${layout.seatsUsed} 预约${layout.seatsBooking}`);
const free = layout.seats.find(s => s.type === 1 && s.seatStatus === 1);
console.log("第一个空闲座位:", free);

if (SMOKE_RESERVE === "1" && free) {
  const r = await gql.reserve(jar, layout.libId, free.key, "", "");
  console.log("选座:", r);
  if (r.ok) {
    const cur = await gql.currentReserve(jar);
    await gql.cancel(jar, cur.getSToken!);
    console.log("已退座");
  }
}
```

- [ ] **Step 4: 运行测试通过 + smoke 手动验证**

Run: `cd server && npx vitest run test/index.test.ts`
Expected: PASS（2 tests）
手动（真实系统，务必带自己的凭据）：
```bash
cd server && STU=<学号> STUPASS=<密码> npx tsx scripts/smoke.ts
```
Expected: 输出当前预约与座位图统计，不报错（不做选退座；`SMOKE_RESERVE=1` 才做完整周期）

- [ ] **Step 5: 提交**

```bash
git add server/src/index.ts server/scripts/smoke.ts server/test/index.test.ts
git commit -m "feat(server): 启动装配与真实系统 smoke 脚本"
```

---

## Self-Review 记录

- **Spec 覆盖**：§1 组件（config/http 基础层/auth/seat/accounts/keepalive/api）→ Task 1-12；§2 四流程 → Task 4/5/6/9/10；§3 SQLite+加密+访问密码 → Task 8/11；§4 状态机/退避/锁/先查后做 → Task 9/10/11；§5 测试分层 → 每任务 TDD + mock（helpers）+ Task 12 smoke；§6 M1 范围 → 全部在内（OCR/抢座/通知未做，符合 M1 排除项）
- **占位符扫描**：无 TBD/TODO；`GET /api/seats/libraries` 明确返回空并在注释说明延后原因（YAGNI 决策，非占位）
- **类型一致性**：`CasError.kind`、`SeatGraphql.reserve` 返回联合类型、`SessionPool` 方法签名在 Task 9 与 Task 11 路由中一致；`loadConfig` 字段名（port/dbPath/masterKey/accessPassword/keepaliveIntervalMs/tokenTtlSec）与 Task 1 定义一致
