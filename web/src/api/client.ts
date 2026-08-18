import type { ReserveResult, SeatMapDto, AccountRow, CurrentReserve } from "./types.js";

const TOKEN_KEY = "njseat-token";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

export async function apiRequest<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        // 无 body 时不声明 json content-type（Fastify 对空 body + json 报 400）
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "无法连接后端");
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("auth-expired"));
    throw new ApiError(401, "未授权");
  }
  // 用状态码范围而非 res.ok：测试 mock 的响应对象无 ok 字段（与真实 Response 等价）
  if (res.status < 200 || res.status >= 300) {
    // message 优先: Fastify 500 的 error 字段是通用 "Internal Server Error", message 才是真实原因
    throw new ApiError(res.status, data?.message ?? data?.error ?? "请求失败");
  }
  return data as T;
}

export async function login(password: string): Promise<string> {
  const r = await apiRequest<{ token: string }>("/api/auth/login", { method: "POST", body: { password } });
  return r.token;
}

export const api = {
  accounts: () => apiRequest<AccountRow[]>("/api/accounts"),
  addAccount: (username: string, password: string, alias?: string) =>
    apiRequest<AccountRow>("/api/accounts", { method: "POST", body: { username, password, alias } }),
  removeAccount: (id: number) => apiRequest<{ ok: true }>(`/api/accounts/${id}`, { method: "DELETE" }),
  reauth: (id: number) => apiRequest<{ ok: true }>(`/api/accounts/${id}/reauth`, { method: "POST" }),
  loginCaptcha: (id: number, captchaCode: string) =>
    apiRequest<{ ok: true }>(`/api/accounts/${id}/login-captcha`, { method: "POST", body: { captchaCode } }),
  loginCaptchaImage: (id: number) =>
    apiRequest<{ imageData: string }>(`/api/accounts/${id}/login-captcha-image`),
  current: (id: number) => apiRequest<CurrentReserve>(`/api/accounts/${id}/current`),
  layout: (libId: number, accountId: number) =>
    apiRequest<SeatMapDto>(`/api/seats/libraries/${libId}/layout?accountId=${accountId}`),
  reserve: (accountId: number, libId: number, seatKey: string) =>
    apiRequest<ReserveResult>("/api/reserve", { method: "POST", body: { accountId, libId, seatKey } }),
  reserveCaptcha: (accountId: number, libId: number, seatKey: string, captchaToken: string, code: string) =>
    apiRequest<ReserveResult>("/api/reserve/captcha", { method: "POST", body: { accountId, libId, seatKey, captchaToken, code } }),
  cancel: (accountId: number) => apiRequest<ReserveResult>("/api/reserve/cancel", { method: "POST", body: { accountId } }),
};
