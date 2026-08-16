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
      new SeatStateMachine(seatMock.url), new SeatGraphql(seatMock.url), [0, 0, 0]);
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

  it("reserve 需验证码(1000): 返回 needCaptcha + imageData + captchaToken", async () => {
    seatMock.graphql.reserveError = { code: 1000, message: "need captcha" };
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.reserve(a.id, 122811, "34,28");
    expect(r).toEqual({ needCaptcha: true, imageData: "img-b64", captchaToken: "cap-token" });
    seatMock.graphql.reserveError = undefined;
  });

  it("reserve 空验证码直接成功", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.reserve(a.id, 122811, "34,28");
    expect(r).toEqual({ ok: true });
  });

  it("reserveWithCaptcha 成功后返回 ok", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.reserveWithCaptcha(a.id, 122811, "34,28", "cap-token", "pk3x");
    expect(r).toEqual({ ok: true });
  });

  it("cancel 成功路径: 有预约→退座→复查为空", async () => {
    seatMock.graphql.reserve = { token: "t1", status: 3, lib_id: 122811,
      lib_name: "新书借阅室", seat_key: "34,28", seat_name: "87", exp_date_str: "20:19" };
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.cancel(a.id);
    expect(r).toEqual({ ok: true });
    seatMock.graphql.reserve = null;
  });

  it("cancel 复查仍有预约: 返回错误", async () => {
    seatMock.graphql.reserve = { token: "t1", status: 3, lib_id: 122811,
      lib_name: "新书借阅室", seat_key: "34,28", seat_name: "87", exp_date_str: "20:19" };
    seatMock.graphql.keepReserveAfterCancel = true;
    const a = await pool.addAccount("2023001", "mypassword");
    const r = await pool.cancel(a.id);
    expect(r.ok).toBe(false);
    seatMock.graphql.keepReserveAfterCancel = false;
    seatMock.graphql.reserve = null;
  });

  it("reauth 失败 1-2 次保持 active, 第 3 次 failed", async () => {
    const a = await pool.addAccount("2023001", "mypassword");
    casMock.opts.channelLoginResponse = { status: 502, body: "<html>bad</html>" };
    await pool.reauth(a.id);
    expect((await pool.list()).find(x => x.id === a.id)!.status).toBe("active");
    await pool.reauth(a.id);
    expect((await pool.list()).find(x => x.id === a.id)!.status).toBe("active");
    await pool.reauth(a.id);
    expect((await pool.list()).find(x => x.id === a.id)!.status).toBe("failed");
    casMock.opts.channelLoginResponse = undefined;
  });
});
