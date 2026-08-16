import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";

export const SEAT_BASE = "https://seat.njtech.edu.cn";
const ENTRY = "/index.php/reserve/index.html?f=h5&from_code=WwsCBVIIAQs%3D";

export class SeatStateMachine {
  private base: string;
  constructor(base = SEAT_BASE) { this.base = base; }

  private hop = async (jar: CookieJar, url: string, referer: string | null) => {
    const r = await request(url, { jar, headers: referer ? { Referer: referer } : {} });
    return { status: r.status, location: r.headers.get("location"), body: r.body };
  };

  /** ①-④: 返回 U5（u.njtech /cas/login URL）。base 可注入（测试用 mock），默认 this.base */
  async start(jar: CookieJar, base = this.base): Promise<string> {
    const u1 = base + ENTRY;
    const h1 = await this.hop(jar, u1, null);
    if (h1.status !== 302 || !h1.location) throw new Error(`① 失败: ${h1.status}`);
    const u2 = new URL(h1.location, base).toString();
    const h2 = await this.hop(jar, u2, u1);
    if (h2.status !== 303 || !h2.location) throw new Error(`② 失败: ${h2.status}`);
    const u3 = new URL(h2.location, base).toString();
    const h3 = await this.hop(jar, u3, u2);
    if (h3.status !== 303 || !h3.location) throw new Error(`③ 失败: ${h3.status}`);
    const u4 = new URL(h3.location, base).toString();
    const h4 = await this.hop(jar, u4, u3);
    if (h4.status !== 302 || !h4.location) throw new Error(`④ 失败: ${h4.status}`);
    return new URL(h4.location, base).toString();
  }

  /** ⑤ 无 TGC: 手动跟随到 sfgl 登录页 200 */
  async toCasLoginPage(jar: CookieJar, u5: string): Promise<{ url: string; body: Buffer }> {
    let cur = u5, ref = u5, hops = 0;
    while (hops++ < 5) {
      const h = await this.hop(jar, cur, ref);
      if (h.status === 200) return { url: cur, body: h.body };
      if (!h.location) throw new Error(`⑤ 断链: ${h.status} @ ${cur}`);
      ref = cur; cur = new URL(h.location, cur).toString();
    }
    throw new Error("⑤ 跳转过多");
  }

  /** ⑤(带TGC)→⑥: 跟随直到落在 /web/index.html 200 */
  async completeLogin(jar: CookieJar, u5: string): Promise<void> {
    let cur = u5, ref = u5, hops = 0;
    while (hops++ < 10) {
      const h = await this.hop(jar, cur, ref);
      if (h.status >= 300 && h.status < 400 && h.location) {
        ref = cur; cur = new URL(h.location, cur).toString();
        continue;
      }
      if (h.status === 200 && new URL(cur).pathname === "/web/index.html") return;
      throw new Error(`completeLogin 未到达应用页: ${h.status} @ ${cur}`);
    }
    throw new Error("completeLogin 跳转过多");
  }
}
