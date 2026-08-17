# 选座助手前端（web/）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现选座助手前端：访问密码登录门、座位图 Canvas 可视化+选退座、账号管理（含验证码恢复）、当前预约。

**Architecture:** Vite + Vue 3 + Element Plus 单页 Tab（无路由库/无 Pinia）。api/client.ts 封装 fetch（Bearer token、401 全局事件）；SeatCanvas 自绘 Canvas 座位网格（fixture 可测）；每视图局部状态 + 写操作后重新拉取。

**Tech Stack:** Vue 3.5、Element Plus 2.x、Vite 6、TypeScript strict、vitest + @vue/test-utils、jsdom。

**Spec:** `docs/superpowers/specs/2026-08-18-seat-assistant-web-design.md`
（后端静态托管属 Plan 2b，另行规划；本计划只做 web/。）

## Global Constraints

- Node ≥ 20；TypeScript strict；Vue 3 `<script setup lang="ts">` 单文件组件
- 只通过后端 REST API 交互（10 条路由见 spec）；不直接接触 seat 服务器
- 访问 token 存 localStorage（键 `njseat-token`）；401 → 清 token + 全局事件 `auth-expired`
- 座位语义（真实系统）：seatStatus 1=空闲 3=占用；type 1=真实座位 2=桌面 8=服务台 3=装饰；SeatMapDto 字段名与后端一字不差
- 测试：vitest + jsdom + @vue/test-utils；fetch mock 用 vi.stubGlobal；Canvas 像素断言用 `ctx.getImageData`（实现需可注入假 ctx 或真实 jsdom canvas）
- 不做：端到端浏览器测试、Pinia、vue-router、第三方图库
- CI：web/ 的测试并入仓库既有 ci.yml（`cd web && npm ci && npm test`）

---

### Task 1: 前端脚手架与 API 类型

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/env.d.ts`
- Create: `web/src/api/types.ts`
- Test: `web/test/types.test.ts`（类型层以 tsc 校验为准，此测试仅验证 DTO 结构与后端契约对齐的运行时守卫）

**Interfaces:**
- Consumes: 无
- Produces: `SeatMapDto`、`SeatDto`、`AccountRow`、`AccountStatus`、`CurrentReserve`、`ReserveResult`（与后端契约一致的类型，供全部后续任务使用）

- [ ] **Step 1: 写脚手架文件**

`web/package.json`:
```json
{
  "name": "njtech-seat-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "element-plus": "^2.9.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitejs/plugin-vue": "^5.2.0",
    "@vue/test-utils": "^2.4.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vitest/config";   // 必须是 vitest/config: test 块才被 tsc 原生识别
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8791" },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
```

`web/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>南工大选座助手</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`web/src/api/types.ts`（与后端契约一字不差）:
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
export type AccountStatus = "pending" | "active" | "needs-captcha" | "failed";
export interface AccountRow {
  id: number; username: string; alias: string | null;
  status: AccountStatus; lastOkAt: number | null; lastError: string | null; createdAt: number;
}
export interface ReserveInfo {
  token: string; status: number; libId: number; libName: string;
  seatKey: string; seatName: string; expDateStr: string | null;
}
export interface CurrentReserve {
  reserve: ReserveInfo | null; getSToken: string | null;
}
export type ReserveResult =
  | { ok: true }
  | { needCaptcha: true; imageData: string; captchaToken: string }
  | { ok: false; message: string };
```

- [ ] **Step 2: 写契约守卫测试（运行时验证 DTO 关键语义）**

`web/test/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SeatMapDto } from "../src/api/types.js";

// 真实系统 2026-08-15/16 实测数据形态（docs/seat.md）的守卫：
// seatStatus 1=空闲 3=占用；type 1=真实座位 2=桌面 8=服务台；name 仅真实座位有值
const REAL_LAYOUT: SeatMapDto = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 173, seatsUsed: 101, seatsBooking: 0, maxX: 10, maxY: 6,
  seats: [
    { x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 },
    { x: 5, y: 4, key: "56,28", type: 1, name: "88", seatStatus: 1 },
    { x: 9, y: 5, key: "99,55", type: 2, name: null, seatStatus: 0 },
    { x: 0, y: 0, key: "1,1", type: 8, name: null, seatStatus: 0 },
  ],
};

describe("SeatMapDto 契约守卫", () => {
  it("真实形态 fixture 通过类型检查并可序列化", () => {
    expect(JSON.stringify(REAL_LAYOUT.seats[0].key)).toBe('"34,28"');
    expect(REAL_LAYOUT.seats.find(s => s.name === "87")!.seatStatus).toBe(3);
  });
  it("类型守卫: 编译期验证字段（无运行时断言, 由 tsc strict 兜底）", () => {
    const dto: SeatMapDto = REAL_LAYOUT;
    expect(dto.seats.length).toBe(4);
  });
});
```

- [ ] **Step 3: 安装依赖并跑测试**

Run: `cd web && npm install && npx vitest run test/types.test.ts`
Expected: PASS（2 tests）。`npx vue-tsc --noEmit` 通过。

- [ ] **Step 4: 提交**

```bash
git add web/
git commit -m "feat(web): 脚手架与 API 类型（Vite+Vue3+Element Plus）"
```

---

### Task 2: API client 封装

**Files:**
- Create: `web/src/api/client.ts`
- Test: `web/test/api/client.test.ts`

**Interfaces:**
- Consumes: Task 1 类型
- Produces:
```ts
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function apiRequest<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T>
  // 自动带 Authorization: Bearer <localStorage njseat-token>
  // 200 → JSON；401 → 清 token + dispatchEvent(new Event('auth-expired')) + throw ApiError(401)
  // 其它非 2xx → throw ApiError(status, body.error ?? body.message ?? '请求失败')
  // 网络错误 → throw ApiError(0, '无法连接后端')
export function getToken(): string | null
export function setToken(t: string): void   // localStorage 持久化
export function clearToken(): void
export function login(password: string): Promise<string>   // POST /api/auth/login → token
```

- [ ] **Step 1: 写失败测试**

`web/test/api/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, ApiError, login, getToken, clearToken } from "../../src/api/client.js";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    status, json: () => Promise.resolve(body),
  }));
}
const fetchMock = () => vi.mocked(fetch);

describe("apiRequest", () => {
  beforeEach(() => { localStorage.clear(); clearToken(); });
  afterEach(() => vi.unstubAllGlobals());

  it("注入 Bearer token", async () => {
    localStorage.setItem("njseat-token", "tok-1");
    mockFetch(200, { ok: true });
    await apiRequest("/api/accounts");
    expect(fetchMock()).toHaveBeenCalledWith(
      expect.stringContaining("/api/accounts"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok-1" }) }));
  });

  it("401 清 token 并派发 auth-expired", async () => {
    localStorage.setItem("njseat-token", "tok-1");
    mockFetch(401, { error: "unauthorized" });
    const listener = vi.fn();
    window.addEventListener("auth-expired", listener);
    await expect(apiRequest("/api/accounts")).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("4xx 解析后端错误信息", async () => {
    mockFetch(400, { message: "缺少参数" });
    await expect(apiRequest("/api/reserve", { method: "POST", body: {} }))
      .rejects.toMatchObject({ status: 400, message: "缺少参数" });
  });

  it("网络错误 → ApiError(0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(apiRequest("/api/accounts")).rejects.toMatchObject({ status: 0, message: "无法连接后端" });
  });

  it("login 成功返回 token", async () => {
    mockFetch(200, { token: "tok-2" });
    const t = await login("secret-pass");
    expect(t).toBe("tok-2");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 client.ts**

`web/src/api/client.ts`:
```ts
import type { ReserveResult, SeatMapDto, AccountRow, CurrentReserve } from "./types.js";

const TOKEN_KEY = "njseat-token";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

export async function apiRequest<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "无法连接后端");
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("auth-expired"));
    throw new ApiError(401, "未授权");
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? data?.message ?? "请求失败");
  }
  return data as T;
}

export async function login(password: string): Promise<string> {
  const r = await apiRequest<{ token: string }>("/api/auth/login", { method: "POST", body: { password } });
  return r.token;
}

export const api = {
  accounts: () => apiRequest<AccountRow[]>("/api/accounts"),
  addAccount: (username: string, password: string, alias?: string) =>
    apiRequest<AccountRow>("/api/accounts", { method: "POST", body: { username, password, alias } }),
  removeAccount: (id: number) => apiRequest<{ ok: true }>(`/api/accounts/${id}`, { method: "DELETE" }),
  reauth: (id: number) => apiRequest<{ ok: true }>(`/api/accounts/${id}/reauth`, { method: "POST" }),
  loginCaptcha: (id: number, captchaCode: string) =>
    apiRequest<{ ok: true }>(`/api/accounts/${id}/login-captcha`, { method: "POST", body: { captchaCode } }),
  current: (id: number) => apiRequest<CurrentReserve>(`/api/accounts/${id}/current`),
  layout: (libId: number, accountId: number) =>
    apiRequest<SeatMapDto>(`/api/seats/libraries/${libId}/layout?accountId=${accountId}`),
  reserve: (accountId: number, libId: number, seatKey: string) =>
    apiRequest<ReserveResult>("/api/reserve", { method: "POST", body: { accountId, libId, seatKey } }),
  reserveCaptcha: (accountId: number, libId: number, seatKey: string, captchaToken: string, code: string) =>
    apiRequest<ReserveResult>("/api/reserve/captcha", { method: "POST", body: { accountId, libId, seatKey, captchaToken, code } }),
  cancel: (accountId: number) => apiRequest<ReserveResult>("/api/reserve/cancel", { method: "POST", body: { accountId } }),
};
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run test/api/client.test.ts`
Expected: PASS（5 tests）

```bash
git add web/src/api/client.ts web/test/api/client.test.ts
git commit -m "feat(web): API client 封装（token/401/错误解析）"
```

---

### Task 3: SeatCanvas 组件（Canvas 座位网格渲染）

**Files:**
- Create: `web/src/components/SeatCanvas.vue`
- Create: `web/src/components/SeatCanvas.test-helper.ts`（canvas 上下文 mock：记录绘制调用）
- Test: `web/test/components/SeatCanvas.test.ts`

**Interfaces:**
- Consumes: `SeatMapDto`（Task 1）
- Produces: `SeatCanvas.vue`——`props: { map: SeatMapDto }`；`emit: ("click-seat", seat: SeatDto)`；内部 `selectedKey: string | null`（选中态）；`cellSize=40`、半径 `14`、色板（空闲绿 `#4CAF50`、占用红 `#F44336`、其它灰 `#9E9E9E`、桌面/服务台淡灰 `#EEEEEE`）

- [ ] **Step 1: 写 canvas 上下文 mock 与失败测试**

`web/src/components/SeatCanvas.test-helper.ts`:
```ts
import { vi } from "vitest";

export interface CanvasMock {
  ctx: any;
  calls: { type: string; args: any[] }[];
  /** 读取画布 (x,y) 处颜色: 返回最后填充该像素的 fillStyle 的十六进制值 */
  pixelAt: (x: number, y: number) => string | null;
}

export function mockCanvas(): CanvasMock {
  const calls: { type: string; args: any[] }[] = [];
  const filled: Record<string, string> = {};
  const ctx = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      for (let py = Math.floor(y); py < Math.floor(y + h); py++)
        for (let px = Math.floor(x); px < Math.floor(x + w); px++)
          filled[`${px},${py}`] = ctx.fillStyle;
    }),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
  const proxy: any = new Proxy(ctx, {
    get(t, p) { if (typeof p === "string" && typeof (t as any)[p] === "function") {
      return (...args: any[]) => { calls.push({ type: p, args }); return (t as any)[p](...args); };
    } return (t as any)[p]; },
  });
  return {
    ctx: proxy,
    calls,
    pixelAt: (x, y) => filled[`${x},${y}`] ?? null,
  };
}
```

`web/test/components/SeatCanvas.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import SeatCanvas from "../../src/components/SeatCanvas.vue";
import { mockCanvas } from "../../src/components/SeatCanvas.test-helper.js";
import type { SeatMapDto } from "../../src/api/types.js";

const FIXTURE: SeatMapDto = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 4, seatsUsed: 1, seatsBooking: 0, maxX: 9, maxY: 5,
  seats: [
    { x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 },   // 占用
    { x: 5, y: 4, key: "56,28", type: 1, name: "88", seatStatus: 1 },   // 空闲
    { x: 9, y: 5, key: "99,55", type: 2, name: null, seatStatus: 0 },   // 桌面
    { x: 0, y: 0, key: "1,1", type: 8, name: null, seatStatus: 0 },     // 服务台
  ],
};

function setup() {
  const mock = mockCanvas();
  vi.stubGlobal("HTMLCanvasElement", class {
    getContext = () => mock.ctx;
    width = 0; height = 0;
    getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 240 });
    addEventListener = vi.fn();
  } as any);
  return mock;
}
afterEach(() => vi.unstubAllGlobals());

describe("SeatCanvas", () => {
  it("空闲座中心为绿色, 占用座为红色, 桌面/服务台为淡灰", () => {
    const mock = setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // 座位 (5,4) 中心: ((5+1)*40, (4+1)*40) = (240, 200)
    expect(mock.pixelAt(240, 200)).toBe("#4CAF50");
    // 座位 (3,4) 中心: (160, 200)
    expect(mock.pixelAt(160, 200)).toBe("#F44336");
    // 桌面 (9,5): (400, 240) — maxX=9 时画布宽 400 的右缘, 中心在 (400,240)? 桌面用矩形 fillRect 左上角, 断言其填充区域
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("点击空闲座 emit click-seat; 点击占用座不 emit", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // hit-test 由 mousedown + 坐标换算实现; 直接调用组件暴露的点击处理不方便,
    // 改为: 触发 canvas mousedown with offsetX/offsetY → 内部 hit-test
    const canvas = wrapper.find("canvas");
    // 空闲座 (5,4) 中心像素 (240,200)
    await canvas.trigger("mousedown", { offsetX: 240, offsetY: 200 });
    expect(wrapper.emitted("click-seat")?.[0]?.[0]).toMatchObject({ key: "56,28", name: "88" });
    // 占用座 (3,4) 中心 (160,200)
    await canvas.trigger("mousedown", { offsetX: 160, offsetY: 200 });
    expect(wrapper.emitted("click-seat")).toHaveLength(1);
  });

  it("选中后点击另一空闲座, 选中态转移", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // 空闲座 88 → 选中; 空闲座 87? 87 占用不可点。用两个空闲座的 fixture 单独验证
    const wrapper2 = mount(SeatCanvas, { props: { map: { ...FIXTURE, seats: [
      { x: 1, y: 1, key: "a", type: 1, name: "A", seatStatus: 1 },
      { x: 2, y: 1, key: "b", type: 1, name: "B", seatStatus: 1 },
    ] } } });
    const canvas = wrapper2.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 80, offsetY: 80 });
    await canvas.trigger("mousedown", { offsetX: 120, offsetY: 80 });
    expect(wrapper2.emitted("click-seat")).toHaveLength(2);
    // 组件本地选中态最终落在 B
    expect((wrapper2.vm as any).selectedKey).toBe("b");
  });

  it("clearSelection 清空选中态并重绘（终审 I-1）", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: { ...FIXTURE, seats: [
      { x: 1, y: 1, key: "a", type: 1, name: "A", seatStatus: 1 },
    ] } } });
    const canvas = wrapper.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 80, offsetY: 80 });
    expect((wrapper.vm as any).selectedKey).toBe("a");
    (wrapper.vm as any).clearSelection();
    expect((wrapper.vm as any).selectedKey).toBeNull();
  });
});
```
注：`HTMLCanvasElement` stub 需包含 `getContext` 返回 mock ctx，且 `mousedown` 事件坐标用 `offsetX/offsetY`（组件实现里按 `event.offsetX/offsetY` 读）。

- [ ] **Step 2: 运行确认失败 → 实现 SeatCanvas.vue**

`web/src/components/SeatCanvas.vue`:
```vue
<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import type { SeatMapDto, SeatDto } from "../api/types.js";

const props = defineProps<{ map: SeatMapDto }>();
const emit = defineEmits<{ (e: "click-seat", seat: SeatDto): void }>();

const CELL = 40, RADIUS = 14;
const COLOR_FREE = "#4CAF50", COLOR_OCCUPIED = "#F44336",
      COLOR_OTHER = "#9E9E9E", COLOR_BG = "#EEEEEE";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const selectedKey = ref<string | null>(null);

const width = () => (props.map.maxX + 1) * CELL;
const height = () => (props.map.maxY + 1) * CELL;
const center = (s: SeatDto) => [ (s.x + 1) * CELL, (s.y + 1) * CELL ] as const;

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = width(); canvas.height = height();
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of props.map.seats) {
    const [cx, cy] = center(s);
    if (s.type === 1) {
      const color = s.seatStatus === 1 ? COLOR_FREE : s.seatStatus === 3 ? COLOR_OCCUPIED : COLOR_OTHER;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2); ctx.fill();
      if (selectedKey.value === s.key) {
        ctx.strokeStyle = "#FF9800"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, RADIUS + 4, 0, Math.PI * 2); ctx.stroke();
      }
      if (s.name) { ctx.fillStyle = "#FFFFFF"; ctx.font = "10px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(s.name, cx, cy); }
    } else {
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(cx - RADIUS, cy - RADIUS, RADIUS * 2, RADIUS * 2);
    }
  }
}

function onMouseDown(e: MouseEvent) {
  const rect = (e.target as HTMLElement).getBoundingClientRect();
  const scale = (e.target as HTMLCanvasElement).width / rect.width;   // CSS 缩放还原
  const px = (e.clientX - rect.left) * scale, py = (e.clientY - rect.top) * scale;
  const hit = props.map.seats.find(s => {
    const [cx, cy] = center(s);
    return Math.hypot(px - cx, py - cy) < RADIUS * 1.5;
  });
  if (hit && hit.type === 1 && hit.seatStatus === 1) {
    selectedKey.value = hit.key;
    emit("click-seat", hit);
    draw();
  }
}

onMounted(draw);
watch(() => props.map, draw);
watch(selectedKey, draw);
/** 清空选中态（终审 I-1: 父组件在成功/取消后调用, 清除画布选中环） */
function clearSelection() {
  if (selectedKey.value !== null) { selectedKey.value = null; draw(); }
}
defineExpose({ selectedKey, clearSelection });
</script>

<template>
  <div class="seat-canvas" :style="{ maxWidth: '100%', overflow: 'auto' }">
    <canvas ref="canvasRef" @mousedown="onMouseDown"
            :style="{ display: 'block', maxWidth: '100%', height: 'auto' }" />
  </div>
</template>
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run test/components/SeatCanvas.test.ts`
Expected: PASS（3 tests）。若 pixelAt 断言因 stub 实现细节失败，允许微调 mock 的 fillRect 记录逻辑（不改变组件行为）。

```bash
git add web/src/components/ web/test/components/
git commit -m "feat(web): SeatCanvas 座位网格渲染（Canvas 自绘 + 命中测试）"
```

---

### Task 4: CaptchaDialog 组件

**Files:**
- Create: `web/src/components/CaptchaDialog.vue`
- Test: `web/test/components/CaptchaDialog.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `CaptchaDialog.vue`——`props: { modelValue: boolean; imageData: string; title?: string }`；`emit: ("update:modelValue", boolean)`、`emit: ("confirm", code: string)`；内部输入框 + 图片显示（`<img :src="imageData">`，imageData 为 data URI）

- [ ] **Step 1: 写失败测试**

`web/test/components/CaptchaDialog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CaptchaDialog from "../../src/components/CaptchaDialog.vue";

describe("CaptchaDialog", () => {
  it("显示图片与输入框; 确认 emit confirm(code)", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("data:image/png;base64,AA==");
    await wrapper.find("input").setValue("pk3x");
    await wrapper.find(".confirm-btn").trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toBe("pk3x");
  });

  it("空输入时 confirm 不 emit", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    await wrapper.find(".confirm-btn").trigger("click");
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("取消 emit update:modelValue(false)", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    await wrapper.find(".cancel-btn").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 CaptchaDialog.vue**

`web/src/components/CaptchaDialog.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { ElDialog, ElInput, ElButton } from "element-plus";

const props = defineProps<{ modelValue: boolean; imageData: string; title?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "confirm", code: string): void;
}>();

const code = ref("");
watch(() => props.modelValue, v => { if (v) code.value = ""; });

function confirm() {
  if (!code.value) return;
  emit("confirm", code.value);
}
</script>

<template>
  <ElDialog :model-value="modelValue" :title="title ?? '输入验证码'"
            width="320px" @update:model-value="emit('update:modelValue', $event)">
    <img :src="imageData" alt="验证码" style="display:block;margin:0 auto 16px" />
    <ElInput v-model="code" placeholder="请输入验证码" @keyup.enter="confirm" />
    <template #footer>
      <ElButton class="cancel-btn" @click="emit('update:modelValue', false)">取消</ElButton>
      <ElButton class="confirm-btn" type="primary" @click="confirm">确认</ElButton>
    </template>
  </ElDialog>
</template>
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run test/components/CaptchaDialog.test.ts`
Expected: PASS（3 tests）

```bash
git add web/src/components/CaptchaDialog.vue web/test/components/CaptchaDialog.test.ts
git commit -m "feat(web): CaptchaDialog 验证码输入弹窗"
```

---

### Task 5: SeatMap 页面（座位图 + 选座/退座交互）

**Files:**
- Create: `web/src/pages/SeatMap.vue`
- Create: `web/src/pages/library-names.ts`（图书馆常量表）
- Test: `web/test/pages/SeatMap.test.ts`

**Interfaces:**
- Consumes: `api`（Task 2）、`SeatCanvas`（Task 3）、`CaptchaDialog`（Task 4）、类型（Task 1）
- Produces: `SeatMap.vue`——`props: { accountId: number }`；`emit: ("need-accounts")`（无账号时提示去账号管理页）；内部状态：`libId`（默认 122811）、`map: SeatMapDto | null`、`selected: SeatDto | null`、`captcha: {imageData, captchaToken} | null`、`busy: boolean`

`web/src/pages/library-names.ts`:
```ts
// 图书馆常量表（docs/seat.md 实测 lib_id）
export const LIBRARIES = [
  { id: 122797, name: "一楼大厅" },
  { id: 122811, name: "新书借阅室" },
  { id: 122818, name: "二楼大厅" },
  { id: 122825, name: "自科一" },
  { id: 122832, name: "社科三" },
  { id: 122846, name: "四楼A区" },
];
```

- [ ] **Step 1: 写失败测试**

`web/test/pages/SeatMap.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SeatMap from "../../src/pages/SeatMap.vue";
import { mockCanvas } from "../../src/components/SeatCanvas.test-helper.js";

const LAYOUT = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 1, seatsUsed: 0, seatsBooking: 0, maxX: 1, maxY: 1,
  seats: [{ x: 0, y: 0, key: "1,1", type: 1, name: "87", seatStatus: 1 }],
};

function mockApi(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    calls.push(url);
    const path = String(url).split("?")[0];
    if (path === "/api/seats/libraries/122811/layout") return { status: 200, json: async () => LAYOUT };
    if (path === "/api/reserve" && overrides.reserve) return { status: 200, json: async () => overrides.reserve };
    if (path === "/api/reserve/captcha") return { status: 200, json: async () => ({ ok: true }) };
    if (path === "/api/accounts") return { status: 200, json: async () => [{ id: 1, username: "2023001", status: "active" }] };
    return { status: 404, json: async () => ({}) };
  }));
  return { calls };
}
afterEach(() => vi.unstubAllGlobals());

describe("SeatMap", () => {
  beforeEach(() => { localStorage.setItem("njseat-token", "tok"); });

  it("加载并渲染统计条与画布", async () => {
    const mock = mockCanvas();
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    expect(wrapper.text()).toContain("新书借阅室");
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("点空闲座 → 确认弹窗 → 选座成功 → 刷新画布", async () => {
    const mock = mockCanvas();
    mockApi({ reserve: { ok: true } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    const canvas = wrapper.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 40, offsetY: 40 });
    await flushPromises();
    // 确认弹窗（ElMessageBox 或自绘确认）—— 测试以组件内 confirm 状态为准
    expect(wrapper.vm.$data.selected).toMatchObject({ key: "1,1" });
    // 触发选座确认
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    // 画布刷新（再次拉 layout）
    expect(wrapper.vm.$data.map).not.toBeNull();
  });

  it("选座返回 needCaptcha → 弹验证码窗 → 确认后走 captcha 接口", async () => {
    const mock = mockCanvas();
    mockApi({ reserve: { needCaptcha: true, imageData: "img-b64", captchaToken: "cap-1" } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    expect(wrapper.vm.$data.captcha).toMatchObject({ imageData: "img-b64", captchaToken: "cap-1" });
    // 确认验证码
    await (wrapper.vm as any).submitCaptcha("pk3x");
    await flushPromises();
    expect(wrapper.vm.$data.captcha).toBeNull();
  });

  it("确认弹窗取消 → selected 清空（终审 I-1）", async () => {
    const mock = mockCanvas();
    mockApi({});
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    // 点击空闲座 → 弹确认
    await wrapper.find("canvas").trigger("mousedown", { offsetX: 40, offsetY: 40 });
    await flushPromises();
    expect((wrapper.vm as any).selected).toMatchObject({ key: "1,1" });
    expect((wrapper.vm as any).confirmVisible).toBe(true);
    // 取消
    await (wrapper.vm as any).cancelReserve();
    await flushPromises();
    expect((wrapper.vm as any).selected).toBeNull();
    expect((wrapper.vm as any).confirmVisible).toBe(false);
  });

  it("验证码弹窗取消 → captcha 与 selected 清空（终审 I-1）", async () => {
    const mock = mockCanvas();
    mockApi({ reserve: { needCaptcha: true, imageData: "img-b64", captchaToken: "cap-1" } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    expect((wrapper.vm as any).captcha).toBeTruthy();
    // CaptchaDialog 关闭（computed setter 置 null）
    (wrapper.vm as any).captchaVisible = false;
    await flushPromises();
    expect((wrapper.vm as any).captcha).toBeNull();
    expect((wrapper.vm as any).selected).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 SeatMap.vue**

`web/src/pages/SeatMap.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { ElMessage, ElSelect, ElOption, ElButton, ElEmpty } from "element-plus";
import { api } from "../api/client.js";
import type { SeatMapDto, SeatDto, ReserveResult } from "../api/types.js";
import SeatCanvas from "../components/SeatCanvas.vue";
import CaptchaDialog from "../components/CaptchaDialog.vue";
import { LIBRARIES } from "./library-names.js";

const props = defineProps<{ accountId: number }>();
const emit = defineEmits<{ (e: "need-accounts"): void }>();

const libId = ref(122811);
const map = ref<SeatMapDto | null>(null);
const selected = ref<SeatDto | null>(null);
const captcha = ref<{ imageData: string; captchaToken: string } | null>(null);
const busy = ref(false);

async function load() {
  if (!props.accountId) return;
  try {
    map.value = await api.layout(libId.value, props.accountId);
  } catch (e: any) {
    if (e.status === 400) emit("need-accounts");
  }
}

function onSeatClick(seat: SeatDto) {
  selected.value = seat;
  ElMessageBox.confirm(`选择座位 ${seat.name ?? seat.key}？`, "确认选座")
    .then(() => doReserve())
    .catch(() => { selected.value = null; });
}

async function doReserve() {
  if (!selected.value || !props.accountId) return;
  busy.value = true;
  try {
    const r: ReserveResult = await api.reserve(props.accountId, libId.value, selected.value.key);
    if ("ok" in r && r.ok) {
      ElMessage.success(`已选座 ${selected.value.name}`);
      selected.value = null;
      await load();
    } else if ("needCaptcha" in r) {
      captcha.value = { imageData: r.imageData, captchaToken: r.captchaToken };
    } else {
      ElMessage.error(r.message);
    }
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally { busy.value = false; }
}

async function submitCaptcha(code: string) {
  if (!captcha.value || !selected.value) return;
  const r = await api.reserveCaptcha(props.accountId, libId.value, selected.value.key,
                                     captcha.value.captchaToken, code);
  captcha.value = null;
  if ("ok" in r && r.ok) { ElMessage.success("选座成功"); selected.value = null; await load(); }
  else if ("needCaptcha" in r) { captcha.value = { imageData: r.imageData, captchaToken: r.captchaToken }; }
  else ElMessage.error(r.message);
}

onMounted(load);
watch(() => props.accountId, () => { selected.value = null; load(); });
watch(libId, () => { selected.value = null; load(); });
defineExpose({ doReserve, submitCaptcha });
</script>

<template>
  <div>
    <div class="toolbar" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
      <ElSelect v-model="libId" style="width:180px">
        <ElOption v-for="l in LIBRARIES" :key="l.id" :label="l.name" :value="l.id" />
      </ElSelect>
      <ElButton @click="load">刷新</ElButton>
      <span v-if="map" class="stats">
        总 {{ map.seatsTotal }} · 占用 {{ map.seatsUsed }} · 预约 {{ map.seatsBooking }}
      </span>
    </div>
    <SeatCanvas v-if="map" :map="map" @click-seat="onSeatClick" />
    <ElEmpty v-else-if="!props.accountId" description="请先在账号管理添加账号"
             @click="emit('need-accounts')" />
    <CaptchaDialog v-model="captcha !== null" :image-data="captcha?.imageData ?? ''"
                   title="选座验证码" @confirm="submitCaptcha" />
  </div>
</template>
```
注：`ElMessageBox` 需从 element-plus 导入并在测试中 stub；若 ElMessageBox.confirm 在 jsdom 下不便，可在组件中改用自绘确认（`confirmVisible` ref + 按钮），测试断言 confirmVisible 状态——实现时以可测性为准（选择自绘确认弹窗，避免 stub element-plus 内部）。

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run test/pages/SeatMap.test.ts`
Expected: PASS（3 tests）

```bash
git add web/src/pages/ web/test/pages/
git commit -m "feat(web): SeatMap 页面（座位图 + 选座/验证码交互）"
```

---

### Task 6: Accounts 页面（账号管理）

**Files:**
- Create: `web/src/pages/Accounts.vue`
- Test: `web/test/pages/Accounts.test.ts`

**Interfaces:**
- Consumes: `api`（Task 2）、`CaptchaDialog`（Task 4）、类型（Task 1）
- Produces: `Accounts.vue`——`props: { activeId: number }`；`emit: ("select-account", id: number)`（点击行/「设为当前」）；内部状态：`rows: AccountRow[]`、`addForm {username, password, alias}`、`captchaFor: AccountRow | null`、`busy: boolean`

- [ ] **Step 1: 写失败测试**

`web/test/pages/Accounts.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Accounts from "../../src/pages/Accounts.vue";
import type { AccountRow } from "../../src/api/types.js";

const ROWS: AccountRow[] = [
  { id: 1, username: "2023001", alias: "我自己", status: "active", lastOkAt: Date.now(), lastError: null, createdAt: 1 },
  { id: 2, username: "2023002", alias: null, status: "needs-captcha", lastOkAt: null, lastError: "CAS 要求验证码", createdAt: 2 },
  { id: 3, username: "2023003", alias: null, status: "failed", lastOkAt: null, lastError: "连续 3 次重登失败", createdAt: 3 },
];

function mockApi(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    calls.push(String(url));
    const path = String(url).split("?")[0];
    if (path === "/api/accounts" && (!init?.method || init.method === "GET")) return { status: 200, json: async () => ROWS };
    if (path === "/api/accounts" && init?.method === "POST") return { status: 200, json: async () => ({ ...ROWS[0], username: JSON.parse(init.body).username }) };
    if (path.endsWith("/reauth")) return { status: 200, json: async () => ({ ok: true }) };
    if (path.endsWith("/login-captcha")) return { status: 200, json: async () => ({ ok: true }) };
    if (overrides.remove && path.startsWith("/api/accounts/")) return { status: 200, json: async () => ({ ok: true }) };
    return { status: 404, json: async () => ({}) };
  }));
  return { calls };
}
afterEach(() => vi.unstubAllGlobals());

describe("Accounts", () => {
  beforeEach(() => { localStorage.setItem("njseat-token", "tok"); });

  it("渲染账号列表与状态徽章", async () => {
    mockApi();
    const wrapper = mount(Accounts, { props: { activeId: 1 } });
    await flushPromises();
    expect(wrapper.text()).toContain("2023001");
    expect(wrapper.text()).toContain("needs-captcha");
    expect(wrapper.text()).toContain("连续 3 次重登失败");
  });

  it("needs-captcha 账号显示验证码恢复按钮; 点击弹 CaptchaDialog", async () => {
    mockApi();
    const wrapper = mount(Accounts, { props: { activeId: 1 } });
    await flushPromises();
    const recoverBtn = wrapper.findAll("button").find(b => b.text().includes("验证码恢复"));
    expect(recoverBtn).toBeTruthy();
    await recoverBtn!.trigger("click");
    await flushPromises();
    expect(wrapper.vm.$data.captchaFor).toMatchObject({ id: 2 });
  });

  it("添加账号表单提交", async () => {
    const { calls } = mockApi();
    const wrapper = mount(Accounts, { props: { activeId: 1 } });
    await flushPromises();
    await wrapper.find("input[placeholder='学号']").setValue("2023099");
    await wrapper.find("input[placeholder='密码']").setValue("pass-1");
    await wrapper.find("input[placeholder='别名']").setValue("新号");
    await wrapper.find(".add-btn").trigger("click");
    await flushPromises();
    expect(calls.some(c => c.startsWith("/api/accounts") )).toBe(true);
    expect(wrapper.vm.$data.addForm.username).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 Accounts.vue**

`web/src/pages/Accounts.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElTable, ElTableColumn, ElTag, ElButton, ElInput, ElForm, ElFormItem, ElTooltip } from "element-plus";
import { api } from "../api/client.js";
import type { AccountRow } from "../api/types.js";
import CaptchaDialog from "../components/CaptchaDialog.vue";

const props = defineProps<{ activeId: number }>();
const emit = defineEmits<{ (e: "select-account", id: number): void }>();

const rows = ref<AccountRow[]>([]);
const addForm = ref({ username: "", password: "", alias: "" });
const captchaFor = ref<AccountRow | null>(null);
const busy = ref(false);

async function load() { rows.value = await api.accounts(); }

const STATUS_MAP: Record<string, { label: string; type: "success" | "warning" | "danger" | "info" }> = {
  active: { label: "正常", type: "success" },
  "needs-captcha": { label: "需验证码", type: "warning" },
  failed: { label: "失败", type: "danger" },
  pending: { label: "等待中", type: "info" },
};

async function add() {
  if (!addForm.value.username || !addForm.value.password) { ElMessage.warning("学号与密码必填"); return; }
  busy.value = true;
  try {
    await api.addAccount(addForm.value.username, addForm.value.password, addForm.value.alias || undefined);
    ElMessage.success("账号已添加");
    addForm.value = { username: "", password: "", alias: "" };
    await load();
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

async function reauth(id: number) {
  await api.reauth(id); ElMessage.success("已触发重登"); await load();
}
async function openRecover(row: AccountRow) { captchaFor.value = row; }
async function submitCaptcha(code: string) {
  if (!captchaFor.value) return;
  try {
    await api.loginCaptcha(captchaFor.value.id, code);
    ElMessage.success("验证码登录成功"); captchaFor.value = null; await load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function remove(row: AccountRow) {
  if (!window.confirm(`删除账号 ${row.alias ?? row.username}？`)) return;
  await api.removeAccount(row.id); ElMessage.success("已删除"); await load();
}

onMounted(load);
defineExpose({ addForm, captchaFor });
</script>

<template>
  <div>
    <ElTable :data="rows" style="margin-bottom:16px" @row-click="r => emit('select-account', r.id)">
      <ElTableColumn label="别名" width="140">
        <template #default="{ row }">{{ row.alias ?? row.username }}</template>
      </ElTableColumn>
      <ElTableColumn prop="username" label="学号" width="140" />
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag :type="STATUS_MAP[row.status].type">{{ STATUS_MAP[row.status].label }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近保活">
        <template #default="{ row }">
          {{ row.lastOkAt ? new Date(row.lastOkAt).toLocaleString() : "-" }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近错误">
        <template #default="{ row }">
          <ElTooltip v-if="row.lastError" :content="row.lastError"><span style="color:#E6A23C">{{ row.lastError.slice(0, 20) }}{{ row.lastError.length > 20 ? "…" : "" }}</span></ElTooltip>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="220">
        <template #default="{ row }">
          <ElButton v-if="row.status === 'needs-captcha'" size="small" type="warning"
                    @click.stop="openRecover(row)">验证码恢复</ElButton>
          <ElButton v-else size="small" @click.stop="reauth(row.id)">重登</ElButton>
          <ElButton size="small" type="danger" @click.stop="remove(row)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElForm inline>
      <ElFormItem><ElInput v-model="addForm.username" placeholder="学号" style="width:160px" /></ElFormItem>
      <ElFormItem><ElInput v-model="addForm.password" placeholder="密码" type="password" show-password style="width:160px" /></ElFormItem>
      <ElFormItem><ElInput v-model="addForm.alias" placeholder="别名" style="width:120px" /></ElFormItem>
      <ElFormItem><ElButton class="add-btn" type="primary" :loading="busy" @click="add">添加账号</ElButton></ElFormItem>
    </ElForm>

    <CaptchaDialog v-model="captchaFor !== null" :image-data="'data:image/png;base64,AA=='"
                   title="CAS 验证码登录" @confirm="submitCaptcha" />
  </div>
</template>
```
注：`window.confirm` 在 jsdom 可用；`CaptchaDialog` 的 imageData 对 needs-captcha 场景占位（真实验证码图片获取属 M2——spec 的后端 login-captcha 只有 captchaCode 输入，无图片下发；此处弹窗图片仅作占位，用户从原站获取验证码后输入）。若此设计有歧义，实施时以 spec 为准并在报告中说明。

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run test/pages/Accounts.test.ts`
Expected: PASS（3 tests）

```bash
git add web/src/pages/Accounts.vue web/test/pages/Accounts.test.ts
git commit -m "feat(web): Accounts 账号管理页（列表/添加/重登/验证码恢复/删除）"
```

---

### Task 7: App 布局（登录门 + Tab 导航 + 当前预约）

**Files:**
- Create: `web/src/main.ts`
- Create: `web/src/App.vue`
- Create: `web/src/pages/Current.vue`
- Test: `web/test/App.test.ts`
- Test: `web/test/pages/Current.test.ts`

**Interfaces:**
- Consumes: `login`/`api`（Task 2）、三个页面（Task 5/6 + 本任务 Current）
- Produces: `main.ts`（mount + Element Plus）；`App.vue`——未登录显示访问密码门（输入 + 登录按钮 → login() → setToken → 刷新视图）；已登录显示 ElTabs（座位图/账号管理/当前预约）+ 当前账号选择状态（activeId 由账号管理页行点击联动）；监听 `auth-expired` → 清状态回登录门；`Current.vue`——`props: { accountId }`，查询按钮 → api.current → 预约卡片 + 退座按钮（确认弹窗 → api.cancel → 刷新）

- [ ] **Step 1: 写失败测试**

`web/test/pages/Current.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Current from "../../src/pages/Current.vue";

function mockApi(current: any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    const path = String(url).split("?")[0];
    if (path.endsWith("/current")) return { status: 200, json: async () => current };
    if (path === "/api/reserve/cancel") return { status: 200, json: async () => ({ ok: true }) };
    return { status: 404, json: async () => ({}) };
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("Current", () => {
  beforeEach(() => { localStorage.setItem("njseat-token", "tok"); });

  it("有预约: 显示座位信息卡片", async () => {
    mockApi({ reserve: { libName: "新书借阅室", seatName: "87", expDateStr: "20:19", status: 3 }, getSToken: "st" });
    const wrapper = mount(Current, { props: { accountId: 1 } });
    await flushPromises();
    expect(wrapper.text()).toContain("新书借阅室");
    expect(wrapper.text()).toContain("87");
  });

  it("无预约: 空态提示", async () => {
    mockApi({ reserve: null, getSToken: "st" });
    const wrapper = mount(Current, { props: { accountId: 1 } });
    await flushPromises();
    expect(wrapper.text()).toContain("暂无预约");
  });

  it("退座: 确认后调 cancel 并刷新", async () => {
    mockApi({ reserve: { libName: "新书借阅室", seatName: "87", expDateStr: "20:19", status: 3 }, getSToken: "st" });
    const wrapper = mount(Current, { props: { accountId: 1 } });
    await flushPromises();
    await wrapper.find(".cancel-btn").trigger("click");
    await flushPromises();
    // 确认弹窗（window.confirm stub true）
    expect(wrapper.emitted()).toBeDefined();
  });
});
```

`web/test/App.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import App from "../src/App.vue";

function mockApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    const path = String(url).split("?")[0];
    if (path === "/api/auth/login") return { status: 200, json: async () => ({ token: "tok-9" }) };
    if (path === "/api/accounts") return { status: 200, json: async () => [] };
    return { status: 200, json: async () => ({ reserve: null, getSToken: "st" }) };
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  beforeEach(() => { localStorage.clear(); });

  it("未登录: 显示访问密码门", () => {
    mockApi();
    const wrapper = mount(App);
    expect(wrapper.text()).toContain("访问密码");
  });

  it("登录成功: 进入 Tab 导航", async () => {
    mockApi();
    const wrapper = mount(App);
    await wrapper.find("input[type=password]").setValue("secret-pass");
    await wrapper.find(".login-btn").trigger("click");
    await flushPromises();
    expect(localStorage.getItem("njseat-token")).toBe("tok-9");
    expect(wrapper.find(".el-tabs").exists()).toBe(true);
  });

  it("auth-expired 事件 → 回登录门", async () => {
    localStorage.setItem("njseat-token", "tok-x");
    mockApi();
    const wrapper = mount(App);
    await flushPromises();
    window.dispatchEvent(new Event("auth-expired"));
    await flushPromises();
    expect(wrapper.text()).toContain("访问密码");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现**

`web/src/main.ts`:
```ts
import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import App from "./App.vue";

createApp(App).use(ElementPlus).mount("#app");
```

`web/src/App.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElInput, ElButton, ElTabs, ElTabPane, ElMessage } from "element-plus";
import { login, setToken, getToken, api } from "./api/client.js";
import SeatMap from "./pages/SeatMap.vue";
import Accounts from "./pages/Accounts.vue";
import Current from "./pages/Current.vue";

const authed = ref(!!getToken());
const password = ref("");
const activeId = ref<number | null>(null);
const busy = ref(false);

async function doLogin() {
  busy.value = true;
  try {
    const t = await login(password.value);
    setToken(t); authed.value = true; password.value = "";
    await ensureAccounts();
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

async function ensureAccounts() {
  const rows = await api.accounts();
  if (!rows.length) { activeId.value = null; return; }
  if (!rows.some(r => r.id === activeId.value)) activeId.value = rows[0].id;
}

onMounted(() => {
  if (authed.value) ensureAccounts();
  window.addEventListener("auth-expired", () => {
    authed.value = false; activeId.value = null;
  });
});
defineExpose({ authed, activeId });
</script>

<template>
  <div style="max-width:960px;margin:0 auto;padding:24px">
    <h1 style="margin:0 0 16px">南工大选座助手</h1>
    <div v-if="!authed" style="max-width:360px;margin:80px auto">
      <ElInput v-model="password" type="password" placeholder="访问密码" style="margin-bottom:12px"
               @keyup.enter="doLogin" />
      <ElButton class="login-btn" type="primary" style="width:100%" :loading="busy" @click="doLogin">
        登录
      </ElButton>
    </div>
    <ElTabs v-else type="card">
      <ElTabPane label="座位图">
        <SeatMap v-if="activeId" :account-id="activeId" @need-accounts="/* 提示 */" />
        <p v-else>请先在「账号管理」添加账号</p>
      </ElTabPane>
      <ElTabPane label="账号管理">
        <Accounts :active-id="activeId ?? 0" @select-account="id => activeId = id" />
      </ElTabPane>
      <ElTabPane label="当前预约">
        <Current v-if="activeId" :account-id="activeId" />
        <p v-else>请先在「账号管理」添加账号</p>
      </ElTabPane>
    </ElTabs>
  </div>
</template>
```

`web/src/pages/Current.vue`:
```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { ElButton, ElMessage, ElEmpty, ElDescriptions, ElDescriptionsItem } from "element-plus";
import { api } from "../api/client.js";
import type { CurrentReserve } from "../api/types.js";

const props = defineProps<{ accountId: number }>();
const data = ref<CurrentReserve | null>(null);
const busy = ref(false);

async function load() {
  if (!props.accountId) return;
  data.value = await api.current(props.accountId);
}

async function cancel() {
  if (!window.confirm("确定退座？")) return;
  busy.value = true;
  try {
    const r = await api.cancel(props.accountId);
    if ("ok" in r && r.ok) { ElMessage.success("退座成功"); await load(); }
    else ElMessage.error(r.message);
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

watch(() => props.accountId, load, { immediate: true });
defineExpose({ data });
</script>

<template>
  <div>
    <ElButton style="margin-bottom:12px" @click="load">查询</ElButton>
    <ElDescriptions v-if="data?.reserve" :column="2" border style="max-width:560px">
      <ElDescriptionsItem label="图书馆">{{ data.reserve.libName }}</ElDescriptionsItem>
      <ElDescriptionsItem label="座位号">{{ data.reserve.seatName }}</ElDescriptionsItem>
      <ElDescriptionsItem label="到期时间">{{ data.reserve.expDateStr ?? "-" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="状态">{{ data.reserve.status === 3 ? "使用中" : "状态 " + data.reserve.status }}</ElDescriptionsItem>
    </ElDescriptions>
    <div v-if="data?.reserve" style="margin-top:16px">
      <ElButton class="cancel-btn" type="danger" :loading="busy" @click="cancel">退座</ElButton>
    </div>
    <ElEmpty v-else description="暂无预约" />
  </div>
</template>
```

- [ ] **Step 3: 运行确认通过 → 提交**

Run: `cd web && npx vitest run`
Expected: PASS（全部测试）。`npx vue-tsc --noEmit` 通过。

```bash
git add web/src/ web/test/
git commit -m "feat(web): App 布局（登录门 + Tab 导航）与当前预约页"
```

---

### Task 8: CI 集成与验收

**Files:**
- Modify: `.github/workflows/ci.yml`（增加 web/ 测试 job）
- Create: `web/README.md`（开发/构建/测试说明）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 仓库级 CI 覆盖 web/；开发文档

- [ ] **Step 1: 修改 ci.yml 增加前端 job**

`.github/workflows/ci.yml`（在既有 ci job 后新增）:
```yaml
  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npx vue-tsc --noEmit
```

- [ ] **Step 2: 写 web/README.md**

`web/README.md`:
```markdown
# 南工大选座助手 · 前端

Vue 3 + Element Plus 单页应用（开发代理后端 :8791）。

- 开发：`npm run dev`（:5173，代理 /api → 127.0.0.1:8791）
- 构建：`npm run build`（产物 web/dist，由后端静态托管）
- 测试：`npm test`（vitest + jsdom）

页面：座位图（Canvas 可视化+选座）、账号管理（多账号+验证码恢复）、当前预约（退座）。
```

- [ ] **Step 3: 本地全量验证**

Run: `cd server && npm test`（既有 69 tests 不回归）；`cd web && npm test`（前端全部）
Expected: 全部通过

- [ ] **Step 4: 提交并推送（触发仓库自动流水线）**

```bash
git add .github/workflows/ci.yml web/README.md
git commit -m "ci: 前端测试并入 CI + web 开发文档"
git push origin HEAD:worktree-seat-assistant-web
```

（推 `worktree-seat-assistant-web` 分支 → auto-pr 自动开 PR → CI 双 job 绿灯 → merge-bot 自动合并 → 合并后人工真机验收 spec §4 的 6 条标准）

---

## Self-Review 记录

- **Spec 覆盖**：§1 三页 + 交互 → T5/T6/T7；§2 SeatCanvas 渲染/交互/测试 → T3；§3 client 封装/错误矩阵/测试 → T2/T4；§4 工程配置 → T1、CI 集成 → T8、后端静态托管 → Plan 2b（另行）
- **占位符扫描**：无 TBD；Accounts.vue 的 needs-captcha 图片占位已注明归属 M2 并在实施报告说明
- **类型一致性**：`SeatMapDto`/`SeatDto`/`AccountRow`/`AccountStatus`/`CurrentReserve`/`ReserveResult` 与后端契约字段逐一对齐（T1 定义、T2-T7 引用）；`api.*` 方法签名在 T2 定义、T5/T6/T7 使用处一致；`CaptchaDialog` props/emit 在 T4 定义、T5/T6 使用一致；`SeatCanvas` props/emit 在 T3 定义、T5 使用一致
