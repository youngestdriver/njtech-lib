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
