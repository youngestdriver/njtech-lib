<script setup lang="ts">
import { ref, watch } from "vue";
import { ElButton, ElMessage, ElEmpty, ElDescriptions, ElDescriptionsItem } from "element-plus";
import { api } from "../api/client.js";
import type { CurrentReserve } from "../api/types.js";

const props = defineProps<{ accountId: number }>();
const data = ref<CurrentReserve | null>(null);
const busy = ref(false);

async function load() {
  if (!props.accountId) return;
  data.value = await api.current(props.accountId);
}

async function cancel() {
  if (!window.confirm("确定退座？")) return;
  busy.value = true;
  try {
    const r = await api.cancel(props.accountId);
    if ("ok" in r && r.ok) { ElMessage.success("退座成功"); await load(); }
    // brief 原文 `else ElMessage.error(r.message)` 过不了 strict TS（else 分支还含无 message 的
    // needCaptcha 成员），补一层 needCaptcha 分支收窄（与 SeatMap.vue 同一处理方式）
    else if ("needCaptcha" in r) { ElMessage.error("退座需要验证码，请先处理账号验证码"); }
    else ElMessage.error(r.message);
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

watch(() => props.accountId, load, { immediate: true });
defineExpose({ data });
</script>

<template>
  <div>
    <ElButton style="margin-bottom:12px" @click="load">查询</ElButton>
    <ElDescriptions v-if="data?.reserve" :column="2" border style="max-width:560px">
      <ElDescriptionsItem label="图书馆">{{ data.reserve.libName }}</ElDescriptionsItem>
      <ElDescriptionsItem label="座位号">{{ data.reserve.seatName }}</ElDescriptionsItem>
      <ElDescriptionsItem label="到期时间">{{ data.reserve.expDateStr ?? "-" }}</ElDescriptionsItem>
      <ElDescriptionsItem label="状态">{{ data.reserve.status === 3 ? "使用中" : "状态 " + data.reserve.status }}</ElDescriptionsItem>
    </ElDescriptions>
    <div v-if="data?.reserve" style="margin-top:16px">
      <ElButton class="cancel-btn" type="danger" :loading="busy" @click="cancel">退座</ElButton>
    </div>
    <ElEmpty v-else description="暂无预约" />
  </div>
</template>
