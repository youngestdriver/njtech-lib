import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { request } from "../../src/http/client.js";
import { CookieJar } from "../../src/http/cookiejar.js";

let server: http.Server; let base = "";
function startMock() {
  server = http.createServer((req, res) => {
    if (req.url === "/redir") {
      res.writeHead(302, { Location: "/final", "Set-Cookie": "a=1; Path=/" });
      res.end(); return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(JSON.stringify({ url: req.url, referer: req.headers.referer ?? null,
                            cookie: req.headers.cookie ?? null }));
  });
  return new Promise<void>(r => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${(server.address() as any).port}`; r();
  }));
}
beforeAll(startMock);
afterAll(() => server.close());

describe("request", () => {
  it("302 不自动跟随（manual redirect）", async () => {
    const r = await request(`${base}/redir`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/final");
  });
  it("带 Referer 与 jar cookie，响应 Set-Cookie 写回 jar", async () => {
    const jar = new CookieJar();
    const r1 = await request(`${base}/final`, { headers: { Referer: `${base}/redir` }, jar });
    const parsed = JSON.parse(r1.body.toString());
    expect(parsed.referer).toBe(`${base}/redir`);
    expect(parsed.cookie).toBeNull();
    const r2 = await request(`${base}/redir`, { jar });
    expect(r2.headers.get("set-cookie")).toContain("a=1");
    const r3 = await request(`${base}/final`, { jar });
    expect(JSON.parse(r3.body.toString()).cookie).toBe("a=1");
  });
});
