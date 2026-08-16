import { describe, it, expect, afterEach } from "vitest";
import { CasClient, CasError } from "../../src/auth/cas.js";
import { CookieJar } from "../../src/http/cookiejar.js";
import { createMockCas } from "../helpers/mock-cas.js";
import { des3Encrypt } from "../../src/auth/crypto.js";

let mocks: Awaited<ReturnType<typeof createMockCas>>[] = [];
async function startMock(opts = {}) {
  const m = await createMockCas(opts);
  mocks.push(m);
  return m;
}
afterEach(() => { mocks = []; });

describe("CasClient", () => {
  it("channel 登录成功: 发送加密密码并拿到 TGC", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login?service=s1`);
    expect(page.croypto).toBe("MTIzNDU2Nzg=");
    expect(page.flowkey).toBe("test-flow-1");
    await cas.channelLogin(jar, page.url, "2023001", "mypassword");
    expect(jar.header(`${m.url}/cas/login`)).toContain("SOURCEID_TGC=tgc-abc");
    const post = m.requests.find(r => r.method === "POST");
    const body = JSON.parse(post!.body);
    // 密码密文 = 3DES("mypassword,<ts>") 且 ts 与明文时间戳一致
    expect(body.croypto).toBe("MTIzNDU2Nzg=");
    expect(body.password).toBe(des3Encrypt("MTIzNDU2Nzg=", `mypassword,${body.timestamp}`));
  });

  it("channel 被风控: 抛 captcha-required", async () => {
    const m = await startMock({ channelRequireCaptcha: true });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.channelLogin(jar, page.url, "2023001", "mypassword"))
      .rejects.toMatchObject({ kind: "captcha-required" });
  });

  it("表单登录成功: 全字段提交并返回 302 Location", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login?service=https%3A%2F%2Fseat%2Fx`);
    const loc = await cas.formLogin(jar, page.url, "2023001", "mypassword", "pk3x");
    expect(loc).toContain("ticket=ST-mock-1");
    const post = m.requests.find(r => r.method === "POST");
    const form = new URLSearchParams(post!.body);
    expect(form.get("captcha_code")).toBe("pk3x");
    expect(form.get("passwordPre")).toBe("mypassword");
    expect(form.get("password")).toBe(des3Encrypt("MTIzNDU2Nzg=", "mypassword"));
    expect(form.get("execution")).toBe("test-flow-1");
    expect(form.get("geolocation")).toBe("");
  });

  it("表单登录失败(1320007): 抛 bad-credentials", async () => {
    const m = await startMock({ formAccept: (f: URLSearchParams) => f.get("captcha_code") === "right" });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.formLogin(jar, page.url, "2023001", "mypassword", "wrong"))
      .rejects.toMatchObject({ kind: "bad-credentials", code: "1320007" });
  });

  it("findCaptchaCount 带伪 CSRF 头", async () => {
    const m = await startMock();
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    const r = await cas.findCaptchaCount(jar, page.url, "2023001");
    expect(r).toEqual({ captchaInvisible: true, captchaUrl: "api/captcha/generate/DEFAULT" });
    const req = m.requests.find(q => q.url.includes("findCaptchaCount"))!;
    expect(req.headers["csrf-key"]).toBe("FzgxPikIetYDlXZM4lRG9taclVDa99lB");
  });

  it("channel 登录协议错误(502 HTML): 抛 protocol", async () => {
    const m = await startMock({ channelLoginResponse: { status: 502, body: "<html>Bad Gateway</html>" } });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.channelLogin(jar, page.url, "2023001", "mypassword"))
      .rejects.toMatchObject({ kind: "protocol" });
  });

  it("channel 登录 HTTP 500 JSON: 抛 protocol 而非 bad-credentials", async () => {
    const m = await startMock({ channelLoginResponse: { status: 500, body: '{"code":500}' } });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.channelLogin(jar, page.url, "2023001", "mypassword"))
      .rejects.toMatchObject({ kind: "protocol" });
  });

  it("findCaptchaCount 非 JSON 响应: 抛 protocol", async () => {
    const m = await startMock({ findCaptchaCountResponse: { status: 200, body: "<html>WAF</html>" } });
    const jar = new CookieJar();
    const cas = new CasClient();
    const page = await cas.fetchLoginPage(jar, `${m.url}/cas/login`);
    await expect(cas.findCaptchaCount(jar, page.url, "2023001"))
      .rejects.toMatchObject({ kind: "protocol" });
  });
});
