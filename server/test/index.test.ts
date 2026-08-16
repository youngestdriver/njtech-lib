import { describe, it, expect } from "vitest";
import { buildServer } from "../src/index.js";

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
