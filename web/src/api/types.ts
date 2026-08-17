export interface SeatDto {
  x: number; y: number; key: string; type: number;
  name: string | null; seatStatus: number;
}
export interface SeatMapDto {
  libId: number; libName: string; isOpen: boolean; libFloor: string;
  seatsTotal: number; seatsUsed: number; seatsBooking: number;
  maxX: number; maxY: number; seats: SeatDto[];
}
export type AccountStatus = "pending" | "active" | "needs-captcha" | "failed";
export interface AccountRow {
  id: number; username: string; alias: string | null;
  status: AccountStatus; lastOkAt: number | null; lastError: string | null; createdAt: number;
}
export interface ReserveInfo {
  token: string; status: number; libId: number; libName: string;
  seatKey: string; seatName: string; expDateStr: string | null;
}
export interface CurrentReserve {
  reserve: ReserveInfo | null; getSToken: string | null;
}
export type ReserveResult =
  | { ok: true }
  | { needCaptcha: true; imageData: string; captchaToken: string }
  | { ok: false; message: string };
