import { describe, it, expect } from "vitest";
import { toSeatMapDto } from "../../src/seat/seat-map.js";

const fixture = {
  lib_id: 122811, is_open: true, lib_floor: "2楼", lib_name: "新书借阅室", lib_type: 0,
  lib_layout: {
    seats_total: 173, seats_used: 101, seats_booking: 0, max_x: 10, max_y: 6,
    seats: [
      { x: 0, y: 0, key: "1,1", type: 8, name: null, seat_status: 0, status: false },
      { x: 3, y: 4, key: "34,28", type: 1, name: "87", seat_status: 3, status: true },
      { x: 5, y: 4, key: "56,28", type: 1, name: "88", seat_status: 1, status: false },
      { x: 9, y: 5, key: "99,55", type: 2, name: null, seat_status: 0, status: false },
    ],
  },
};

describe("toSeatMapDto", () => {
  it("映射基础字段与座位数组", () => {
    const dto = toSeatMapDto(fixture);
    expect(dto.libId).toBe(122811);
    expect(dto.libName).toBe("新书借阅室");
    expect(dto.seatsTotal).toBe(173);
    expect(dto.maxX).toBe(10);
    expect(dto.seats).toHaveLength(4);
  });
  it("座位字段保持原样（type/name/seatStatus）", () => {
    const dto = toSeatMapDto(fixture);
    const s87 = dto.seats.find(s => s.key === "34,28")!;
    expect(s87).toEqual({ x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 });
    expect(dto.seats.find(s => s.type === 8)!.name).toBeNull();
  });
  it("lib_layout 缺失时抛错", () => {
    expect(() => toSeatMapDto({ lib_id: 1 })).toThrow(/lib_layout/);
  });
});
