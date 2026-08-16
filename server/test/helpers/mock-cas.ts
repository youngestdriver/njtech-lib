import http from "node:http";

export interface MockCasOpts {
  channelRequireCaptcha?: boolean;   // rest/login 响应要求验证码
  formAccept?: (body: URLSearchParams) => boolean;  // 表单校验钩子
  channelLoginResponse?: { status: number; body: string };      // 覆盖 rest/login 响应（协议错误场景）
  findCaptchaCountResponse?: { status: number; body: string };  // 覆盖 findCaptchaCount 响应
}
export interface CasRequest { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

export function createMockCas(opts: MockCasOpts = {}) {
  const requests: CasRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: raw });
      const u = new URL(req.url!, "https://sfgl.njtech.edu.cn");
      if (u.pathname === "/cas/login" && req.method === "GET") {
        // ★TGC 感知（2026-08-16 预检修正）: 带 SOURCEID_TGC 直接 302 发 ST（SSO 免登录）
        if ((req.headers.cookie ?? "").includes("SOURCEID_TGC")) {
          const service = u.searchParams.get("service");
          res.writeHead(302, { Location: `${service}&ticket=ST-cas-1` });
          res.end();
          return;
        }
        res.setHeader("Set-Cookie", "SESSION=cas-session; Path=/cas/");
        res.setHeader("Content-Type", "text/html");
        res.end('<html><p id="login-croypto">MTIzNDU2Nzg=</p>' +
                '<p id="login-page-flowkey">test-flow-1</p></html>');
        return;
      }
      if (u.pathname === "/cas/protected/rest/login" && req.method === "POST") {
        if (opts.channelLoginResponse) {
          res.statusCode = opts.channelLoginResponse.status;
          res.end(opts.channelLoginResponse.body);
          return;
        }
        const body = JSON.parse(raw);
        const ok = body.username === "2023001" && body.password && body.timestamp && body.croypto;
        if (!ok) { res.end(JSON.stringify({ code: 400, message: "失败" })); return; }
        if (opts.channelRequireCaptcha) {
          res.end(JSON.stringify({ code: 200, data: { result: false, captchaInvisible: true } }));
          return;
        }
        res.setHeader("Set-Cookie", "SOURCEID_TGC=tgc-abc; Path=/cas/; HttpOnly");
        res.end(JSON.stringify({ code: 200, message: "登录成功", data: { result: true } }));
        return;
      }
      if (u.pathname === "/cas/api/captcha/generate/DEFAULT") {
        res.setHeader("Content-Type", "image/png");
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));  // 假 PNG 头即可
        return;
      }
      if (u.pathname.startsWith("/cas/api/protected/user/findCaptchaCount/")) {
        if (opts.findCaptchaCountResponse) {
          res.statusCode = opts.findCaptchaCountResponse.status;
          res.end(opts.findCaptchaCountResponse.body);
          return;
        }
        if (req.headers["csrf-key"] !== "FzgxPikIetYDlXZM4lRG9taclVDa99lB") {
          res.end(JSON.stringify({ code: 401, message: "Unauthorized" })); return;
        }
        res.end(JSON.stringify({ code: 200, data: { captchaInvisible: true,
          captchaUrl: "api/captcha/generate/DEFAULT" } }));
        return;
      }
      if (u.pathname === "/cas/login" && req.method === "POST") {
        const form = new URLSearchParams(raw);
        if (!form.get("username") || !form.get("passwordPre") || !form.get("password")
            || !form.get("captcha_code") || !form.get("execution")
            || form.get("type") !== "UsernamePassword" || form.get("_eventId") !== "submit"
            || !form.get("croypto") || form.get("geolocation") === null) {
          res.setHeader("Content-Type", "text/html");
          res.end('<p id="login-error-code">1320007</p>');
          return;
        }
        if (opts.formAccept && !opts.formAccept(form)) {
          res.setHeader("Content-Type", "text/html");
          res.end('<p id="login-error-code">1320007</p>');
          return;
        }
        const service = u.searchParams.get("service");
        res.setHeader("Set-Cookie", "SOURCEID_TGC=tgc-form; Path=/cas/; HttpOnly");
        res.writeHead(302, { Location: `${service}&ticket=ST-mock-1` });
        res.end();
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise<{ port: number; url: string; requests: CasRequest[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port,
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      requests,
    }));
  });
}
