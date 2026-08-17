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
    // brief 原文 toContain("访问密码") 取不到：placeholder 是 input 属性不是文本节点，
    // 改为断言登录门元素（密码输入框 + 登录按钮）
    mockApi();
    const wrapper = mount(App);
    expect(wrapper.find("input[type=password]").attributes("placeholder")).toBe("访问密码");
    expect(wrapper.find(".login-btn").exists()).toBe(true);
    expect(wrapper.find(".el-tabs").exists()).toBe(false);
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
    // 同「未登录」测试：placeholder 不入 text()，断言登录门元素
    expect(wrapper.find("input[type=password]").attributes("placeholder")).toBe("访问密码");
    expect(wrapper.find(".el-tabs").exists()).toBe(false);
  });
});
