import { describe, it, expect } from "vitest";
import { CookieJar } from "../../src/http/cookiejar.js";

describe("CookieJar", () => {
  it("解析 Set-Cookie 并按域名+路径保存", () => {
    const jar = new CookieJar();
    jar.set("SESSION=abc123; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("wechatSESS_ID=w1; Path=/", "https://seat.njtech.edu.cn/index.php/index/boot.html");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login?service=x"))
      .toBe("SESSION=abc123");
    expect(jar.header("https://seat.njtech.edu.cn/index.php/graphql/"))
      .toBe("wechatSESS_ID=w1");
    // 域隔离：seat 的请求不带 sfgl 的 cookie
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/api/captcha/generate/DEFAULT"))
      .not.toContain("wechatSESS_ID");
  });

  it("同路径同名覆盖 + 不同路径共存", () => {
    const jar = new CookieJar();
    jar.set("SESSION=s1; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("SESSION=s2; Path=/cas/", "https://sfgl.njtech.edu.cn/cas/login");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login")).toBe("SESSION=s2");
  });

  it("HttpOnly 与过期时间影响存储", () => {
    const jar = new CookieJar();
    jar.set("TGC=t1; Path=/cas/; HttpOnly; Max-Age=3600", "https://sfgl.njtech.edu.cn/cas/login");
    jar.set("GONE=x; Path=/cas/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
            "https://sfgl.njtech.edu.cn/cas/login");
    expect(jar.header("https://sfgl.njtech.edu.cn/cas/login")).toBe("TGC=t1");
  });
});
