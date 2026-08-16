// 用法: STU=学号 STUPASS=密码 [SMOKE_RESERVE=1] npx tsx scripts/smoke.ts
// 连真实系统: 登录 → 查当前预约 → 座位图 → (可选) 选座+退座
import { CasClient } from "../src/auth/cas.js";
import { SeatStateMachine } from "../src/seat/state-machine.js";
import { SeatGraphql } from "../src/seat/graphql.js";
import { CookieJar } from "../src/http/cookiejar.js";
import { toSeatMapDto } from "../src/seat/seat-map.js";

const { STU, STUPASS, SMOKE_RESERVE } = process.env as Record<string, string | undefined>;
if (!STU || !STUPASS) { console.error("需要 STU/STUPASS 环境变量"); process.exit(1); }

const jar = new CookieJar();
const cas = new CasClient();
const sm = new SeatStateMachine();
const gql = new SeatGraphql();

const u5 = await sm.start(jar);
const page = await sm.toCasLoginPage(jar, u5);
console.log("croypto:", page.body.toString("utf8").match(/id="login-croypto">([^<]+)</)?.[1]);
await cas.channelLogin(jar, page.url, STU, STUPASS);
await sm.completeLogin(jar, u5);

const { reserve, getSToken } = await gql.currentReserve(jar);
console.log("当前预约:", reserve ?? "无", "getSToken:", getSToken ? "有" : "无");

const layout = toSeatMapDto(await gql.layout(jar, 122811));
console.log(`座位图 ${layout.libName}: 总${layout.seatsTotal} 用${layout.seatsUsed} 预约${layout.seatsBooking}`);
const free = layout.seats.find(s => s.type === 1 && s.seatStatus === 1);
console.log("第一个空闲座位:", free);

if (SMOKE_RESERVE === "1" && free) {
  const r = await gql.reserve(jar, layout.libId, free.key, "", "");
  console.log("选座:", r);
  if (r.ok) {
    const cur = await gql.currentReserve(jar);
    await gql.cancel(jar, cur.getSToken!);
    console.log("已退座");
  }
}
