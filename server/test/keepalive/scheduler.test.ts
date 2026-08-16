import { describe, it, expect, vi, afterEach } from "vitest";
import { KeepaliveScheduler } from "../../src/keepalive/scheduler.js";

function fakePool(probeResults: boolean[]) {
  const calls: { probe: number[]; reauth: number[] } = { probe: [], reauth: [] };
  const pool = {
    probe: vi.fn(async (id: number) => {
      calls.probe.push(id);
      return probeResults.shift() ?? true;
    }),
    reauth: vi.fn(async (id: number) => { calls.reauth.push(id); }),
    list: vi.fn(async () => [{ id: 1, status: "active" }, { id: 2, status: "failed" }]),
  };
  return { pool, calls };
}

describe("KeepaliveScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("tickOnce 只探测 active 账号; 失败触发 reauth", async () => {
    const { pool, calls } = fakePool([false]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    await s.tickOnce();
    expect(calls.probe).toEqual([1]);        // failed 状态账号不探测
    expect(calls.reauth).toEqual([1]);       // 探测失败 → 重登
  });

  it("start 按周期触发; stop 停止", async () => {
    vi.useFakeTimers();
    const { pool, calls } = fakePool([true, true]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.probe.length).toBe(2);
    s.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.probe.length).toBe(2);      // 已停止不再触发
  });

  it("探测失败后该账号退避（2 倍间隔）", async () => {
    vi.useFakeTimers();
    const { pool, calls } = fakePool([false, true, true]);
    const s = new KeepaliveScheduler(pool as any, 60_000);
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);   // t1: probe 失败 → reauth
    expect(calls.probe).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60_000);   // t2: 退避中, 跳过
    expect(calls.probe).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60_000);   // t3 (2 倍间隔): 再探测成功
    expect(calls.probe).toEqual([1, 1]);
  });

  it("重复 start 幂等; probe 抛错不中断整轮且该账号退避", async () => {
    vi.useFakeTimers();
    const pool = {
      list: vi.fn(async () => [{ id: 1, status: "active" }, { id: 2, status: "active" }]),
      probe: vi.fn(async (id: number) => { if (id === 1) throw new Error("boom"); return true; }),
      reauth: vi.fn(async () => {}),
    };
    const s = new KeepaliveScheduler(pool as any, 60_000);
    s.start();
    s.start();   // 幂等: 第二个 start 不得泄漏第二个 interval
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pool.probe).toHaveBeenCalledTimes(2);   // 账号1抛错后账号2仍被探测; 若 timer 泄漏会翻倍
    await vi.advanceTimersByTimeAsync(60_000);     // 账号2 正常周期再探测; 账号1 在 2× 退避中
    expect(pool.probe).toHaveBeenCalledTimes(3);
    s.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pool.probe).toHaveBeenCalledTimes(3);   // stop 后不再触发
  });
});
