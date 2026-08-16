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
});
