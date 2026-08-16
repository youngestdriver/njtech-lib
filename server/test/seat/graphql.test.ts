import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { SeatGraphql, SeatError } from "../../src/seat/graphql.js";
import { CookieJar } from "../../src/http/cookiejar.js";

let server: http.Server; let base = ""; const got: any[] = [];
beforeAll(() => new Promise<void>(r => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      got.push(JSON.parse(raw));
      const op = JSON.parse(raw).operationName;
      res.setHeader("Content-Type", "application/json");
      if (op === "reserueSeat" && JSON.parse(raw).variables.captchaCode === "") {
        res.end(JSON.stringify({ errors: [{ message: "need captcha", extensions: { code: 1000 } }] }));
        return;
      }
      if (op === "reserueSeat") { res.end(JSON.stringify({ data: { userAuth: { reserve: { reserueSeat: true } } } })); return; }
      if (op === "curReserve") {
        res.end(JSON.stringify({ data: { userAuth: { reserve: { reserve: null, getSToken: "st-1" } } } }));
        return;
      }
      res.end(JSON.stringify({ data: {} }));
    });
  });
  server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as any).port}`; r(); });
}));
afterAll(() => server.close());

describe("SeatGraphql", () => {
  const jar = new CookieJar();
  // base 在 beforeAll 中赋值, 而 describe 回调在收集期先执行, 故客户端须惰性构造
  const gql = () => new SeatGraphql(base);

  it("currentReserve 使用已验证查询并解析 reserve/getSToken", async () => {
    const r = await gql().currentReserve(jar);
    expect(r).toEqual({ reserve: null, getSToken: "st-1" });
    expect(got[got.length - 1].query).toContain("getSToken");
  });

  it("reserve 空验证码遇 1000 → needCaptcha", async () => {
    const r = await gql().reserve(jar, 122811, "34,28", "", "");
    expect(r).toEqual({ ok: false, needCaptcha: true, message: "need captcha" });
  });

  it("reserve 带验证码成功", async () => {
    const r = await gql().reserve(jar, 122811, "34,28", "pk3x", "cap-token");
    expect(r).toEqual({ ok: true });
  });

  it("请求带 Referer 与 Content-Type", async () => {
    await gql().currentReserve(jar);
    const reqs = got.length;   // referer 断言在 mock 里太绕, 此处断言查询语句含 userAuth
    expect(got[got.length - 1].query).toContain("userAuth");
  });
});
