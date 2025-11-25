<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

// 过滤项类型
interface FilterItem {
  text: string;
  isRegexp: boolean;
}

const state = reactive({
  manualBlockedKeywords: [] as FilterItem[],
  manualWhitelistKeywords: [] as string[],
  isFilterEnabled: true,
  currentTab: "manual" as "manual" | "whitelist",
  whitelistInput: "",
  systemKeywordCount: 0,
  isRefreshing: false,
  searchText: "",
  keywordForm: {
    isRegexp: false,
    text: "",
    tags: [] as string[]
  },
  selectedManualKeywords: [] as FilterItem[],
  selectedWhitelistKeywords: [] as string[]
});

// 过滤后的数据
const filteredManualKeywords = computed(() => {
  if (!state.searchText) return state.manualBlockedKeywords;
  return state.manualBlockedKeywords.filter((item) => item.text.toLowerCase().includes(state.searchText.toLowerCase()));
});

const filteredWhitelistKeywords = computed(() => {
  if (!state.searchText) return state.manualWhitelistKeywords;
  return state.manualWhitelistKeywords.filter((kw) => kw.toLowerCase().includes(state.searchText.toLowerCase()));
});

/**
 * 加载数据
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get(["manualBlockedKeywords", "manualWhitelistKeywords", "isEnabled", "wasmKeywordCount"]);

    const rawKeywords = Array.isArray(result.manualBlockedKeywords)
      ? result.manualBlockedKeywords
      : Object.values(result.manualBlockedKeywords || {});

    state.manualBlockedKeywords = rawKeywords.map((item: any) => {
      if (typeof item === 'string') {
        return { text: item, isRegexp: false };
      }
      return item as FilterItem;
    });

    state.manualWhitelistKeywords = Array.isArray(result.manualWhitelistKeywords)
      ? result.manualWhitelistKeywords
      : Object.values(result.manualWhitelistKeywords || {});

    state.isFilterEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
    state.systemKeywordCount = result.wasmKeywordCount || 0;
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
 * 添加关键词
 */
async function addKeyword() {
  let keyword = "";

  if (state.keywordForm.isRegexp) {
    keyword = state.keywordForm.text.trim();
    if (!keyword) {
      ElMessage.warning("正则表达式不能为空");
      return;
    }
    try {
      new RegExp(keyword);
    } catch (e) {
      ElMessage.error("正则表达式格式错误");
      return;
    }
  } else {
    if (state.keywordForm.tags.length === 0) {
      ElMessage.warning("关键词不能为空");
      return;
    }
    keyword = state.keywordForm.tags.join(',');
  }

  if (state.manualBlockedKeywords.some(item => item.text === keyword && item.isRegexp === state.keywordForm.isRegexp)) {
    ElMessage.warning("关键词已存在");
    return;
  }

  try {
    const newItem: FilterItem = {
      text: keyword,
      isRegexp: state.keywordForm.isRegexp
    };
    const newList = [...state.manualBlockedKeywords, newItem];

    await chrome.storage.local.set({ manualBlockedKeywords: newList });

    state.manualBlockedKeywords = newList;
    state.keywordForm.text = "";
    state.keywordForm.tags = [];
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加关键词失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 添加白名单关键词
 */
async function addWhitelist() {
  const keyword = state.whitelistInput.trim();
  if (!keyword) {
    ElMessage.warning("关键词不能为空");
    return;
  }

  if (state.manualWhitelistKeywords.includes(keyword)) {
    ElMessage.warning("关键词已存在");
    return;
  }

  try {
    const newList = [...state.manualWhitelistKeywords, keyword];
    await chrome.storage.local.set({ manualWhitelistKeywords: newList });
    state.manualWhitelistKeywords = newList;
    state.whitelistInput = "";
    ElMessage.success("添加成功");
  } catch (error) {
    console.error("[推文过滤器] 添加白名单关键词失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 移除关键词
 */
async function removeKeyword(item: FilterItem | string, type: "manual" | "whitelist") {
  try {
    const displayText = typeof item === 'string' ? item : item.text;
    await ElMessageBox.confirm(`确定要移除关键词 "${displayText}" 吗？`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });

    if (type === "manual") {
      const filterItem = item as FilterItem;
      const newManualList = state.manualBlockedKeywords.filter((k) =>
        k.text !== filterItem.text || k.isRegexp !== filterItem.isRegexp
      );

      await chrome.storage.local.set({ manualBlockedKeywords: newManualList });
      state.manualBlockedKeywords = newManualList;
    } else {
      const keyword = item as string;
      const newList = state.manualWhitelistKeywords.filter((k) => k !== keyword);
      await chrome.storage.local.set({ manualWhitelistKeywords: newList });
      state.manualWhitelistKeywords = newList;
    }

    ElMessage.success("移除成功");
  } catch (error) {
    if (error !== "cancel") {
      console.error("[推文过滤器] 移除关键词失败:", error);
      ElMessage.error("移除失败");
    }
  }
}

/**
 * 批量移除关键词
 */
async function batchRemoveKeywords(type: "manual" | "whitelist") {
  if (type === "manual") {
    if (state.selectedManualKeywords.length === 0) {
      ElMessage.warning("请先选择要移除的关键词");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedManualKeywords.length} 个关键词吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualBlockedKeywords.filter((k) =>
        !state.selectedManualKeywords.some(s => s.text === k.text && s.isRegexp === k.isRegexp)
      );

      await chrome.storage.local.set({ manualBlockedKeywords: newList });
      state.manualBlockedKeywords = newList;
      state.selectedManualKeywords = [];
      ElMessage.success("批量移除成功");
    } catch (error) {
      if (error !== "cancel") {
        console.error("[推文过滤器] 批量移除失败:", error);
        ElMessage.error("批量移除失败");
      }
    }
  } else {
    if (state.selectedWhitelistKeywords.length === 0) {
      ElMessage.warning("请先选择要移除的关键词");
      return;
    }

    try {
      await ElMessageBox.confirm(`确定要移除选中的 ${state.selectedWhitelistKeywords.length} 个关键词吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      });

      const newList = state.manualWhitelistKeywords.filter((k) =>
        !state.selectedWhitelistKeywords.includes(k)
      );

      await chrome.storage.local.set({ manualWhitelistKeywords: newList });
      state.manualWhitelistKeywords = newList;
      state.selectedWhitelistKeywords = [];
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
    if (areaName === "local" && changes.serverKeywords) {
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
      <el-input v-model="state.searchText" placeholder="搜索关键词..." clearable class="max-w-400px" />
      <div class="flex items-center gap-4">
        <el-switch v-model="state.isFilterEnabled" @change="toggleFilterEnabled" active-text="已启用" inactive-text="已禁用" />
        <el-button :loading="state.isRefreshing" @click="handleRefresh" size="small">刷新</el-button>
      </div>
    </div>

    <!-- 智能识别提示 -->
    <div class="px-6 py-3 mb-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
      <p class="text-sm text-gray-400">
        6551智能识别 <span class="text-[#409eff] font-semibold">{{ state.systemKeywordCount }}</span> 个关键词
      </p>
    </div>

    <!-- Tabs -->
    <el-tabs type="border-card" v-model="state.currentTab" class="flex-1 flex flex-col overflow-hidden">
      <el-tab-pane label="手动过滤" name="manual">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加关键词输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <div class="flex items-center gap-4">
              <el-checkbox v-model="state.keywordForm.isRegexp" class="mr-4">正则表达式</el-checkbox>
              <template v-if="state.keywordForm.isRegexp">
                <el-input
                  v-model="state.keywordForm.text"
                  placeholder="输入正则表达式..."
                  @keyup.enter="addKeyword"
                  class="flex-1"
                />
              </template>
              <template v-else>
                <el-input-tag
                  v-model="state.keywordForm.tags"
                  placeholder="输入关键词后按回车"
                  class="flex-1"
                />
              </template>
              <el-button type="primary" @click="addKeyword">添加</el-button>
            </div>
            <p class="text-xs text-gray-500 mt-2" v-if="!state.keywordForm.isRegexp">
              提示：多个关键词需要同时命中才会过滤，例如输入 "t.me" 和 "ca" 需要内容同时包含这两个词才会被过滤
            </p>
          </div>

          <el-empty v-if="filteredManualKeywords.length === 0" description="暂无手动过滤关键词" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredManualKeywords.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedManualKeywords.length === 0"
                @click="batchRemoveKeywords('manual')"
              >
                批量移除 ({{ state.selectedManualKeywords.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredManualKeywords"
              class="flex-1"
              height="100%"
              @selection-change="(val: FilterItem[]) => state.selectedManualKeywords = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="关键词">
                <template #default="{ row }">
                  <div class="flex items-center gap-2">
                    <el-tag v-if="row.isRegexp" type="warning" size="small">正则</el-tag>
                    <el-tag type="success" effect="dark">{{ row.text }}</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeKeyword(row, 'manual')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>

      <el-tab-pane label="白名单" name="whitelist">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加白名单关键词输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <el-input v-model="state.whitelistInput" placeholder="输入要加入白名单的关键词..." @keyup.enter="addWhitelist" class="max-w-400px">
              <template #append>
                <el-button type="primary" @click="addWhitelist">添加</el-button>
              </template>
            </el-input>
          </div>

          <el-empty v-if="filteredWhitelistKeywords.length === 0" description="暂无白名单关键词" />
          <template v-else>
            <div class="p-2 bg-[#0d0d0d] border-b border-[#2a2a2a] flex justify-between items-center">
              <span class="text-sm text-gray-400">共 {{ filteredWhitelistKeywords.length }} 条</span>
              <el-button
                type="danger"
                size="small"
                :disabled="state.selectedWhitelistKeywords.length === 0"
                @click="batchRemoveKeywords('whitelist')"
              >
                批量移除 ({{ state.selectedWhitelistKeywords.length }})
              </el-button>
            </div>
            <el-table
              :data="filteredWhitelistKeywords"
              class="flex-1"
              height="100%"
              @selection-change="(val: string[]) => state.selectedWhitelistKeywords = val"
            >
              <el-table-column type="selection" width="55" />
              <el-table-column label="关键词">
                <template #default="{ row }">
                  <el-tag type="info" effect="dark">{{ row }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="100">
                <template #default="{ row }">
                  <el-button type="danger" size="small" @click="removeKeyword(row, 'whitelist')"> 移除 </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
