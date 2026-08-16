import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "../config.js";
import { AccountStore } from "../accounts/store.js";
import { SessionPool } from "../accounts/session-pool.js";
import { signToken, verifyToken } from "./auth.js";

export { signToken, verifyToken };

export function buildApp(opts: { pool: SessionPool; store: AccountStore; config: AppConfig }): FastifyInstance {
  const { pool, store, config } = opts;
  const app = Fastify();

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/healthz" || (req.url === "/api/auth/login" && req.method === "POST")) return;
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!verifyToken(token, config.accessPassword)) reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/api/auth/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (password !== config.accessPassword) return reply.code(401).send({ error: "unauthorized" });
    return { token: signToken(config.accessPassword, config.tokenTtlSec) };
  });

  app.get("/api/accounts", async () => pool.list());

  app.post("/api/accounts", async (req) => {
    const { username, password, alias } = (req.body ?? {}) as
      { username: string; password: string; alias?: string };
    if (!username || !password) throw Object.assign(new Error("缺少 username/password"), { statusCode: 400 });
    return pool.addAccount(username, password, alias);
  });

  app.delete("/api/accounts/:id", async (req) => {
    await pool.remove(Number((req.params as any).id));
    return { ok: true };
  });

  app.post("/api/accounts/:id/reauth", async (req) => {
    await pool.reauth(Number((req.params as any).id));
    return { ok: true };
  });

  app.get("/api/accounts/:id/current", async (req) =>
    pool.current(Number((req.params as any).id)));

  app.get("/api/seats/libraries", async () => ({ libs: [] }));   // M1 前端仅需 layout; list 语句后续再加
  app.get("/api/seats/libraries/:libId/layout", async (req) => {
    const q = req.query as { accountId?: string };
    if (!q.accountId) throw Object.assign(new Error("缺少 accountId"), { statusCode: 400 });
    return pool.layout(Number(q.accountId), Number((req.params as any).libId));
  });

  app.post("/api/reserve", async (req) => {
    const { accountId, libId, seatKey } = (req.body ?? {}) as
      { accountId: number; libId: number; seatKey: string };
    if (!accountId || !libId || !seatKey)
      throw Object.assign(new Error("缺少参数"), { statusCode: 400 });
    return pool.reserve(accountId, libId, seatKey);
  });

  app.post("/api/reserve/captcha", async (req) => {
    const { accountId, libId, seatKey, captchaToken, code } = (req.body ?? {}) as
      { accountId: number; libId: number; seatKey: string; captchaToken: string; code: string };
    return pool.reserveWithCaptcha(accountId, libId, seatKey, captchaToken, code);
  });

  app.post("/api/reserve/cancel", async (req) => {
    const { accountId } = (req.body ?? {}) as { accountId: number };
    return pool.cancel(accountId);
  });

  return app;
}
