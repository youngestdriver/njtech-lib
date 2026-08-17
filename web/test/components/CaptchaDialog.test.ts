import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import CaptchaDialog from "../../src/components/CaptchaDialog.vue";

describe("CaptchaDialog", () => {
  it("显示图片与输入框; 确认 emit confirm(code)", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    await nextTick();
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("data:image/png;base64,AA==");
    await wrapper.find("input").setValue("pk3x");
    await wrapper.find(".confirm-btn").trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toBe("pk3x");
  });

  it("空输入时 confirm 不 emit", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    await nextTick();
    await wrapper.find(".confirm-btn").trigger("click");
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("取消 emit update:modelValue(false)", async () => {
    const wrapper = mount(CaptchaDialog, {
      props: { modelValue: true, imageData: "data:image/png;base64,AA==" },
    });
    await nextTick();
    await wrapper.find(".cancel-btn").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe(false);
  });
});
