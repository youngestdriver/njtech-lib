import { describe, it, expect } from "vitest";
import { SeatMapDto, AccountRow, CurrentReserve, ReserveResult } from "../src/api/types.js";

// 真实系统 2026-08-15/16 实测数据形态（docs/seat.md）的守卫：
// seatStatus 1=空闲 3=占用；type 1=真实座位 2=桌面 8=服务台；name 仅真实座位有值
const REAL_LAYOUT: SeatMapDto = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 173, seatsUsed: 101, seatsBooking: 0, maxX: 10, maxY: 6,
  seats: [
    { x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 },
    { x: 5, y: 4, key: "56,28", type: 1, name: "88", seatStatus: 1 },
    { x: 9, y: 5, key: "99,55", type: 2, name: null, seatStatus: 0 },
    { x: 0, y: 0, key: "1,1", type: 8, name: null, seatStatus: 0 },
  ],
};

// 终审推荐项: 其余 DTO 的 fixture 守卫（与 SeatMapDto 同一方式: 编译期类型 + 运行时形态断言）
const REAL_ACCOUNT: AccountRow = {
  id: 1, username: "2023001", alias: "我自己", status: "active",
  lastOkAt: 1723700000000, lastError: null, createdAt: 1723600000000,
};
const REAL_CURRENT: CurrentReserve = {
  reserve: {
    token: "tok-1", status: 3, libId: 122811, libName: "新书借阅室",
    seatKey: "34,28", seatName: "87", expDateStr: "2026-08-16 12:00",
  },
  getSToken: "s-tok",
};
const RESERVE_OK: ReserveResult = { ok: true };
const RESERVE_CAPTCHA: ReserveResult = { needCaptcha: true, imageData: "img-b64", captchaToken: "cap-1" };
const RESERVE_FAIL: ReserveResult = { ok: false, message: "座位已满" };

describe("SeatMapDto 契约守卫", () => {
  it("真实形态 fixture 通过类型检查并可序列化", () => {
    expect(JSON.stringify(REAL_LAYOUT.seats[0].key)).toBe('"34,28"');
    expect(REAL_LAYOUT.seats.find(s => s.name === "87")!.seatStatus).toBe(3);
  });
  it("类型守卫: 编译期验证字段（无运行时断言, 由 tsc strict 兜底）", () => {
    const dto: SeatMapDto = REAL_LAYOUT;
    expect(dto.seats.length).toBe(4);
  });
});

describe("其余 DTO 契约守卫（终审推荐项）", () => {
  it("AccountRow 真实形态 fixture", () => {
    expect(REAL_ACCOUNT.status).toBe("active");
    expect(JSON.stringify(REAL_ACCOUNT.username)).toBe('"2023001"');
  });
  it("CurrentReserve/ReserveInfo 真实形态 fixture", () => {
    expect(REAL_CURRENT.reserve?.status).toBe(3);
    expect(REAL_CURRENT.reserve?.seatKey).toBe("34,28");
    expect(REAL_CURRENT.getSToken).toBe("s-tok");
  });
  it("ReserveResult 三态可判别（ok / needCaptcha / 失败消息）", () => {
    expect(RESERVE_OK.ok).toBe(true);
    expect(RESERVE_CAPTCHA.needCaptcha).toBe(true);
    expect(RESERVE_CAPTCHA.captchaToken).toBe("cap-1");
    expect(RESERVE_FAIL.ok).toBe(false);
    expect(RESERVE_FAIL.message).toBe("座位已满");
  });
  it("类型守卫: 编译期验证字段（tsc strict 兜底）", () => {
    const a: AccountRow = REAL_ACCOUNT;
    const c: CurrentReserve = REAL_CURRENT;
    const r: ReserveResult = RESERVE_OK;
    expect([a.id, c.reserve!.libId, r.ok]).toEqual([1, 122811, true]);
  });
});
