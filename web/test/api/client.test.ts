import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, login, getToken, clearToken } from "../../src/api/client.js";

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
    // 终审推荐项: 断言带上 status（原 toBeInstanceOf 不够具体）;
    // 401 分支抛固定文案 ApiError(401, "未授权")，不解析响应体 message
    await expect(apiRequest("/api/accounts")).rejects.toMatchObject({ status: 401, message: "未授权" });
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
