<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { ElMessage, ElSelect, ElOption, ElButton, ElEmpty, ElDialog } from "element-plus";
import { api } from "../api/client.js";
import type { SeatMapDto, SeatDto, ReserveResult } from "../api/types.js";
import SeatCanvas from "../components/SeatCanvas.vue";
import CaptchaDialog from "../components/CaptchaDialog.vue";
import { LIBRARIES } from "./library-names.js";

const props = defineProps<{ accountId: number }>();
const emit = defineEmits<{ (e: "need-accounts"): void }>();

const libId = ref(122811);
const map = ref<SeatMapDto | null>(null);
const selected = ref<SeatDto | null>(null);
const captcha = ref<{ imageData: string; captchaToken: string } | null>(null);
const busy = ref(false);
const confirmVisible = ref(false);
// v-model 需要可写的 member expression（brief 原写法 v-model="captcha !== null" 无法编译）
const captchaVisible = computed({
  get: () => captcha.value !== null,
  set: (v: boolean) => { if (!v) captcha.value = null; },
});

async function load() {
  if (!props.accountId) return;
  try {
    map.value = await api.layout(libId.value, props.accountId);
  } catch (e: any) {
    if (e.status === 400) emit("need-accounts");
  }
}

function onSeatClick(seat: SeatDto) {
  selected.value = seat;
  confirmVisible.value = true;
}

function confirmReserve() {
  confirmVisible.value = false;
  doReserve();
}

async function doReserve() {
  if (!selected.value || !props.accountId) return;
  busy.value = true;
  try {
    const r: ReserveResult = await api.reserve(props.accountId, libId.value, selected.value.key);
    if ("ok" in r && r.ok) {
      ElMessage.success(`已选座 ${selected.value.name}`);
      selected.value = null;
      await load();
    } else if ("needCaptcha" in r) {
      captcha.value = { imageData: r.imageData, captchaToken: r.captchaToken };
    } else {
      ElMessage.error(r.message);
    }
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally { busy.value = false; }
}

async function submitCaptcha(code: string) {
  if (!captcha.value || !selected.value) return;
  const r = await api.reserveCaptcha(props.accountId, libId.value, selected.value.key,
                                     captcha.value.captchaToken, code);
  captcha.value = null;
  if ("ok" in r && r.ok) { ElMessage.success("选座成功"); selected.value = null; await load(); }
  else if ("needCaptcha" in r) { captcha.value = { imageData: r.imageData, captchaToken: r.captchaToken }; }
  else ElMessage.error(r.message);
}

onMounted(load);
watch(() => props.accountId, () => { selected.value = null; load(); });
watch(libId, () => { selected.value = null; load(); });
defineExpose({ doReserve, submitCaptcha });
</script>

<template>
  <div>
    <div class="toolbar" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
      <ElSelect v-model="libId" style="width:180px">
        <ElOption v-for="l in LIBRARIES" :key="l.id" :label="l.name" :value="l.id" />
      </ElSelect>
      <ElButton @click="load">刷新</ElButton>
      <span v-if="map" class="stats">
        总 {{ map.seatsTotal }} · 占用 {{ map.seatsUsed }} · 预约 {{ map.seatsBooking }}
      </span>
    </div>
    <SeatCanvas v-if="map" :map="map" @click-seat="onSeatClick" />
    <ElEmpty v-else-if="!props.accountId" description="请先在账号管理添加账号"
             @click="emit('need-accounts')" />
    <!-- 自绘确认弹窗（预检裁决：不用 ElMessageBox，避免 stub element-plus 内部） -->
    <ElDialog v-model="confirmVisible" title="确认选座" width="320px">
      <span>选择座位 {{ selected?.name ?? selected?.key }}？</span>
      <template #footer>
        <ElButton @click="confirmVisible = false">取消</ElButton>
        <ElButton class="confirm-seat-btn" type="primary" @click="confirmReserve">确认</ElButton>
      </template>
    </ElDialog>
    <CaptchaDialog v-model="captchaVisible" :image-data="captcha?.imageData ?? ''"
                   title="选座验证码" @confirm="submitCaptcha" />
  </div>
</template>
