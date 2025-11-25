import { defineStore } from 'pinia'
import { reactive } from 'vue'

/**
 * 过滤器状态管理
 * 使用 Pinia 管理过滤器配置状态
 */
export const useFilterStore = defineStore('filter', () => {
  // 使用 reactive 定义状态
  const state = reactive({
    isLoading: false, // 是否正在加载
    error: null as string | null, // 错误信息
    isEnabled: true, // 是否启用过滤功能
    accountFilterEnabled: true, // 账号过滤开关
    keywordFilterEnabled: true, // 关键词过滤开关
    usernameFilterEnabled: true, // 用户名过滤开关
    showBlockUI: false, // 是否显示屏蔽数据UI（清爽模式默认开启）
    wasmAccountCount: 0, // WASM账号数量
    wasmKeywordCount: 0, // WASM关键词数量
  })

  /**
   * 从 Chrome Storage 加载配置
   */
  async function loadFromStorage() {
    try {
      const result = await chrome.storage.local.get([
        'isEnabled',
        'accountFilterEnabled',
        'keywordFilterEnabled',
        'usernameFilterEnabled',
        'showBlockUI',
        'wasmAccountCount',
        'wasmKeywordCount'
      ])

      state.isEnabled = result.isEnabled !== undefined ? result.isEnabled : true
      state.accountFilterEnabled = result.accountFilterEnabled !== undefined ? result.accountFilterEnabled : true
      state.keywordFilterEnabled = result.keywordFilterEnabled !== undefined ? result.keywordFilterEnabled : true
      state.usernameFilterEnabled = result.usernameFilterEnabled !== undefined ? result.usernameFilterEnabled : true
      state.showBlockUI = result.showBlockUI !== undefined ? result.showBlockUI : false
      state.wasmAccountCount = result.wasmAccountCount || 0
      state.wasmKeywordCount = result.wasmKeywordCount || 0

      console.log(`[FilterStore] 已加载配置 - 启用: ${state.isEnabled}, 账号过滤: ${state.accountFilterEnabled}, 关键词过滤: ${state.keywordFilterEnabled}, 用户名过滤: ${state.usernameFilterEnabled}, 显示UI: ${state.showBlockUI}`)
    } catch (error) {
      console.error('[FilterStore] 从存储加载数据失败:', error)
    }
  }

  /**
   * 保存配置到 Chrome Storage
   */
  async function saveToStorage() {
    try {
      await chrome.storage.local.set({
        isEnabled: state.isEnabled,
        accountFilterEnabled: state.accountFilterEnabled,
        keywordFilterEnabled: state.keywordFilterEnabled,
        usernameFilterEnabled: state.usernameFilterEnabled,
        showBlockUI: state.showBlockUI,
      })
      console.log('[FilterStore] 配置已保存')
    } catch (error) {
      console.error('[FilterStore] 保存配置失败:', error)
    }
  }

  /**
   * 初始化：加载配置数据
   */
  async function initialize() {
    await loadFromStorage()
  }

  /**
   * 切换启用状态
   */
  async function toggleEnabled() {
    state.isEnabled = !state.isEnabled
    await saveToStorage()
    console.log(`[FilterStore] 过滤功能已${state.isEnabled ? '启用' : '禁用'}`)
  }

  return {
    state,
    loadFromStorage,
    saveToStorage,
    initialize,
    toggleEnabled,
  }
})
