<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ElMessage, ElTable, ElTableColumn, ElTag, ElButton, ElInput, ElForm, ElFormItem, ElTooltip } from "element-plus";
import { api } from "../api/client.js";
import type { AccountRow } from "../api/types.js";
import CaptchaDialog from "../components/CaptchaDialog.vue";

const props = defineProps<{ activeId: number }>();
const emit = defineEmits<{ (e: "select-account", id: number): void }>();

const rows = ref<AccountRow[]>([]);
const addForm = ref({ username: "", password: "", alias: "" });
const captchaFor = ref<AccountRow | null>(null);
const captchaImage = ref("");
const busy = ref(false);

async function load() {
  try { rows.value = await api.accounts(); }
  catch (e: any) { ElMessage.error(e.message); }
}

const STATUS_MAP: Record<string, { label: string; type: "success" | "warning" | "danger" | "info" }> = {
  active: { label: "正常", type: "success" },
  "needs-captcha": { label: "需验证码", type: "warning" },
  failed: { label: "失败", type: "danger" },
  pending: { label: "等待中", type: "info" },
};

async function add() {
  if (!addForm.value.username || !addForm.value.password) { ElMessage.warning("学号与密码必填"); return; }
  busy.value = true;
  try {
    await api.addAccount(addForm.value.username, addForm.value.password, addForm.value.alias || undefined);
    ElMessage.success("账号已添加");
    addForm.value = { username: "", password: "", alias: "" };
    await load();
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

// Task 7 顺手修复（评审标注 Minor）：reauth/remove 补 try/catch，失败不再 unhandled rejection
async function reauth(id: number) {
  try {
    await api.reauth(id); ElMessage.success("已触发重登"); await load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function openRecover(row: AccountRow) {
  busy.value = true;
  try {
    const r = await api.loginCaptchaImage(row.id);
    captchaImage.value = r.imageData;
    captchaFor.value = row;
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}
async function submitCaptcha(code: string) {
  if (!captchaFor.value) return;
  try {
    await api.loginCaptcha(captchaFor.value.id, code);
    ElMessage.success("验证码登录成功"); captchaFor.value = null; await load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function remove(row: AccountRow) {
  if (!window.confirm(`删除账号 ${row.alias ?? row.username}？`)) return;
  try {
    await api.removeAccount(row.id); ElMessage.success("已删除");
    // 终审推荐项: 删除的是当前选中账号时通知 App 重置 activeId（选中态失效）
    if (row.id === props.activeId) emit("select-account", 0);
    await load();
  } catch (e: any) { ElMessage.error(e.message); }
}

onMounted(load);
// v-model 需要可写的 member expression（brief 原写法 v-model="captchaFor !== null" 无法编译，
// 与 SeatMap 的 captchaVisible 同一处理方式）
const captchaVisible = computed({
  get: () => captchaFor.value !== null,
  set: (v: boolean) => { if (!v) { captchaFor.value = null; captchaImage.value = ""; } },
});
defineExpose({ addForm, captchaFor });
</script>

<template>
  <div>
    <ElTable :data="rows" style="margin-bottom:16px" @row-click="r => emit('select-account', r.id)">
      <ElTableColumn label="别名" width="140">
        <template #default="{ row }">{{ row.alias ?? row.username }}</template>
      </ElTableColumn>
      <ElTableColumn prop="username" label="学号" width="140" />
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag :type="STATUS_MAP[row.status].type">{{ STATUS_MAP[row.status].label }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近保活">
        <template #default="{ row }">
          {{ row.lastOkAt ? new Date(row.lastOkAt).toLocaleString() : "-" }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近错误">
        <template #default="{ row }">
          <ElTooltip v-if="row.lastError" :content="row.lastError"><span style="color:#E6A23C">{{ row.lastError.slice(0, 20) }}{{ row.lastError.length > 20 ? "…" : "" }}</span></ElTooltip>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="260">
        <template #default="{ row }">
          <!-- 两个通道都提供: channel 被风控(403)时表单登录是唯一可用路径 -->
          <ElButton size="small" type="warning" @click.stop="openRecover(row as AccountRow)">验证码恢复</ElButton>
          <ElButton v-if="row.status !== 'needs-captcha'" size="small"
                    @click.stop="reauth(row.id)">重登</ElButton>
          <ElButton size="small" type="danger" @click.stop="remove(row as AccountRow)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElForm inline>
      <ElFormItem><ElInput v-model="addForm.username" placeholder="学号" style="width:160px" /></ElFormItem>
      <ElFormItem><ElInput v-model="addForm.password" placeholder="密码" type="password" show-password style="width:160px" /></ElFormItem>
      <ElFormItem><ElInput v-model="addForm.alias" placeholder="别名" style="width:120px" /></ElFormItem>
      <ElFormItem><ElButton class="add-btn" type="primary" :loading="busy" @click="add">添加账号</ElButton></ElFormItem>
    </ElForm>

    <CaptchaDialog v-model="captchaVisible" :image-data="captchaImage"
                   title="CAS 验证码登录" @confirm="submitCaptcha" />
  </div>
</template>
