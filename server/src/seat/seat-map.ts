export interface SeatDto {
  x: number; y: number; key: string; type: number;
  name: string | null; seatStatus: number;
}
export interface SeatMapDto {
  libId: number; libName: string; isOpen: boolean; libFloor: string;
  seatsTotal: number; seatsUsed: number; seatsBooking: number;
  maxX: number; maxY: number; seats: SeatDto[];
}

export function toSeatMapDto(lib: any): SeatMapDto {
  const l = lib?.lib_layout;
  if (!l) throw new Error("libLayout 数据缺少 lib_layout");
  return {
    libId: lib.lib_id,
    libName: lib.lib_name ?? "",
    isOpen: !!lib.is_open,
    libFloor: lib.lib_floor ?? "",
    seatsTotal: l.seats_total ?? 0,
    seatsUsed: l.seats_used ?? 0,
    seatsBooking: l.seats_booking ?? 0,
    maxX: l.max_x ?? 0,
    maxY: l.max_y ?? 0,
    seats: (l.seats ?? []).map((s: any) => ({
      x: s.x, y: s.y, key: s.key, type: s.type,
      name: s.name ?? null, seatStatus: s.seat_status,
    })),
  };
}
