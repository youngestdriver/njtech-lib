import { CookieJar } from "./cookiejar.js";

export const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

export interface HttpResponse { status: number; headers: Headers; body: Buffer }

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  jar?: CookieJar;
  timeoutMs?: number;
}

export async function request(url: string, opts: RequestOpts = {}): Promise<HttpResponse> {
  const headers = new Headers(opts.headers ?? {});
  headers.set("User-Agent", UA);
  const cookie = opts.jar?.header(url);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body as BodyInit,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const body = Buffer.from(await res.arrayBuffer());
  // 多 Set-Cookie 必须用 getSetCookie()（Headers.get 会把多值用 ", " 合并, jar 解析会丢第一个之外的 cookie）
  for (const sc of res.headers.getSetCookie()) opts.jar?.set(sc, url);
  return { status: res.status, headers: res.headers, body };
}
