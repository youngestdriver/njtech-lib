import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SeatMap from "../../src/pages/SeatMap.vue";
import { mockCanvas } from "../../src/components/SeatCanvas.test-helper.js";

const LAYOUT = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 1, seatsUsed: 0, seatsBooking: 0, maxX: 1, maxY: 1,
  seats: [{ x: 0, y: 0, key: "1,1", type: 1, name: "87", seatStatus: 1 }],
};

// jsdom 差异处理（与 SeatCanvas.test.ts 同一套 stub，不改组件行为）：
// 1. 未装 canvas 包时 getContext("2d") 返回 null —— 给原型打桩返回 mock ctx。
// 2. jsdom 的 MouseEvent.prototype.offsetX/offsetY 只有 getter 无 setter，
//    @vue/test-utils 无法注入触发坐标 —— 补一个可写访问器。
function setupCanvas() {
  const mock = mockCanvas();
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(mock.ctx);
  for (const key of ["offsetX", "offsetY"] as const) {
    Object.defineProperty(window.MouseEvent.prototype, key, {
      configurable: true,
      get() { return (this as any)["__" + key] ?? 0; },
      set(v: number) { (this as any)["__" + key] = v; },
    });
  }
  return mock;
}

function mockApi(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  const requests: { method: string; url: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    calls.push(url);
    requests.push({ method: init?.method ?? "GET", url });
    const path = String(url).split("?")[0];
    if (path === "/api/seats/libraries/122811/layout") return { status: 200, json: async () => LAYOUT };
    if (path === "/api/reserve" && overrides.reserve) return { status: 200, json: async () => overrides.reserve };
    if (path === "/api/reserve/captcha") return { status: 200, json: async () => ({ ok: true }) };
    if (path === "/api/accounts") return { status: 200, json: async () => [{ id: 1, username: "2023001", status: "active" }] };
    return { status: 404, json: async () => ({}) };
  }));
  return { calls, requests };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SeatMap", () => {
  beforeEach(() => { localStorage.setItem("njseat-token", "tok"); });

  it("加载并渲染统计条与画布", async () => {
    setupCanvas();
    const mock = mockApi();  // 画布依赖 layout fetch（brief 原文漏了这行，无 stub 时 map 无法加载）
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    expect(wrapper.text()).toContain("新书借阅室");
    expect(wrapper.find("canvas").exists()).toBe(true);
    expect(mock.calls).toContain("/api/seats/libraries/122811/layout?accountId=1");
  });

  it("点空闲座 → 确认弹窗 → 选座成功 → 刷新画布", async () => {
    setupCanvas();
    const mock = mockApi({ reserve: { ok: true } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    const canvas = wrapper.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 40, offsetY: 40 });
    await flushPromises();
    // 确认弹窗（自绘确认）—— 测试以组件内 confirm 状态为准
    expect((wrapper.vm as any).selected).toMatchObject({ key: "1,1" });
    // 触发选座确认
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    // 画布刷新（再次拉 layout）
    expect((wrapper.vm as any).map).not.toBeNull();
    expect(mock.calls.filter(u => u.startsWith("/api/seats/libraries/122811/layout"))).toHaveLength(2);
    expect(mock.requests).toContainEqual({ method: "POST", url: "/api/reserve" });
  });

  it("选座返回 needCaptcha → 弹验证码窗 → 确认后走 captcha 接口", async () => {
    setupCanvas();
    const mock = mockApi({ reserve: { needCaptcha: true, imageData: "img-b64", captchaToken: "cap-1" } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    const canvas = wrapper.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 40, offsetY: 40 });
    await flushPromises();
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    expect((wrapper.vm as any).captcha).toMatchObject({ imageData: "img-b64", captchaToken: "cap-1" });
    expect(mock.requests).toContainEqual({ method: "POST", url: "/api/reserve" });
    // 确认验证码
    await (wrapper.vm as any).submitCaptcha("pk3x");
    await flushPromises();
    expect((wrapper.vm as any).captcha).toBeNull();
    expect(mock.requests).toContainEqual({ method: "POST", url: "/api/reserve/captcha" });
    // 验证码成功后再次刷新画布
    expect(mock.calls.filter(u => u.startsWith("/api/seats/libraries/122811/layout"))).toHaveLength(2);
  });

  it("确认弹窗取消 → selected 清空（终审 I-1）", async () => {
    setupCanvas();
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
    setupCanvas();
    mockApi({ reserve: { needCaptcha: true, imageData: "img-b64", captchaToken: "cap-1" } });
    const wrapper = mount(SeatMap, { props: { accountId: 1 } });
    await flushPromises();
    // 先点空闲座再 doReserve（计划原文漏了点击, selected 为空时 doReserve 会 early return）
    await wrapper.find("canvas").trigger("mousedown", { offsetX: 40, offsetY: 40 });
    await flushPromises();
    await (wrapper.vm as any).doReserve();
    await flushPromises();
    expect((wrapper.vm as any).captcha).toBeTruthy();
    // CaptchaDialog 关闭（computed setter 置 null 并清 selected）
    (wrapper.vm as any).captchaVisible = false;
    await flushPromises();
    expect((wrapper.vm as any).captcha).toBeNull();
    expect((wrapper.vm as any).selected).toBeNull();
  });
});
