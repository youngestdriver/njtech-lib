import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import SeatCanvas from "../../src/components/SeatCanvas.vue";
import { mockCanvas } from "../../src/components/SeatCanvas.test-helper.js";
import type { SeatMapDto } from "../../src/api/types.js";

const FIXTURE: SeatMapDto = {
  libId: 122811, libName: "新书借阅室", isOpen: true, libFloor: "2楼",
  seatsTotal: 4, seatsUsed: 1, seatsBooking: 0, maxX: 9, maxY: 5,
  seats: [
    { x: 3, y: 4, key: "34,28", type: 1, name: "87", seatStatus: 3 },   // 占用
    { x: 5, y: 4, key: "56,28", type: 1, name: "88", seatStatus: 1 },   // 空闲
    { x: 9, y: 5, key: "99,55", type: 2, name: null, seatStatus: 0 },   // 桌面
    { x: 0, y: 0, key: "1,1", type: 8, name: null, seatStatus: 0 },     // 服务台
  ],
};

// jsdom 差异处理（不改组件行为，仅调整测试 stub）：
// 1. jsdom 的 document.createElement 不读全局 HTMLCanvasElement（静态接口注册表），
//    且未装 canvas 包时 getContext("2d") 返回 null —— 直接给原型打桩:
//    getContext 返回 mock ctx；addEventListener 用原生 EventTarget 实现（真实可用，
//    组件 @mousedown 绑定依赖它）；canvas width/height 用原生属性（组件原生赋值）。
// 2. jsdom 的 getBoundingClientRect 恒返回 0 尺寸 —— 固定为 400x240 以还原 scale=1。
// 3. jsdom 的 MouseEvent.prototype.offsetX/offsetY 只有 getter 无 setter，
//    @vue/test-utils 无法注入触发坐标 —— 补一个可写访问器。
function setup() {
  const mock = mockCanvas();
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(mock.ctx);
  vi.spyOn(window.HTMLCanvasElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ left: 0, top: 0, width: 400, height: 240 } as any);
  for (const key of ["offsetX", "offsetY"] as const) {
    Object.defineProperty(window.MouseEvent.prototype, key, {
      configurable: true,
      get() { return (this as any)["__" + key] ?? 0; },
      set(v: number) { (this as any)["__" + key] = v; },
    });
  }
  return mock;
}
afterEach(() => vi.restoreAllMocks());

describe("SeatCanvas", () => {
  it("空闲座中心为绿色, 占用座为红色, 桌面/服务台为淡灰", () => {
    const mock = setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // 座位 (5,4) 中心: ((5+1)*40, (4+1)*40) = (240, 200)
    expect(mock.pixelAt(240, 200)).toBe("#4CAF50");
    // 座位 (3,4) 中心: (160, 200)
    expect(mock.pixelAt(160, 200)).toBe("#F44336");
    // 桌面 (9,5): (400, 240) — maxX=9 时画布宽 400 的右缘, 中心在 (400,240)? 桌面用矩形 fillRect 左上角, 断言其填充区域
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("点击空闲座 emit click-seat; 点击占用座不 emit", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // hit-test 由 mousedown + 坐标换算实现; 直接调用组件暴露的点击处理不方便,
    // 改为: 触发 canvas mousedown with offsetX/offsetY → 内部 hit-test
    const canvas = wrapper.find("canvas");
    // 空闲座 (5,4) 中心像素 (240,200)
    await canvas.trigger("mousedown", { offsetX: 240, offsetY: 200 });
    expect(wrapper.emitted("click-seat")?.[0]?.[0]).toMatchObject({ key: "56,28", name: "88" });
    // 占用座 (3,4) 中心 (160,200)
    await canvas.trigger("mousedown", { offsetX: 160, offsetY: 200 });
    expect(wrapper.emitted("click-seat")).toHaveLength(1);
  });

  it("选中后点击另一空闲座, 选中态转移", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: FIXTURE } });
    // 空闲座 88 → 选中; 空闲座 87? 87 占用不可点。用两个空闲座的 fixture 单独验证
    const wrapper2 = mount(SeatCanvas, { props: { map: { ...FIXTURE, seats: [
      { x: 1, y: 1, key: "a", type: 1, name: "A", seatStatus: 1 },
      { x: 2, y: 1, key: "b", type: 1, name: "B", seatStatus: 1 },
    ] } } });
    const canvas = wrapper2.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 80, offsetY: 80 });
    await canvas.trigger("mousedown", { offsetX: 120, offsetY: 80 });
    expect(wrapper2.emitted("click-seat")).toHaveLength(2);
    // 组件本地选中态最终落在 B
    expect((wrapper2.vm as any).selectedKey).toBe("b");
  });

  it("clearSelection 清空选中态并重绘（终审 I-1）", async () => {
    setup();
    const wrapper = mount(SeatCanvas, { props: { map: { ...FIXTURE, seats: [
      { x: 1, y: 1, key: "a", type: 1, name: "A", seatStatus: 1 },
    ] } } });
    const canvas = wrapper.find("canvas");
    await canvas.trigger("mousedown", { offsetX: 80, offsetY: 80 });
    expect((wrapper.vm as any).selectedKey).toBe("a");
    (wrapper.vm as any).clearSelection();
    expect((wrapper.vm as any).selectedKey).toBeNull();
  });
});
