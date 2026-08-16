import { describe, it, expect } from "vitest";
import { SeatStateMachine } from "../../src/seat/state-machine.js";
import { CookieJar } from "../../src/http/cookiejar.js";
import { createMockSeat, createMockUnjtech } from "../helpers/mock-seat.js";
import { createMockCas } from "../helpers/mock-cas.js";

// 状态机默认走真实 https://seat.njtech.edu.cn；测试通过 start 的可选 base 参数注入 mock 地址。
describe("SeatStateMachine", () => {
  it("①-④ 每跳 Referer 正确且返回 u.njtech URL", async () => {
    const seat = await createMockSeat(`http://u.njtech.edu.cn`);  // 占位, 只验证①-④
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    expect(u5).toContain("/cas/login?service=");
    const refs = seat.requests.map(r => r.referer ?? "");
    expect(refs[1]).toContain("/reserve/index.html");   // ② 的 Referer = ①
    expect(refs[2]).toContain("/index/boot.html");      // ③ 的 Referer = ②
    expect(refs[3]).toContain("/user/login.html");      // ④ 的 Referer = ③
  });

  it("无 TGC: toCasLoginPage 落在 sfgl 登录页 200", async () => {
    const cas = await createMockCas();
    const unj = await createMockUnjtech(cas.url);
    const seat = await createMockSeat(unj.url);
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    const { url, body } = await sm.toCasLoginPage(jar, u5);
    expect(url).toContain(`${cas.url}/cas/login?service=`);
    expect(body.toString()).toContain("login-croypto");
  });

  it("有 TGC: completeLogin 一路 302/303 落到 /web/index.html 且会话 cookie 就位", async () => {
    const cas = await createMockCas();
    const unj = await createMockUnjtech(cas.url);
    const seat = await createMockSeat(unj.url);
    const sm = new SeatStateMachine();
    const jar = new CookieJar();
    const u5 = await sm.start(jar, seat.url);
    // 模拟已有 TGC（channel 登录后）
    jar.set("SOURCEID_TGC=tgc-abc; Path=/cas/", `${cas.url}/cas/login`);
    await sm.completeLogin(jar, u5);
    expect(jar.header(seat.url + "/index.php/graphql/")).toContain("wechatSESS_ID=w-sess");
    expect(jar.header(seat.url + "/index.php/graphql/")).toContain("PHPSESSID=p-sess");
    const ticketHop = seat.requests.find(r => r.url.includes("ticket="));
    expect(ticketHop).toBeTruthy();   // phpCAS 验票发生
    expect(ticketHop!.referer).toContain("/cas/login");  // ⑥ Referer = sfgl 登录页
  });
});
