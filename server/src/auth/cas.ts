import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";
import { des3Encrypt } from "./crypto.js";

export const CSRF_KEY = "FzgxPikIetYDlXZM4lRG9taclVDa99lB";
export const CSRF_VALUE = "7964f321f00366a3a287a133dd307ed0";

export interface LoginPage { url: string; croypto: string; flowkey: string }

export class CasError extends Error {
  constructor(public kind: "captcha-required" | "bad-credentials" | "protocol",
              public code?: string, message?: string) { super(message ?? kind); }
}

export class CasClient {
  async fetchLoginPage(jar: CookieJar, loginPageUrl: string): Promise<LoginPage> {
    const r = await request(loginPageUrl, { jar });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    const html = r.body.toString("utf8");
    const croypto = /id="login-croypto">([^<]+)</.exec(html)?.[1];
    const flowkey = /id="login-page-flowkey">([^<]+)</.exec(html)?.[1];
    if (!croypto || !flowkey) throw new CasError("protocol", undefined, "登录页缺少 croypto/flowkey");
    return { url: loginPageUrl, croypto, flowkey };
  }

  async findCaptchaCount(jar: CookieJar, loginPageUrl: string, username: string) {
    const base = new URL("/cas/api/protected/user/findCaptchaCount/" + username,
                         new URL(loginPageUrl).origin).toString();
    const r = await request(base, {
      jar,
      headers: { "Csrf-Key": CSRF_KEY, "Csrf-Value": CSRF_VALUE, Referer: loginPageUrl },
    });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    let parsed: any;
    try { parsed = JSON.parse(r.body.toString("utf8")); }
    catch { throw new CasError("protocol", String(r.status)); }
    const data = parsed.data ?? {};
    return { captchaInvisible: !!data.captchaInvisible,
             captchaUrl: data.captchaUrl ?? null };
  }

  async fetchCaptchaImage(jar: CookieJar, loginPageUrl: string): Promise<Buffer> {
    const base = new URL("api/captcha/generate/DEFAULT", loginPageUrl).toString();
    const r = await request(base, { jar, headers: { Referer: loginPageUrl } });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    return r.body;
  }

  async channelLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string): Promise<void> {
    const page = await this.fetchLoginPage(jar, loginPageUrl);
    const ts = Date.now();
    const enc = des3Encrypt(page.croypto, `${password},${ts}`);
    const url = new URL("/cas/protected/rest/login", new URL(loginPageUrl).origin).toString();
    const r = await request(url, {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: loginPageUrl },
      body: JSON.stringify({ username, password: enc, timestamp: ts, croypto: page.croypto }),
    });
    if (r.status !== 200) throw new CasError("protocol", String(r.status));
    let res: any;
    try { res = JSON.parse(r.body.toString("utf8")); }
    catch { throw new CasError("protocol", String(r.status)); }
    if (res.data?.captchaInvisible) throw new CasError("captcha-required");
    if (res.code !== 200) throw new CasError("bad-credentials", String(res.code));
  }

  async formLogin(jar: CookieJar, loginPageUrl: string, username: string, password: string,
                  captchaCode: string): Promise<string> {
    const page = await this.fetchLoginPage(jar, loginPageUrl);
    const body = new URLSearchParams({
      type: "UsernamePassword", _eventId: "submit", geolocation: "",
      execution: page.flowkey, captcha_code: captchaCode,
      username, passwordPre: password,
      croypto: page.croypto,
      password: des3Encrypt(page.croypto, password),
    }).toString();
    const r = await request(loginPageUrl, {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: loginPageUrl },
      body,
    });
    if (r.status >= 300 && r.status < 400) return r.headers.get("location") ?? "";
    const html = r.body.toString("utf8");
    const code = /id="login-error-code">([^<]*)</.exec(html)?.[1]
              ?? /id="login-error-msg"[^>]*>(.*?)<\//s.exec(html)?.[1];
    throw new CasError("bad-credentials", code || undefined);
  }
}
