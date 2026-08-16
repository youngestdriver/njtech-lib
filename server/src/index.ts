import { loadConfig, AppConfig } from "./config.js";
import { AccountStore } from "./accounts/store.js";
import { SessionPool } from "./accounts/session-pool.js";
import { CasClient } from "./auth/cas.js";
import { SeatStateMachine } from "./seat/state-machine.js";
import { SeatGraphql } from "./seat/graphql.js";
import { KeepaliveScheduler } from "./keepalive/scheduler.js";
import { buildApp } from "./api/app.js";

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const store = new AccountStore(config.dbPath, config.masterKey);
  const pool = new SessionPool(store, new CasClient(), new SeatStateMachine(), new SeatGraphql());
  const app = buildApp({ pool, store, config });
  const scheduler = new KeepaliveScheduler(pool, config.keepaliveIntervalMs);
  return {
    app,
    async listen() {
      await app.listen({ port: config.port, host: "0.0.0.0" });
      scheduler.start();
      console.log(`njtech-seat listening on :${config.port}`);
    },
    stop() { scheduler.stop(); app.close(); store.close(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().then(s => s.listen()).catch(e => { console.error(e); process.exit(1); });
}
