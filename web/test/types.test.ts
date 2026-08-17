import { describe, it, expect } from "vitest";
import { SeatMapDto } from "../src/api/types.js";

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
