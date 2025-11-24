<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

// 过滤项类型
interface FilterItem {
  text: string;
  isRegexp: boolean;
}

const manualBlockedUsernames = ref<FilterItem[]>([]);
const manualWhitelistUsernames = ref<string[]>([]);
const isFilterEnabled = ref(true);
const whitelistInput = ref("");
const systemUsernameCount = ref(0);
const isRefreshing = ref(false);

// 新增用户名表单
const usernameForm = reactive({
  isRegexp: false,
  text: "",
  tags: [] as string[],
  tagInput: ""
});

// 搜索和分页
const searchText = ref("");
const manualCurrentPage = ref(1);
const whitelistCurrentPage = ref(1);
const pageSize = ref(20);

/**
 * 处理标签输入
 */
function handleTagInput(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const value = usernameForm.tagInput.trim();
    if (value && !usernameForm.tags.includes(value)) {
      usernameForm.tags.push(value);
    }
    usernameForm.tagInput = "";
  }
}

// 过滤后的数据

const filteredManualUsernames = computed(() => {
  if (!searchText.value) return manualBlockedUsernames.value;
  return manualBlockedUsernames.value.filter((item) => item.text.toLowerCase().includes(searchText.value.toLowerCase()));
});

const filteredWhitelistUsernames = computed(() => {
  if (!searchText.value) return manualWhitelistUsernames.value;
  return manualWhitelistUsernames.value.filter((name) => name.toLowerCase().includes(searchText.value.toLowerCase()));
});

// 分页后的数据
const paginatedManualUsernames = computed(() => {
  const start = (manualCurrentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredManualUsernames.value.slice(start, end);
});

const paginatedWhitelistUsernames = computed(() => {
  const start = (whitelistCurrentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredWhitelistUsernames.value.slice(start, end);
});

/**
 * 加载数据
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get(["manualBlockedUsernames", "manualWhitelistUsernames", "isEnabled", "wasmHandleCount"]);

    // 兼容旧格式
    const rawUsernames = Array.isArray(result.manualBlockedUsernames)
      ? result.manualBlockedUsernames
      : Object.values(result.manualBlockedUsernames || {});

    manualBlockedUsernames.value = rawUsernames.map((item: any) => {
      if (typeof item === 'string') {
        return { text: item, isRegexp: false };
      }
      return item as FilterItem;
    });

    manualWhitelistUsernames.value = Array.isArray(result.manualWhitelistUsernames)
      ? result.manualWhitelistUsernames
      : Object.values(result.manualWhitelistUsernames || {});

    isFilterEnabled.value = result.isEnabled !== undefined ? result.isEnabled : true;
    systemUsernameCount.value = result.wasmHandleCount || 0;
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

  if (usernameForm.isRegexp) {
    // 正则模式使用文本输入
    username = usernameForm.text.trim();
    if (!username) {
      ElMessage.warning("正则表达式不能为空");
      return;
    }
    // 验证正则表达式
    try {
      new RegExp(username);
    } catch (e) {
      ElMessage.error("正则表达式格式错误");
      return;
    }
  } else {
    // 非正则模式使用 tags
    if (usernameForm.tags.length === 0) {
      ElMessage.warning("用户名不能为空");
      return;
    }
    username = usernameForm.tags.join(',');
  }

  // 检查是否已存在
  if (manualBlockedUsernames.value.some(item => item.text === username && item.isRegexp === usernameForm.isRegexp)) {
    ElMessage.warning("用户名已存在");
    return;
  }

  try {
    const newItem: FilterItem = {
      text: username,
      isRegexp: usernameForm.isRegexp
    };
    const newList = [...manualBlockedUsernames.value, newItem];

    await chrome.storage.local.set({
      manualBlockedUsernames: newList,
    });

    manualBlockedUsernames.value = newList;
    usernameForm.text = "";
    usernameForm.tags = [];
    ElMessage.success("添加成功");
    console.log(`[推文过滤器] 已添加用户名: ${username}`);
  } catch (error) {
    console.error("[推文过滤器] 添加用户名失败:", error);
    ElMessage.error("添加失败");
  }
}

/**
 * 添加白名单用户名
 */
async function addWhitelist() {
  const username = whitelistInput.value.trim();
  if (!username) {
    ElMessage.warning("用户名不能为空");
    return;
  }

  if (manualWhitelistUsernames.value.includes(username)) {
    ElMessage.warning("用户名已存在");
    return;
  }

  try {
    const newList = [...manualWhitelistUsernames.value, username];
    await chrome.storage.local.set({ manualWhitelistUsernames: newList });
    manualWhitelistUsernames.value = newList;
    whitelistInput.value = "";
    ElMessage.success("添加成功");
    console.log(`[推文过滤器] 已添加白名单用户名: ${username}`);
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
      const newManualList = manualBlockedUsernames.value.filter((k) =>
        k.text !== filterItem.text || k.isRegexp !== filterItem.isRegexp
      );

      await chrome.storage.local.set({
        manualBlockedUsernames: newManualList,
      });

      manualBlockedUsernames.value = newManualList;
    } else {
      const username = item as string;
      const newList = manualWhitelistUsernames.value.filter((n) => n !== username);
      await chrome.storage.local.set({ manualWhitelistUsernames: newList });
      manualWhitelistUsernames.value = newList;
    }

    ElMessage.success("移除成功");
    console.log(`[推文过滤器] 已移除用户名: ${displayText}`);
  } catch (error) {
    if (error !== "cancel") {
      console.error("[推文过滤器] 移除用户名失败:", error);
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
      if (changes.serverUsernames) {
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
      <el-input v-model="searchText" placeholder="搜索用户名..." clearable class="max-w-400px" />
      <div class="flex items-center gap-4">
        <el-switch v-model="isFilterEnabled" @change="toggleFilterEnabled" active-text="已启用" inactive-text="已禁用" />
        <el-button :loading="isRefreshing" @click="handleRefresh" size="small">刷新</el-button>
      </div>
    </div>

    <!-- 智能识别提示 -->
    <div class="px-6 py-3 mb-4 bg-[#0d0d0d] border-b border-[#2a2a2a]">
      <p class="text-sm text-gray-400">
        6551智能识别 <span class="text-[#409eff] font-semibold">{{ systemUsernameCount }}</span> 个用户名
      </p>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 flex flex-col bg-[#1a1a1a] p-4 overflow-hidden">
      <!-- 添加用户名输入框 -->
      <div class="p-4 bg-[#0d0d0d] border-b border-[#2a2a2a] mb-4">
        <div class="flex items-center gap-4">
          <el-checkbox v-model="usernameForm.isRegexp">正则表达式</el-checkbox>
          <template v-if="usernameForm.isRegexp">
            <el-input
              v-model="usernameForm.text"
              placeholder="输入正则表达式..."
              @keyup.enter="addUsername"
              class="flex-1"
            />
          </template>
          <template v-else>
            <div class="flex-1 flex items-center gap-2 flex-wrap p-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded min-h-[32px]">
              <el-tag
                v-for="(tag, index) in usernameForm.tags"
                :key="index"
                closable
                @close="usernameForm.tags.splice(index, 1)"
                size="small"
              >
                {{ tag }}
              </el-tag>
              <input
                v-model="usernameForm.tagInput"
                placeholder="输入用户名后按回车"
                class="flex-1 min-w-[120px] bg-transparent border-none outline-none text-white text-sm"
                @keydown="handleTagInput"
              />
            </div>
          </template>
          <el-button type="primary" @click="addUsername">添加</el-button>
        </div>
        <p class="text-xs text-gray-500 mt-2" v-if="!usernameForm.isRegexp">
          提示：多个用户名关键词需要同时命中才会过滤
        </p>
      </div>

      <el-empty v-if="filteredManualUsernames.length === 0" description="暂无手动过滤用户名" />
      <template v-else>
        <el-table :data="paginatedManualUsernames" class="flex-1" height="100%">
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
        <div class="p-4 text-right border-t ">
          <el-pagination
            v-model:current-page="manualCurrentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="filteredManualUsernames.length"
            layout="total, sizes, prev, pager, next, jumper"
            background
          />
        </div>
      </template>
    </div>
  </div>
</template>
