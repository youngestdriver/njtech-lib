<script setup lang="ts">
import { ref, watch } from "vue";
import { ElDialog, ElInput, ElButton } from "element-plus";

const props = defineProps<{ modelValue: boolean; imageData: string; title?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "confirm", code: string): void;
}>();

const code = ref("");
watch(() => props.modelValue, v => { if (v) code.value = ""; });

function confirm() {
  if (!code.value) return;
  emit("confirm", code.value);
}
</script>

<template>
  <ElDialog :model-value="modelValue" :title="title ?? '输入验证码'"
            width="320px" @update:model-value="emit('update:modelValue', $event)">
    <img :src="imageData" alt="验证码" style="display:block;margin:0 auto 16px" />
    <ElInput v-model="code" placeholder="请输入验证码" @keyup.enter="confirm" />
    <template #footer>
      <ElButton class="cancel-btn" @click="emit('update:modelValue', false)">取消</ElButton>
      <ElButton class="confirm-btn" type="primary" @click="confirm">确认</ElButton>
    </template>
  </ElDialog>
</template>
