<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

// 过滤项类型
interface FilterItem {
  text: string;
  isRegexp: boolean;
}

const state = reactive({
  manualBlockedUsernames: [] as FilterItem[],
  manualWhitelistUsernames: [] as string[],
  isFilterEnabled: true,
  currentTab: "manual" as "manual" | "whitelist",
  whitelistInput: "",
  systemUsernameCount: 0,
  isRefreshing: false,
  searchText: "",
  usernameForm: {
    isRegexp: false,
    text: "",
    tags: [] as string[]
  },
  selectedManualUsernames: [] as FilterItem[],
  selectedWhitelistUsernames: [] as string[]
});

// 过滤后的数据
const filteredManualUsernames = computed(() => {
  if (!state.searchText) return state.manualBlockedUsernames;
  return state.manualBlockedUsernames.filter((item) => item.text.toLowerCase().includes(state.searchText.toLowerCase()));
});

const filteredWhitelistUsernames = computed(() => {
  if (!state.searchText) return state.manualWhitelistUsernames;
  return state.manualWhitelistUsernames.filter((name) => name.toLowerCase().includes(state.searchText.toLowerCase()));
});

/**
 * 加载数据
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get(["manualBlockedUsernames", "manualWhitelistUsernames", "isEnabled", "wasmHandleCount"]);

    const rawUsernames = Array.isArray(result.manualBlockedUsernames)
      ? result.manualBlockedUsernames
      : Object.values(result.manualBlockedUsernames || {});

    state.manualBlockedUsernames = rawUsernames.map((item: any) => {
      if (typeof item === 'string') {
        return { text: item, isRegexp: false };
      }
      return item as FilterItem;
    });

    state.manualWhitelistUsernames = Array.isArray(result.manualWhitelistUsernames)
      ? result.manualWhitelistUsernames
      : Object.values(result.manualWhitelistUsernames || {});

    state.isFilterEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
    state.systemUsernameCount = result.wasmHandleCount || 0;
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
 * 添加用户名
 */
async function addUsername() {
  let username = "";

  if (state.usernameForm.isRegexp) {
    username = state.usernameForm.text.trim();
    if (!username) {
      ElMessage.warning("正则表达式不能为空");
      return;
    }
    try {
      new RegExp(username);
    } catch (e) {
      ElMessage.error("正则表达式格式错误");
      return;
    }
  } else {
    if (state.usernameForm.tags.length === 0) {
      ElMessage.warning("用户名不能为空");
      return;
    }
    username = state.usernameForm.tags.join(',');
  }

  if (state.manualBlockedUsernames.some(item => item.text === username && item.isRegexp === state.usernameForm.isRegexp)) {
    ElMessage.warning("用户名已存在");
    return;
  }

  try {
    const newItem: FilterItem = {
      text: username,
      isRegexp: state.usernameForm.isRegexp
    };
    const newList = [...state.manualBlockedUsernames, newItem];

    await chrome.storage.local.set({ manualBlockedUsernames: newList });

    state.manualBlockedUsernames = newList;
    state.usernameForm.text = "";
    state.usernameForm.tags = [];
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加用户名失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 添加白名单用户名
 */
async function addWhitelist() {
  const username = state.whitelistInput.trim();
  if (!username) {
    ElMessage.warning("用户名不能为空");
    return;
  }

  if (state.manualWhitelistUsernames.includes(username)) {
    ElMessage.warning("用户名已存在");
    return;
  }

  try {
    const newList = [...state.manualWhitelistUsernames, username];
    await chrome.storage.local.set({ manualWhitelistUsernames: newList });
    state.manualWhitelistUsernames = newList;
    state.whitelistInput = "";
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加白名单用户名失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 移除用户名
 */
async function removeUsername(item: FilterItem | string, type: "manual" | "whitelist") {
  try {
    const displayText = typeof item === 'string' ? item : item.text;
    await ElMessageBox.confirm(`确定要移除用户名 "${displayText}" 吗？`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });

    if (type === "manual") {
      const filterItem = item as FilterItem;
      const newManualList = state.manualBlockedUsernames.filter((k) =>
        k.text !== filterItem.text || k.isRegexp !== filterItem.isRegexp
      );

      await chrome.storage.local.set({ manualBlockedUsernames: newManualList });
      state.manualBlockedUsernames = newManualList;
    } else {
      const username = item as string;
      const newList = state.manualWhitelistUsernames.filter((n) => n !== username);
      await chrome.storage.local.set({ manualWhitelistUsernames: newList });
      state.manualWhitelistUsernames = newList;
    }

    ElMessage.success("移除成功");
  } catch (error) {
    if (error !== "cancel") {
      console.error("[推文过滤器] 移除用户名失败:", error);
      ElMessage.error("移除失败");
    }
  }
}

/**
 * 批量移除用户名
 */
async function batchRemoveUsernames(type: "manual" | "whitelist") {
  if (type === "manual") {
    if (state.selectedManualUsernames.length === 0) {
      ElMessage.warning("请先选择要移除的用户名");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedManualUsernames.length} 个用户名吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualBlockedUsernames.filter((k) =>
        !state.selectedManualUsernames.some(s => s.text === k.text && s.isRegexp === k.isRegexp)
      );

      await chrome.storage.local.set({ manualBlockedUsernames: newList });
      state.manualBlockedUsernames = newList;
      state.selectedManualUsernames = [];
      ElMessage.success("批量移除成功");
    } catch (error) {
      if (error !== "cancel") {
        console.error("[推文过滤器] 批量移除失败:", error);
        ElMessage.error("批量移除失败");
      }
    }
  } else {
    if (state.selectedWhitelistUsernames.length === 0) {
      ElMessage.warning("请先选择要移除的用户名");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedWhitelistUsernames.length} 个用户名吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualWhitelistUsernames.filter((k) =>
        !state.selectedWhitelistUsernames.includes(k)
      );

      await chrome.storage.local.set({ manualWhitelistUsernames: newList });
      state.manualWhitelistUsernames = newList;
      state.selectedWhitelistUsernames = [];
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
    if (areaName === "local" && changes.serverUsernames) {
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
      <el-input v-model="state.searchText" placeholder="搜索用户名..." clearable class="max-w-400px" />
      <div class="flex items-center gap-4">
        <el-switch v-model="state.isFilterEnabled" @change="toggleFilterEnabled" active-text="已启用" inactive-text="已禁用" />
        <el-button :loading="state.isRefreshing" @click="handleRefresh" size="small">刷新</el-button>
      </div>
    </div>

    <!-- 智能识别提示 -->
    <div class="px-6 py-3 mb-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
      <p class="text-sm text-gray-400">
        6551智能识别 <span class="text-[#409eff] font-semibold">{{ state.systemUsernameCount }}</span> 个用户名
      </p>
    </div>

    <!-- Tabs -->
    <el-tabs type="border-card" v-model="state.currentTab" class="flex-1 flex flex-col overflow-hidden">
      <el-tab-pane label="手动过滤" name="manual">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加用户名输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <div class="flex items-center gap-4">
              <el-checkbox v-model="state.usernameForm.isRegexp" class="mr-4">正则表达式</el-checkbox>
              <template v-if="state.usernameForm.isRegexp">
                <el-input
                  v-model="state.usernameForm.text"
                  placeholder="输入正则表达式..."
                  @keyup.enter="addUsername"
                  class="flex-1"
                />
              </template>
              <template v-else>
                <el-input-tag
                  v-model="state.usernameForm.tags"
                  placeholder="输入用户名后按回车"
                  class="flex-1"
                />
              </template>
              <el-button type="primary" @click="addUsername">添加</el-button>
            </div>
            <p class="text-xs text-gray-500 mt-2" v-if="!state.usernameForm.isRegexp">
              提示：多个用户名关键词需要同时命中才会过滤
            </p>
          </div>

          <el-empty v-if="filteredManualUsernames.length === 0" description="暂无手动过滤用户名" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredManualUsernames.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedManualUsernames.length === 0"
                @click="batchRemoveUsernames('manual')"
              >
                批量移除 ({{ state.selectedManualUsernames.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredManualUsernames"
              class="flex-1"
              height="100%"
              @selection-change="(val: FilterItem[]) => state.selectedManualUsernames = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="用户名">
                <template #default="{ row }">
                  <div class="flex items-center gap-2">
                    <el-tag v-if="row.isRegexp" type="warning" size="small">正则</el-tag>
                    <el-tag type="success" effect="dark">{{ row.text }}</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeUsername(row, 'manual')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>

      <el-tab-pane label="白名单" name="whitelist">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加白名单用户名输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <el-input v-model="state.whitelistInput" placeholder="输入要加入白名单的用户名..." @keyup.enter="addWhitelist" class="max-w-400px">
              <template #append>
                <el-button type="primary" @click="addWhitelist">添加</el-button>
              </template>
            </el-input>
          </div>

          <el-empty v-if="filteredWhitelistUsernames.length === 0" description="暂无白名单用户名" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredWhitelistUsernames.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedWhitelistUsernames.length === 0"
                @click="batchRemoveUsernames('whitelist')"
              >
                批量移除 ({{ state.selectedWhitelistUsernames.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredWhitelistUsernames"
              class="flex-1"
              height="100%"
              @selection-change="(val: string[]) => state.selectedWhitelistUsernames = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="用户名">
                <template #default="{ row }">
                  <el-tag type="info" effect="dark">{{ row }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeUsername(row, 'whitelist')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
