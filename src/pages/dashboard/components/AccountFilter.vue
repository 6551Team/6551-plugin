<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const state = reactive({
  manualBlockedAccounts: [] as string[],
  manualWhitelistAccounts: [] as string[],
  isFilterEnabled: true,
  currentTab: "manual" as "manual" | "whitelist",
  systemAccountCount: 0,
  accountInput: "",
  whitelistInput: "",
  isRefreshing: false,
  searchText: "",
  selectedManualAccounts: [] as string[],
  selectedWhitelistAccounts: [] as string[]
});

// 过滤后的数据
const filteredManualAccounts = computed(() => {
  if (!state.searchText) return state.manualBlockedAccounts;
  return state.manualBlockedAccounts.filter((acc) => acc.toLowerCase().includes(state.searchText.toLowerCase()));
});

const filteredWhitelistAccounts = computed(() => {
  if (!state.searchText) return state.manualWhitelistAccounts;
  return state.manualWhitelistAccounts.filter((acc) => acc.toLowerCase().includes(state.searchText.toLowerCase()));
});

/**
 * 加载数据
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get(["manualBlockedAccounts", "manualWhitelistAccounts", "isEnabled", "wasmAccountCount"]);

    state.manualBlockedAccounts = Array.isArray(result.manualBlockedAccounts)
      ? result.manualBlockedAccounts
      : Object.values(result.manualBlockedAccounts || {});

    state.manualWhitelistAccounts = Array.isArray(result.manualWhitelistAccounts)
      ? result.manualWhitelistAccounts
      : Object.values(result.manualWhitelistAccounts || {});

    state.isFilterEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
    state.systemAccountCount = result.wasmAccountCount || 0;
  } catch (error) {
    console.error("[推文过滤器] 加载数据失败:", error);
  }
}

/**
 * 切换过滤启用状态
 */
async function toggleFilterEnabled(value: boolean) {
  try {
    await chrome.storage.local.set({ isEnabled: value });
    console.log(`[推文过滤器] 过滤功能已${value ? "启用" : "禁用"}`);
    ElMessage.success(`过滤功能已${value ? "启用" : "禁用"}`);
  } catch (error) {
    console.error("[推文过滤器] 更新状态失败:", error);
    ElMessage.error("更新状态失败");
  }
}

/**
 * 添加账号
 */
async function addAccount() {
  const account = state.accountInput.trim();
  if (!account) {
    ElMessage.warning("账号不能为空");
    return;
  }

  if (state.manualBlockedAccounts.includes(account)) {
    ElMessage.warning("账号已存在");
    return;
  }

  try {
    const newList = [...state.manualBlockedAccounts, account];
    await chrome.storage.local.set({ manualBlockedAccounts: newList });
    state.manualBlockedAccounts = newList;
    state.accountInput = "";
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加账号失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 添加白名单账号
 */
async function addWhitelist() {
  const account = state.whitelistInput.trim();
  if (!account) {
    ElMessage.warning("账号不能为空");
    return;
  }

  if (state.manualWhitelistAccounts.includes(account)) {
    ElMessage.warning("账号已存在");
    return;
  }

  try {
    const newList = [...state.manualWhitelistAccounts, account];
    await chrome.storage.local.set({ manualWhitelistAccounts: newList });
    state.manualWhitelistAccounts = newList;
    state.whitelistInput = "";
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加白名单账号失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 移除账号
 */
async function removeAccount(account: string, type: "manual" | "whitelist") {
  try {
    await ElMessageBox.confirm(`确定要移除 ${account} 吗？`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });

    if (type === "manual") {
      const newList = state.manualBlockedAccounts.filter((acc) => acc !== account);
      await chrome.storage.local.set({ manualBlockedAccounts: newList });
      state.manualBlockedAccounts = newList;
    } else {
      const newList = state.manualWhitelistAccounts.filter((acc) => acc !== account);
      await chrome.storage.local.set({ manualWhitelistAccounts: newList });
      state.manualWhitelistAccounts = newList;
    }

    ElMessage.success("移除成功");
  } catch (error) {
    if (error !== "cancel") {
      console.error("[推文过滤器] 移除账号失败:", error);
      ElMessage.error("移除失败");
    }
  }
}

/**
 * 批量移除账号
 */
async function batchRemoveAccounts(type: "manual" | "whitelist") {
  if (type === "manual") {
    if (state.selectedManualAccounts.length === 0) {
      ElMessage.warning("请先选择要移除的账号");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedManualAccounts.length} 个账号吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualBlockedAccounts.filter((acc) =>
        !state.selectedManualAccounts.includes(acc)
      );

      await chrome.storage.local.set({ manualBlockedAccounts: newList });
      state.manualBlockedAccounts = newList;
      state.selectedManualAccounts = [];
      ElMessage.success("批量移除成功");
    } catch (error) {
      if (error !== "cancel") {
        console.error("[推文过滤器] 批量移除失败:", error);
        ElMessage.error("批量移除失败");
      }
    }
  } else {
    if (state.selectedWhitelistAccounts.length === 0) {
      ElMessage.warning("请先选择要移除的账号");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedWhitelistAccounts.length} 个账号吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualWhitelistAccounts.filter((acc) =>
        !state.selectedWhitelistAccounts.includes(acc)
      );

      await chrome.storage.local.set({ manualWhitelistAccounts: newList });
      state.manualWhitelistAccounts = newList;
      state.selectedWhitelistAccounts = [];
      ElMessage.success("批量移除成功");
    } catch (error) {
      if (error !== "cancel") {
        console.error("[推文过滤器] 批量移除失败:", error);
        ElMessage.error("批量移除失败");
      }
    }
  }
}

/**
 * 打开 X 账号页面
 */
function openXAccount(account: string) {
  const username = account.startsWith("@") ? account.slice(1) : account;
  window.open(`https://x.com/${username}`, "_blank");
}

/**
 * 手动刷新数据
 */
async function handleRefresh() {
  if (state.isRefreshing) return;

  state.isRefreshing = true;
  try {
    await chrome.runtime.sendMessage({ type: 'MANUAL_UPDATE' });
    await loadData();
    ElMessage.success('数据刷新成功');
  } catch (error) {
    console.error('[推文过滤器] 刷新失败:', error);
    ElMessage.error('刷新失败');
  } finally {
    state.isRefreshing = false;
  }
}

/**
 * 监听存储变化
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.filterAccounts || changes.lastUpdateTime)) {
      loadData();
    }
  });
}

onMounted(() => {
  loadData();
  setupStorageListener();
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-[#1a1a1a]">
    <!-- 顶部工具栏 -->
    <div class="px-6 py-4 mb-4 border-b border-[#2a2a2a] flex justify-between items-center bg-[#0d0d0d]">
      <el-input v-model="state.searchText" placeholder="搜索账号..." clearable class="max-w-400px" />
      <div class="flex items-center gap-4">
        <el-switch v-model="state.isFilterEnabled" @change="toggleFilterEnabled" active-text="已启用" inactive-text="已禁用" />
        <el-button :loading="state.isRefreshing" @click="handleRefresh" size="small">刷新</el-button>
      </div>
    </div>

    <!-- 智能识别提示 -->
    <div class="px-6 py-3 mb-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
      <p class="text-sm text-gray-400">
        NewsLiquid 在线识别 <span class="text-[#6d55e7] font-semibold">{{ state.systemAccountCount }}</span> 个账号
      </p>
    </div>

    <!-- Tabs -->
    <el-tabs type="border-card" v-model="state.currentTab" class="flex-1 flex flex-col overflow-hidden">
      <el-tab-pane label="手动过滤" name="manual">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加账号输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <el-input v-model="state.accountInput" placeholder="输入要过滤的账号..." @keyup.enter="addAccount" class="max-w-400px">
              <template #append>
                <el-button type="primary" @click="addAccount">添加</el-button>
              </template>
            </el-input>
          </div>

          <el-empty v-if="filteredManualAccounts.length === 0" description="暂无手动过滤账号" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredManualAccounts.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedManualAccounts.length === 0"
                @click="batchRemoveAccounts('manual')"
              >
                批量移除 ({{ state.selectedManualAccounts.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredManualAccounts"
              class="flex-1"
              height="100%"
              @selection-change="(val: string[]) => state.selectedManualAccounts = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="账号">
                <template #default="{ row }">
                  <span class="text-[#67c23a] cursor-pointer hover:text-[#85ce61]" @click="openXAccount(row)">
                    {{ row.startsWith("@") ? row : "@" + row }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeAccount(row, 'manual')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>

      <el-tab-pane label="白名单" name="whitelist">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加白名单账号输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <el-input v-model="state.whitelistInput" placeholder="输入要加入白名单的账号..." @keyup.enter="addWhitelist" class="max-w-400px">
              <template #append>
                <el-button type="primary" @click="addWhitelist">添加</el-button>
              </template>
            </el-input>
          </div>

          <el-empty v-if="filteredWhitelistAccounts.length === 0" description="暂无白名单账号" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredWhitelistAccounts.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedWhitelistAccounts.length === 0"
                @click="batchRemoveAccounts('whitelist')"
              >
                批量移除 ({{ state.selectedWhitelistAccounts.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredWhitelistAccounts"
              class="flex-1"
              height="100%"
              @selection-change="(val: string[]) => state.selectedWhitelistAccounts = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="账号">
                <template #default="{ row }">
                  <span class="text-[#67c23a] cursor-pointer hover:text-[#85ce61]" @click="openXAccount(row)">
                    {{ row.startsWith("@") ? row : "@" + row }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeAccount(row, 'whitelist')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
