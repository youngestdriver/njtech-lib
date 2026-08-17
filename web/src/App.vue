<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElInput, ElButton, ElTabs, ElTabPane, ElMessage } from "element-plus";
import { login, setToken, getToken, api } from "./api/client.js";
import SeatMap from "./pages/SeatMap.vue";
import Accounts from "./pages/Accounts.vue";
import Current from "./pages/Current.vue";

const authed = ref(!!getToken());
const password = ref("");
const activeId = ref<number | null>(null);
const busy = ref(false);

async function doLogin() {
  busy.value = true;
  try {
    const t = await login(password.value);
    setToken(t); authed.value = true; password.value = "";
    await ensureAccounts();
  } catch (e: any) { ElMessage.error(e.message); }
  finally { busy.value = false; }
}

async function ensureAccounts() {
  const rows = await api.accounts();
  if (!rows.length) { activeId.value = null; return; }
  if (!rows.some(r => r.id === activeId.value)) activeId.value = rows[0].id;
}

// brief 原写法 @need-accounts="/* 提示 */" 会编译出 `$event => (/* 提示 */)`（空括号表达式语法错误），
// 改为真实提示函数（与 brief 注释意图一致）
function onNeedAccounts() { ElMessage.info("请先在「账号管理」添加账号"); }

onMounted(() => {
  if (authed.value) ensureAccounts();
  window.addEventListener("auth-expired", () => {
    authed.value = false; activeId.value = null;
  });
});
defineExpose({ authed, activeId });
</script>

<template>
  <div style="max-width:960px;margin:0 auto;padding:24px">
    <h1 style="margin:0 0 16px">南工大选座助手</h1>
    <div v-if="!authed" style="max-width:360px;margin:80px auto">
      <ElInput v-model="password" type="password" placeholder="访问密码" style="margin-bottom:12px"
               @keyup.enter="doLogin" />
      <ElButton class="login-btn" type="primary" style="width:100%" :loading="busy" @click="doLogin">
        登录
      </ElButton>
    </div>
    <ElTabs v-else type="card">
      <ElTabPane label="座位图">
        <SeatMap v-if="activeId" :account-id="activeId" @need-accounts="onNeedAccounts" />
        <p v-else>请先在「账号管理」添加账号</p>
      </ElTabPane>
      <ElTabPane label="账号管理">
        <Accounts :active-id="activeId ?? 0" @select-account="id => activeId = id" />
      </ElTabPane>
      <ElTabPane label="当前预约">
        <Current v-if="activeId" :account-id="activeId" />
        <p v-else>请先在「账号管理」添加账号</p>
      </ElTabPane>
    </ElTabs>
  </div>
</template>
