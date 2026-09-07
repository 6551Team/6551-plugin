<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import AccountFilter from "./components/AccountFilter.vue";
import KeywordFilter from "./components/KeywordFilter.vue";
import UsernameFilter from "./components/UsernameFilter.vue";

const currentMenu = ref<"accounts" | "keywords" | "usernames">("accounts");
const isRefreshing = ref(false);

/**
 * 手动刷新数据
 */
async function handleRefresh() {
  if (isRefreshing.value) return;

  isRefreshing.value = true;
  try {
    // 触发后台更新
    await chrome.runtime.sendMessage({ type: 'MANUAL_UPDATE' });
    ElMessage.success('数据刷新成功');
  } catch (error) {
    console.error('[推文过滤器] 刷新失败:', error);
    ElMessage.error('刷新失败');
  } finally {
    isRefreshing.value = false;
  }
}
</script>

<template>
  <el-container class="h-screen bg-[#1a1a1a]">
    <!-- 左侧菜单 -->
    <el-aside width="240px" class="bg-[#0d0d0d] border-r border-[#2a2a2a] flex flex-col">
      <div class="p-6 border-b border-[#2a2a2a]">
        <h1 class="text-xl font-bold text-[#6d55e7] m-0">NewsLiquid 推文过滤器</h1>
        <p class="text-sm text-gray-400 mt-2 mb-0">内容过滤管理工具</p>
      </div>

      <el-menu
        :default-active="currentMenu"
        @select="(key: any) => currentMenu = key"
        background-color="#0d0d0d"
        text-color="#a0a0a0"
        active-text-color="#409eff"
        class="border-none"
      >
        <el-menu-item index="accounts">
          <span>账号过滤</span>
        </el-menu-item>
        <el-menu-item index="keywords">
          <span>关键词过滤</span>
        </el-menu-item>
        <el-menu-item index="usernames">
          <span>用户名过滤</span>
        </el-menu-item>
      </el-menu>

      <!-- 占位空间 -->
      <div class="flex-1"></div>

      <!-- 刷新按钮 -->
      <div class="p-4 border-t border-[#2a2a2a]">
        <el-button
          type="primary"
          class="w-full"
          @click="handleRefresh"
          :loading="isRefreshing"
          :disabled="isRefreshing"
        >
          {{ isRefreshing ? '刷新中...' : '刷新数据' }}
        </el-button>
      </div>
    </el-aside>

    <!-- 右侧内容区 -->
    <el-main class="overflow-hidden">
      <AccountFilter v-if="currentMenu === 'accounts'" />
      <KeywordFilter v-if="currentMenu === 'keywords'" />
      <UsernameFilter v-if="currentMenu === 'usernames'" />
    </el-main>
  </el-container>
</template>
