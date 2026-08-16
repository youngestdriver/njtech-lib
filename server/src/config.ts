export interface AppConfig {
  port: number;
  dbPath: string;
  masterKey: Buffer;          // 32 字节
  accessPassword: string;
  keepaliveIntervalMs: number;
  tokenTtlSec: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const keyHex = env.NJ_SEAT_MASTER_KEY;
  if (!keyHex) throw new Error("缺少 NJ_SEAT_MASTER_KEY（32 字节 hex 主密钥）");
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("NJ_SEAT_MASTER_KEY 必须是 32 字节 hex");
  const accessPassword = env.NJ_SEAT_ACCESS_PASSWORD;
  if (!accessPassword) throw new Error("缺少 NJ_SEAT_ACCESS_PASSWORD");
  return {
    port: Number(env.NJ_SEAT_PORT ?? 8791),
    dbPath: env.NJ_SEAT_DB ?? "server/data/app.db",
    masterKey: Buffer.from(keyHex, "hex"),
    accessPassword,
    keepaliveIntervalMs: Number(env.NJ_SEAT_KEEPALIVE_MS ?? 600_000),
    tokenTtlSec: 7 * 24 * 3600,
  };
}
