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
