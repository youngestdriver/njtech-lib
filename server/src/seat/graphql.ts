import { request } from "../http/client.js";
import { CookieJar } from "../http/cookiejar.js";

export class SeatError extends Error {
  constructor(public code?: string, message?: string) { super(message ?? code ?? "seat error"); }
}

const Q_CURRENT = `query curReserve {
  userAuth {
    reserve {
      reserve {
        token
        status
        lib_id
        lib_name
        lib_floor
        seat_key
        seat_name
        date
        exp_date
        exp_date_str
        validate_date
        diff
        diff_str
      }
      getSToken
    }
  }
}`;

const Q_LAYOUT = `query libLayout($libId: Int, $libType: Int) {
  userAuth {
    reserve {
      libs(libType: $libType, libId: $libId) {
        lib_id
        is_open
        lib_floor
        lib_name
        lib_type
        lib_layout {
          seats_total
          seats_booking
          seats_used
          max_x
          max_y
          seats {
            x
            y
            key
            type
            name
            seat_status
            status
          }
        }
      }
    }
  }
}`;

const M_RESERVE = `mutation reserueSeat($libId: Int!, $seatKey: String!, $captchaCode: String, $captcha: String!) {
  userAuth {
    reserve {
      reserueSeat(
        libId: $libId
        seatKey: $seatKey
        captchaCode: $captchaCode
        captcha: $captcha
      )
    }
  }
}`;

const M_CANCEL = `mutation reserveCancle($sToken: String!) {
  userAuth {
    reserve {
      reserveCancle(sToken: $sToken) {
        timerange
        img
        hours
        mins
        per
      }
    }
  }
}`;

const Q_CAPTCHA = `query captcha {
  captcha {
    code
    data
  }
}`;

export interface ReserveInfo {
  token: string; status: number; libId: number; libName: string;
  seatKey: string; seatName: string; expDateStr: string | null;
}

export class SeatGraphql {
  constructor(private base = "https://seat.njtech.edu.cn") {}

  async raw(jar: CookieJar, operationName: string, query: string,
            variables: Record<string, unknown>): Promise<any> {
    const r = await request(this.base + "/index.php/graphql/", {
      jar,
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: this.base + "/web/index.html" },
      body: JSON.stringify({ operationName, query, variables }),
    });
    return JSON.parse(r.body.toString("utf8"));
  }

  async currentReserve(jar: CookieJar): Promise<{ reserve: ReserveInfo | null; getSToken: string | null }> {
    const res = await this.raw(jar, "curReserve", Q_CURRENT, {});
    // 会话失效/上游故障必须抛错（"无预约"与"没登录"语义不同，保活探测依赖此区分）
    if (res.errors) throw new SeatError(
      res.errors[0]?.extensions?.code, res.errors[0]?.message ?? "查询当前预约失败");
    const r = res.data?.userAuth?.reserve?.reserve ?? null;
    return {
      reserve: r ? {
        token: r.token, status: r.status, libId: r.lib_id, libName: r.lib_name,
        seatKey: r.seat_key, seatName: r.seat_name, expDateStr: r.exp_date_str ?? null,
      } : null,
      getSToken: res.data?.userAuth?.reserve?.getSToken ?? null,
    };
  }

  async layout(jar: CookieJar, libId: number): Promise<any> {
    const res = await this.raw(jar, "libLayout", Q_LAYOUT, { libId, libType: 0 });
    const libs = res.data?.userAuth?.reserve?.libs;
    if (!libs?.length) throw new SeatError(undefined, "libLayout 无数据");
    return libs[0];
  }

  async reserve(jar: CookieJar, libId: number, seatKey: string, captchaCode: string, captcha: string):
    Promise<{ ok: true } | { ok: false; needCaptcha: boolean; message: string }> {
    const res = await this.raw(jar, "reserueSeat", M_RESERVE,
                               { libId, seatKey, captchaCode, captcha });
    if (res.errors) {
      const code = res.errors[0]?.extensions?.code;
      const msg = res.errors[0]?.message ?? "";
      return { ok: false, needCaptcha: code === 1000, message: String(msg) };
    }
    if (res.data?.userAuth?.reserve?.reserueSeat !== true) {
      return { ok: false, needCaptcha: false, message: "选座失败" };
    }
    return { ok: true };
  }

  async cancel(jar: CookieJar, sToken: string): Promise<void> {
    const res = await this.raw(jar, "reserveCancle", M_CANCEL, { sToken });
    if (res.errors) throw new SeatError(String(res.errors[0]?.extensions?.code), "退座失败");
  }

  async reserveCaptcha(jar: CookieJar): Promise<{ code: string; imageData: string }> {
    const res = await this.raw(jar, "captcha", Q_CAPTCHA, {});
    const cap = res.data?.captcha;
    if (!cap?.code) throw new SeatError(undefined, "验证码获取失败");
    return { code: cap.code, imageData: cap.data };
  }
}
