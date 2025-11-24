<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

// 过滤项类型
interface FilterItem {
  text: string;
  isRegexp: boolean;
}

const manualBlockedKeywords = ref<FilterItem[]>([]);
const manualWhitelistKeywords = ref<string[]>([]);
const isFilterEnabled = ref(true);
const currentTab = ref<"manual" | "whitelist">("manual");
const whitelistInput = ref("");
const systemKeywordCount = ref(0);
const isRefreshing = ref(false);

// 新增关键词表单
const keywordForm = reactive({
  isRegexp: false,
  text: "",
  tags: [] as string[],
  tagInput: ""
});

/**
 * 处理标签输入
 */
function handleTagInput(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const value = keywordForm.tagInput.trim();
    if (value && !keywordForm.tags.includes(value)) {
      keywordForm.tags.push(value);
    }
    keywordForm.tagInput = "";
  }
}

// 搜索和分页
const searchText = ref("");
const systemCurrentPage = ref(1);
const manualCurrentPage = ref(1);
const whitelistCurrentPage = ref(1);
const pageSize = ref(20);

// 过滤后的数据

const filteredManualKeywords = computed(() => {
  if (!searchText.value) return manualBlockedKeywords.value;
  return manualBlockedKeywords.value.filter((item) => item.text.toLowerCase().includes(searchText.value.toLowerCase()));
});

const filteredWhitelistKeywords = computed(() => {
  if (!searchText.value) return manualWhitelistKeywords.value;
  return manualWhitelistKeywords.value.filter((kw) => kw.toLowerCase().includes(searchText.value.toLowerCase()));
});

// 分页后的数据
const paginatedManualKeywords = computed(() => {
  const start = (manualCurrentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredManualKeywords.value.slice(start, end);
});

const paginatedWhitelistKeywords = computed(() => {
  const start = (whitelistCurrentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredWhitelistKeywords.value.slice(start, end);
});

/**
 * 加载数据
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get(["manualBlockedKeywords", "manualWhitelistKeywords", "isEnabled", "wasmKeywordCount"]);

    // 兼容旧格式
    const rawKeywords = Array.isArray(result.manualBlockedKeywords)
      ? result.manualBlockedKeywords
      : Object.values(result.manualBlockedKeywords || {});

    manualBlockedKeywords.value = rawKeywords.map((item: any) => {
      if (typeof item === 'string') {
        return { text: item, isRegexp: false };
      }
      return item as FilterItem;
    });

    manualWhitelistKeywords.value = Array.isArray(result.manualWhitelistKeywords)
      ? result.manualWhitelistKeywords
      : Object.values(result.manualWhitelistKeywords || {});

    isFilterEnabled.value = result.isEnabled !== undefined ? result.isEnabled : true;
    systemKeywordCount.value = result.wasmKeywordCount || 0;
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

  if (keywordForm.isRegexp) {
    // 正则模式使用文本输入
    keyword = keywordForm.text.trim();
    if (!keyword) {
      ElMessage.warning("正则表达式不能为空");
      return;
    }
    // 验证正则表达式
    try {
      new RegExp(keyword);
    } catch (e) {
      ElMessage.error("正则表达式格式错误");
      return;
    }
  } else {
    // 非正则模式使用 tags
    if (keywordForm.tags.length === 0) {
      ElMessage.warning("关键词不能为空");
      return;
    }
    keyword = keywordForm.tags.join(',');
  }

  // 检查是否已存在
  if (manualBlockedKeywords.value.some(item => item.text === keyword && item.isRegexp === keywordForm.isRegexp)) {
    ElMessage.warning("关键词已存在");
    return;
  }

  try {
    const newItem: FilterItem = {
      text: keyword,
      isRegexp: keywordForm.isRegexp
    };
    const newList = [...manualBlockedKeywords.value, newItem];

    await chrome.storage.local.set({
      manualBlockedKeywords: newList,
    });

    manualBlockedKeywords.value = newList;
    keywordForm.text = "";
    keywordForm.tags = [];
    ElMessage.success("添加成功");
    console.log(`[推文过滤器] 已添加关键词: ${keyword}`);
  } catch (error) {
    console.error("[推文过滤器] 添加关键词失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 添加白名单关键词
 */
async function addWhitelist() {
  const keyword = whitelistInput.value.trim();
  if (!keyword) {
    ElMessage.warning("关键词不能为空");
    return;
  }

  if (manualWhitelistKeywords.value.includes(keyword)) {
    ElMessage.warning("关键词已存在");
    return;
  }

  try {
    const newList = [...manualWhitelistKeywords.value, keyword];
    await chrome.storage.local.set({ manualWhitelistKeywords: newList });
    manualWhitelistKeywords.value = newList;
    whitelistInput.value = "";
    ElMessage.success("添加成功");
    console.log(`[推文过滤器] 已添加白名单关键词: ${keyword}`);
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
      const newManualList = manualBlockedKeywords.value.filter((k) =>
        k.text !== filterItem.text || k.isRegexp !== filterItem.isRegexp
      );

      await chrome.storage.local.set({
        manualBlockedKeywords: newManualList,
      });

      manualBlockedKeywords.value = newManualList;
    } else {
      const keyword = item as string;
      const newList = manualWhitelistKeywords.value.filter((k) => k !== keyword);
      await chrome.storage.local.set({ manualWhitelistKeywords: newList });
      manualWhitelistKeywords.value = newList;
    }

    ElMessage.success("移除成功");
    console.log(`[推文过滤器] 已移除关键词: ${typeof item === 'string' ? item : item.text}`);
  } catch (error) {
    if (error !== "cancel") {
      console.error("[推文过滤器] 移除关键词失败:", error);
      ElMessage.error("移除失败");
    }
  }
}

/**
 * 手动刷新数据
 */
async function handleRefresh() {
  if (isRefreshing.value) return;

  isRefreshing.value = true;
  try {
    await chrome.runtime.sendMessage({ type: 'MANUAL_UPDATE' });
    await loadData();
    ElMessage.success('数据刷新成功');
  } catch (error) {
    console.error('[推文过滤器] 刷新失败:', error);
    ElMessage.error('刷新失败');
  } finally {
    isRefreshing.value = false;
  }
}

/**
 * 监听存储变化（仅监听外部变化）
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      // 在服务器数据更新时重新加载
      if (changes.serverKeywords) {
        loadData();
      }
    }
  });
}

onMounted(() => {
  loadData();
  setupStorageListener();
});
</script>

<style></style>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-[#1a1a1a]">
    <!-- 顶部工具栏 -->
    <div class="px-6 py-4 mb-4 border-b border-[#2a2a2a] flex justify-between items-center bg-[#0d0d0d]">
      <el-input v-model="searchText" placeholder="搜索关键词..." clearable class="max-w-400px" />
      <div class="flex items-center gap-4">
        <el-switch v-model="isFilterEnabled" @change="toggleFilterEnabled" active-text="已启用" inactive-text="已禁用" />
        <el-button :loading="isRefreshing" @click="handleRefresh" size="small">刷新</el-button>
      </div>
    </div>

    <!-- 智能识别提示 -->
    <div class="px-6 py-3 mb-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
      <p class="text-sm text-gray-400">
        6551智能识别 <span class="text-[#409eff] font-semibold">{{ systemKeywordCount }}</span> 个关键词
      </p>
    </div>

    <!-- Tabs -->
    <el-tabs type="border-card" v-model="currentTab" class="flex-1 flex flex-col overflow-hidden">
      <el-tab-pane label="手动过滤" name="manual">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加关键词输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <div class="flex items-center gap-4">
              <el-checkbox v-model="keywordForm.isRegexp">正则表达式</el-checkbox>
              <template v-if="keywordForm.isRegexp">
                <el-input
                  v-model="keywordForm.text"
                  placeholder="输入正则表达式..."
                  @keyup.enter="addKeyword"
                  class="flex-1"
                />
              </template>
              <template v-else>
                <div class="flex-1 flex items-center gap-2 flex-wrap p-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded min-h-[32px]">
                  <el-tag
                    v-for="(tag, index) in keywordForm.tags"
                    :key="index"
                    closable
                    @close="keywordForm.tags.splice(index, 1)"
                    size="small"
                  >
                    {{ tag }}
                  </el-tag>
                  <input
                    v-model="keywordForm.tagInput"
                    placeholder="输入关键词后按回车"
                    class="flex-1 min-w-[120px] bg-transparent border-none outline-none text-white text-sm"
                    @keydown="handleTagInput"
                  />
                </div>
              </template>
              <el-button type="primary" @click="addKeyword">添加</el-button>
            </div>
            <p class="text-xs text-gray-500 mt-2" v-if="!keywordForm.isRegexp">
              提示：多个关键词需要同时命中才会过滤，例如输入 "t.me" 和 "ca" 需要内容同时包含这两个词才会被过滤
            </p>
          </div>

          <el-empty v-if="filteredManualKeywords.length === 0" description="暂无手动过滤关键词" />
          <template v-else>
            <el-table :data="paginatedManualKeywords" class="flex-1" height="100%">
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
            <div class="p-4 text-right border-t ">
              <el-pagination
                v-model:current-page="manualCurrentPage"
                v-model:page-size="pageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="filteredManualKeywords.length"
                layout="total, sizes, prev, pager, next, jumper"
                background
              />
            </div>
          </template>
        </div>
      </el-tab-pane>

      <el-tab-pane label="白名单" name="whitelist">
        <div class="h-[calc(100vh-280px)] flex flex-col bg-[#1a1a1a]">
          <!-- 添加白名单关键词输入框 -->
          <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
            <el-input v-model="whitelistInput" placeholder="输入要加入白名单的关键词..." @keyup.enter="addWhitelist" class="max-w-400px">
              <template #append>
                <el-button type="primary" @click="addWhitelist">添加</el-button>
              </template>
            </el-input>
          </div>

          <el-empty v-if="filteredWhitelistKeywords.length === 0" description="暂无白名单关键词" />
          <template v-else>
            <el-table :data="paginatedWhitelistKeywords" class="flex-1" height="100%">
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
            <div class="p-4 text-right border-t">
              <el-pagination
                v-model:current-page="whitelistCurrentPage"
                v-model:page-size="pageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="filteredWhitelistKeywords.length"
                layout="total, sizes, prev, pager, next, jumper"
                background
              />
            </div>
          </template>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
