interface PoolLike {
  list(): Promise<Array<{ id: number; status: string }>>;
  probe(id: number): Promise<boolean>;
  reauth(id: number): Promise<void>;
}

export class KeepaliveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private nextAt = new Map<number, number>();   // 每账号下次探测时间
  private backoff = new Map<number, number>();  // 当前退避倍数

  constructor(private pool: PoolLike, private intervalMs = 600_000) {}

  start(): void {
    this.timer = setInterval(() => { void this.tickOnce(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickOnce(): Promise<void> {
    const accounts = await this.pool.list();
    const now = Date.now();
    for (const a of accounts) {
      if (a.status !== "active") continue;
      if (now < (this.nextAt.get(a.id) ?? 0)) continue;
      const ok = await this.pool.probe(a.id);
      if (!ok) {
        await this.pool.reauth(a.id);
        const mult = Math.min((this.backoff.get(a.id) ?? 1) * 2, 4);
        this.backoff.set(a.id, mult);
        this.nextAt.set(a.id, now + this.intervalMs * mult);
      } else {
        this.backoff.set(a.id, 1);
        this.nextAt.set(a.id, now + this.intervalMs);
      }
    }
  }
}
