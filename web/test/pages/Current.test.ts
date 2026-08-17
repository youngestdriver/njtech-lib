import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Current from "../../src/pages/Current.vue";

function mockApi(current: any) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    calls.push(String(url).split("?")[0]);
    const path = String(url).split("?")[0];
    if (path.endsWith("/current")) return { status: 200, json: async () => current };
    if (path === "/api/reserve/cancel") return { status: 200, json: async () => ({ ok: true }) };
    return { status: 404, json: async () => ({}) };
  }));
  return { calls };
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
    // brief 原测试缺 confirm stub（jsdom 的 window.confirm 直接 throw Not implemented，
    // 退座流程根本不会执行，断言 emitted 也恒真）——补 stub 并断言 cancel 接口真实被调
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = mockApi({ reserve: { libName: "新书借阅室", seatName: "87", expDateStr: "20:19", status: 3 }, getSToken: "st" });
    const wrapper = mount(Current, { props: { accountId: 1 } });
    await flushPromises();
    expect(calls.filter(c => c.endsWith("/current")).length).toBe(1);
    await wrapper.find(".cancel-btn").trigger("click");
    await flushPromises();
    expect(calls).toContain("/api/reserve/cancel");
    // 取消成功后重新拉取当前预约（刷新）
    expect(calls.filter(c => c.endsWith("/current")).length).toBe(2);
    expect(wrapper.find(".cancel-btn").exists()).toBe(true);
  });
});
