import { vi } from "vitest";

export interface CanvasMock {
  ctx: any;
  calls: { type: string; args: any[] }[];
  /** 读取画布 (x,y) 处颜色: 返回最后填充该像素的 fillStyle 的十六进制值 */
  pixelAt: (x: number, y: number) => string | null;
}

export function mockCanvas(): CanvasMock {
  const calls: { type: string; args: any[] }[] = [];
  const filled: Record<string, string> = {};
  // 圆座位用 arc+fill 绘制（fillRect 只用于桌面/服务台矩形），
  // 记录 arc 参数，fill() 时把圆内像素写入 filled 以便 pixelAt 断言
  let arcState: { cx: number; cy: number; r: number } | null = null;
  const ctx = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      for (let py = Math.floor(y); py < Math.floor(y + h); py++)
        for (let px = Math.floor(x); px < Math.floor(x + w); px++)
          filled[`${px},${py}`] = ctx.fillStyle;
    }),
    beginPath: vi.fn(),
    arc: vi.fn((cx: number, cy: number, r: number) => {
      arcState = { cx, cy, r };
    }),
    fill: vi.fn(() => {
      if (arcState) {
        const { cx, cy, r } = arcState;
        for (let py = Math.ceil(cy - r); py <= Math.floor(cy + r); py++)
          for (let px = Math.ceil(cx - r); px <= Math.floor(cx + r); px++)
            if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r)
              filled[`${px},${py}`] = ctx.fillStyle;
        arcState = null;
      }
    }),
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
  const proxy: any = new Proxy(ctx, {
    get(t, p) {
      if (typeof p === "string" && typeof (t as any)[p] === "function") {
        return (...args: any[]) => {
          calls.push({ type: p, args });
          return (t as any)[p](...args);
        };
      }
      return (t as any)[p];
    },
  });
  return {
    ctx: proxy,
    calls,
    pixelAt: (x, y) => filled[`${x},${y}`] ?? null,
  };
}
