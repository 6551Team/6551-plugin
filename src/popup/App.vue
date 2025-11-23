<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { useFilterStore } from '../stores/filterStore'
import { Refresh, Setting, View } from '@element-plus/icons-vue'

const filterStore = useFilterStore()

const state = reactive({
  blockCount: 0, // 总拦截数量
})

// 打开详细设置页面
function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/dashboard/index.html') })
}

// 切换账号过滤
async function toggleAccountFilter() {
  console.log('[推文过滤器] 账号过滤切换为:', filterStore.state.accountFilterEnabled)
  await filterStore.saveToStorage()
}

// 切换关键词过滤
async function toggleKeywordFilter() {
  console.log('[推文过滤器] 关键词过滤切换为:', filterStore.state.keywordFilterEnabled)
  await filterStore.saveToStorage()
}

// 切换用户名过滤
async function toggleUsernameFilter() {
  console.log('[推文过滤器] 用户名过滤切换为:', filterStore.state.usernameFilterEnabled)
  await filterStore.saveToStorage()
}

// 切换显示屏蔽数据
async function toggleShowBlockUI() {
  console.log('[推文过滤器] 显示屏蔽数据切换为:', filterStore.state.showBlockUI)
  await filterStore.saveToStorage()
}

// 加载拦截计数
async function loadBlockCount() {
  try {
    const result = await chrome.storage.local.get(['totalBlockCount'])
    state.blockCount = result.totalBlockCount || 0
  } catch (error) {
    console.error('[推文过滤器] 加载拦截计数失败:', error)
  }
}

// 监听存储变化
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.totalBlockCount) {
      state.blockCount = changes.totalBlockCount.newValue || 0
    }
  })
}

// 初始化
onMounted(async () => {
  await filterStore.initialize()
  await loadBlockCount()
  setupStorageListener()
})
</script>

<template>
  <div class="w-80 bg-white">
    <!-- 拦截统计 -->
    <div class="p-6 text-center bg-gradient-to-br from-blue-50 to-indigo-50">
      <div class="text-sm text-gray-600 mb-2">已拦截推文</div>
      <div class="text-5xl font-bold text-blue-600 mb-1">
        {{ state.blockCount.toLocaleString() }}
      </div>
      <div class="text-xs text-gray-500">6551 推文过滤器</div>
    </div>

    <!-- 过滤器列表 -->
    <div class="px-4 pt-4 pb-4">
      <el-card shadow="hover" :body-style="{ padding: '16px' }">
        <div class="space-y-3">
          <!-- 账号过滤 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <el-icon :size="20" color="#409EFF">
                <User />
              </el-icon>
              <span class="text-sm text-gray-700">账号过滤</span>
            </div>
            <el-switch v-model="filterStore.state.accountFilterEnabled" @change="toggleAccountFilter" />
          </div>

          <el-divider style="margin: 8px 0" />

          <!-- 关键词过滤 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <el-icon :size="20" color="#67C23A">
                <PriceTag />
              </el-icon>
              <span class="text-sm text-gray-700">关键词过滤</span>
            </div>
            <el-switch v-model="filterStore.state.keywordFilterEnabled" @change="toggleKeywordFilter" />
          </div>

          <el-divider style="margin: 8px 0" />

          <!-- 用户名过滤 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <el-icon :size="20" color="#E6A23C">
                <Avatar />
              </el-icon>
              <span class="text-sm text-gray-700">用户名过滤</span>
            </div>
            <el-switch v-model="filterStore.state.usernameFilterEnabled" @change="toggleUsernameFilter" />
          </div>

          <el-divider style="margin: 8px 0" />

          <!-- 清爽模式 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <el-icon :size="20" color="#909399">
                <View />
              </el-icon>
              <span class="text-sm text-gray-700">清爽模式</span>
            </div>
            <el-switch v-model="filterStore.state.showBlockUI" @change="toggleShowBlockUI" :active-value="false" :inactive-value="true" />
          </div>
        </div>
      </el-card>
    </div>

    <!-- 底部操作按钮 -->
    <div class="px-4 pb-4">
      <el-button
        class="w-full"
        type="primary"
        @click="openSettings"
        :icon="Setting"
      >
        打开完整设置
      </el-button>
    </div>
  </div>
</template>

