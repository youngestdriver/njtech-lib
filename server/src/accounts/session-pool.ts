import { AccountStore, AccountRow, AccountStatus } from "./store.js";
import { Locker } from "./locker.js";
import { CasClient, CasError } from "../auth/cas.js";
import { SeatStateMachine } from "../seat/state-machine.js";
import { SeatGraphql, ReserveInfo } from "../seat/graphql.js";
import { toSeatMapDto, SeatMapDto } from "../seat/seat-map.js";
import { CookieJar } from "../http/cookiejar.js";

export interface SessionInfo { status: AccountStatus; lastError: string | null }

const RETRY_DELAYS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface PendingCaptcha { libId: number; seatKey: string; captchaToken: string }

export class SessionPool {
  private jars = new Map<number, CookieJar>();
  private pendingCaptcha = new Map<number, PendingCaptcha>();
  private failStreak = new Map<number, number>();
  private locker = new Locker();

  constructor(private store: AccountStore, private cas: CasClient,
              private sm: SeatStateMachine, private gql: SeatGraphql) {}

  async addAccount(username: string, password: string, alias?: string): Promise<AccountRow & SessionInfo> {
    const row = this.store.add(username, password, alias);
    await this.login(row.id, password);
    return this.info(row.id);
  }

  async list(): Promise<Array<AccountRow & SessionInfo>> {
    return Promise.all(this.store.list().map(r => this.info(r.id)));
  }

  async remove(accountId: number): Promise<void> {
    this.jars.delete(accountId);
    this.pendingCaptcha.delete(accountId);
    this.store.remove(accountId);
  }

  private info(id: number): AccountRow & SessionInfo {
    const row = this.store.list().find(a => a.id === id)!;
    return { ...row, lastError: row.lastError };
  }

  private jar(id: number): CookieJar {
    let j = this.jars.get(id);
    if (!j) { j = new CookieJar(); this.jars.set(id, j); }
    return j;
  }

  /** 完整登录链: seat①-④ → CAS channel → seat⑤-⑥; 失败退避与状态落库。
   *  每次尝试用全新 jar: 重登必须重走 channel 链, 残留 TGC 会触发 CAS SSO 直通
   *  （toCasLoginPage 直接落到应用页, channelLogin 无登录页可解析 → 协议错误）。 */
  private async login(id: number, password: string): Promise<void> {
    const username = this.store.list().find(a => a.id === id)!.username;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const jar = new CookieJar();
      this.jars.set(id, jar);
      try {
        const u5 = await this.sm.start(jar);
        const page = await this.sm.toCasLoginPage(jar, u5);
        await this.cas.channelLogin(jar, page.url, username, password);
        await this.sm.completeLogin(jar, u5);
        this.store.setStatus(id, "active");
        this.failStreak.set(id, 0);
        return;
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof CasError && e.kind === "captcha-required") {
          this.store.setStatus(id, "needs-captcha", "CAS 要求验证码，请手动处理");
          return;
        }
        await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      }
    }
    this.store.setStatus(id, "failed", lastErr?.message ?? "登录失败");
  }

  private async ensureSession(id: number): Promise<CookieJar> {
    const row = this.store.list().find(a => a.id === id);
    if (!row) throw new Error("账号不存在");
    if (row.status !== "active") throw new Error(`账号不可用: ${row.status}`);
    return this.jar(id);
  }

  async probe(id: number): Promise<boolean> {
    return this.locker.withLock(`acct:${id}`, async () => {
      try {
        const jar = await this.ensureSession(id);
        await this.gql.currentReserve(jar);
        this.store.setLastOk(id, Date.now());
        this.store.setStatus(id, "active");
        this.failStreak.set(id, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  async reauth(id: number): Promise<void> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const password = this.store.getPassword(id);
      await this.login(id, password);
      if (this.store.list().find(a => a.id === id)!.status === "failed") {
        const streak = (this.failStreak.get(id) ?? 0) + 1;
        this.failStreak.set(id, streak);
        if (streak >= 3) this.store.setStatus(id, "failed", "连续 3 次重登失败");
      }
    });
  }

  async layout(id: number, libId: number): Promise<SeatMapDto> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      return toSeatMapDto(await this.gql.layout(jar, libId));
    });
  }

  async current(id: number): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      return this.gql.currentReserve(jar);
    });
  }

  async reserve(id: number, libId: number, seatKey: string):
    Promise<{ ok: true } | { needCaptcha: true; imageData: string; captchaToken: string } | { ok: false; message: string }> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const r = await this.gql.reserve(jar, libId, seatKey, "", "");
      if (r.ok) return { ok: true as const };
      if (r.needCaptcha) {
        const cap = await this.gql.reserveCaptcha(jar);
        this.pendingCaptcha.set(id, { libId, seatKey, captchaToken: cap.code });
        return { needCaptcha: true as const, imageData: cap.imageData, captchaToken: cap.code };
      }
      return { ok: false as const, message: r.message };
    });
  }

  async reserveWithCaptcha(id: number, libId: number, seatKey: string,
                           captchaToken: string, code: string):
    Promise<{ ok: true } | { ok: false; message: string }> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const r = await this.gql.reserve(jar, libId, seatKey, code, captchaToken);
      this.pendingCaptcha.delete(id);
      return r.ok ? { ok: true as const } : { ok: false as const, message: r.message };
    });
  }

  async cancel(id: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.locker.withLock(`acct:${id}`, async () => {
      const jar = await this.ensureSession(id);
      const { reserve, getSToken } = await this.gql.currentReserve(jar);
      if (!reserve) return { ok: false as const, message: "当前没有进行中的预约" };
      if (!getSToken) return { ok: false as const, message: "缺少退座凭证" };
      try {
        await this.gql.cancel(jar, getSToken);
        const after = await this.gql.currentReserve(jar);
        if (after.reserve) return { ok: false as const, message: "退座后复查仍有预约" };
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, message: (e as Error).message };
      }
    });
  }
}
