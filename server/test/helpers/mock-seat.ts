import http from "node:http";

// seat.njtech.edu.cn mock：按 docs/seat.md 实测序列回放 ①-④ 与 ⑥-⑧。
// ①-③ 用相对 Location（真实系统即相对，见 docs/seat.md）；④ 绝对跳 u.njtech，
// service 指向本 mock 自身（用请求 Host 推导），保证 ticket 回程（⑥）落在 mock 上。
export interface SeatRequest { method: string; url: string; referer: string | undefined; body: string }

export interface MockSeatOpts {
  graphql?: {
    reserve?: any;               // curReserve 返回的 reserve 数据（默认 null = 无预约）
    getSToken?: string | null;   // curReserve 返回的 getSToken（默认 null）
  };
}

export function createMockSeat(u5Base: string, opts: MockSeatOpts = {}) {
  const requests: SeatRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, referer: req.headers.referer, body: raw });
      const send = (code: number, loc?: string, cookie?: string) => {
        if (cookie) res.setHeader("Set-Cookie", cookie);
        if (loc) res.writeHead(code, { Location: loc });
        else res.writeHead(code, { "Content-Type": "text/html" });
        res.end(loc ? "" : "<html>ok</html>");
      };
      const u = new URL(req.url!, "https://seat.njtech.edu.cn");
      // GraphQL 端点: 按 operationName 返回可配置数据（curReserve 默认无预约, 供 probe/cancel 用）
      if (u.pathname === "/index.php/graphql/") {
        let body: any = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* 非 JSON 不解析 */ }
        const op = body.operationName as string;
        res.setHeader("Content-Type", "application/json");
        if (op === "curReserve") {
          res.end(JSON.stringify({ data: { userAuth: { reserve: {
            reserve: opts.graphql?.reserve ?? null,
            getSToken: opts.graphql?.getSToken ?? null,
          } } } }));
          return;
        }
        if (op === "reserueSeat") {
          res.end(JSON.stringify({ data: { userAuth: { reserve: { reserueSeat: true } } } }));
          return;
        }
        if (op === "reserveCancle") {
          res.end(JSON.stringify({ data: { userAuth: { reserve: { reserveCancle: { timerange: 1 } } } } }));
          return;
        }
        if (op === "captcha") {
          res.end(JSON.stringify({ data: { captcha: { code: "c1", data: "img" } } }));
          return;
        }
        res.end(JSON.stringify({ data: {} }));
        return;
      }
      if (u.pathname === "/index.php/reserve/index.html") {
        send(302, "/index.php/index/boot.html"); return;
      }
      if (u.pathname === "/index.php/index/boot.html" && req.headers.referer?.includes("/reserve/index.html")) {
        send(303, "/index.php/user/login.html", "wechatSESS_ID=w-sess; Path=/"); return;
      }
      if (u.pathname === "/index.php/user/login.html" && req.headers.referer?.includes("/index/boot.html")) {
        send(303, "/index.php/cas/login.html?schId=20317"); return;
      }
      if (u.pathname === "/index.php/cas/login.html" && req.headers.referer?.includes("/user/login.html")) {
        // ★④ 必须带 Referer；service 用本 mock 地址（由 Host 推导）以便 ⑥ ticket 回程
        const service = `http://${req.headers.host}/index.php/cas/login.html?schId=20317`;
        send(302, `${u5Base}/cas/login?service=${encodeURIComponent(service)}`);
        return;
      }
      // ⑥ phpCAS 验票：302 去参
      if (u.pathname === "/index.php/cas/login.html" && u.searchParams.get("ticket")) {
        send(302, "/index.php/cas/login.html?schId=20317"); return;
      }
      // 去参后回到 cas/login.html → 303 boot
      if (u.pathname === "/index.php/cas/login.html") {
        send(303, "/index.php/index/boot.html"); return;
      }
      // ⑦ 已登录 boot → 应用页
      if (u.pathname === "/index.php/index/boot.html") {
        send(303, "/web/index.html#/pages/index/index?r=123"); return;
      }
      // ⑧ 应用页 200（会话 cookie 就位）
      if (u.pathname === "/web/index.html") {
        send(200, undefined, "PHPSESSID=p-sess; Path=/"); return;
      }
      send(404);
    });
  });
  return new Promise<{ port: number; url: string; requests: SeatRequest[]; opts: MockSeatOpts }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port,
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      requests,
      opts,
    }));
  });
}

// u.njtech mock：只做 302 转发到 sfgl 同路径（状态机测试中 sfgl 由 mock-cas 承担）。
export function createMockUnjtech(sfglBase: string) {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: sfglBase + req.url });
    res.end();
  });
  return new Promise<{ port: number; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as any).port, url: `http://127.0.0.1:${(server.address() as any).port}`,
    }));
  });
}
