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
    // 状态徽章按 STATUS_MAP 渲染中文标签（brief 原文断言 raw status "needs-captcha"，
    // 与 brief 自己的 STATUS_MAP 中文标签实现相矛盾，改为断言渲染出的标签）
    expect(wrapper.text()).toContain("需验证码");
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
    // script setup 组件无 Options data，vm.$data 为空（brief 原文访问 $data 取不到状态），
    // 改走 defineExpose/setupState 的 vm 直接访问（与 SeatMap.test.ts 同一写法）
    expect((wrapper.vm as any).captchaFor).toMatchObject({ id: 2 });
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
    expect((wrapper.vm as any).addForm.username).toBe("");
  });
});
