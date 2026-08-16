import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Locker } from "../../src/accounts/locker.js";
import { AccountStore } from "../../src/accounts/store.js";
import { SessionPool } from "../../src/accounts/session-pool.js";
import { CasClient } from "../../src/auth/cas.js";
import { SeatStateMachine } from "../../src/seat/state-machine.js";
import { SeatGraphql } from "../../src/seat/graphql.js";
import { createMockCas } from "../helpers/mock-cas.js";
import { createMockUnjtech, createMockSeat } from "../helpers/mock-seat.js";

describe("Locker", () => {
  it("同一账号并发操作串行化, 不同账号并行", async () => {
    const order: string[] = [];
    const locker = new Locker();
    const slow = (tag: string) => locker.withLock("a", async () => {
      order.push(tag + "-start"); await new Promise(r => setTimeout(r, 30)); order.push(tag + "-end");
    });
    const p1 = slow("1"); const p2 = slow("2");
    const p3 = locker.withLock("b", async () => { order.push("b"); });
    await Promise.all([p1, p2, p3]);
    // 同 key: 1 完成后才轮到 2；不同 key: b 与 1 并行（在 1-end 之前已执行）
    expect(order).toEqual(["1-start", "b", "1-end", "2-start", "2-end"]);
  });
});

describe("SessionPool", () => {
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
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("addAccount 走完整登录链后状态 active", async () => {
    const r = await pool.addAccount("2023001", "mypassword", "我");
    expect(r.status).toBe("active");
    expect(r.lastError).toBeNull();
  });

  it("channel 被风控 → needs-captcha", async () => {
    casMock.opts.channelRequireCaptcha = true;   // 创建后可变开关（opts 挂在 mock 返回值上）
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
