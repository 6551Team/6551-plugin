/**
 * Twitter/X 推文过滤 Content Script
 * 自动隐藏指定账号的推文和回复
 */

import { TweetFilter } from './filter/tweetFilter'
import { initializeWasmWithRetry, getAccountCount, getWordCount, getHandleCount, remoteFilterUpdateAvailable } from '../services/wasmService'
import { ComposerScoreAssistant } from './score/composerScoreAssistant'

console.log('[推文过滤器] Content Script 已加载')

const composerScoreAssistant = new ComposerScoreAssistant()
composerScoreAssistant.initialize()

let tweetFilter: TweetFilter | null = null
let remoteReloadInFlight = false

async function persistSystemRuleCounts(): Promise<void> {
  await chrome.storage.local.set({
    wasmAccountCount: getAccountCount(),
    wasmKeywordCount: getWordCount(),
    wasmHandleCount: getHandleCount(),
    lastWasmLoadTime: Date.now(),
  })
}

async function reloadRemoteRules(): Promise<void> {
  if (remoteReloadInFlight) return
  remoteReloadInFlight = true
  try {
    await initializeWasmWithRetry(2, 'remote')
    await persistSystemRuleCounts()
    tweetFilter?.refreshSystemRules()
    console.log('[NewsLiquid] 在线过滤规则已重新载入')
  } catch (error) {
    console.warn('[NewsLiquid] 在线过滤规则重新载入失败:', error)
  } finally {
    remoteReloadInFlight = false
  }
}

// 初始化WASM模块并启动过滤器
async function initialize() {
  try {
    // 先加载WASM模块
    console.log('[推文过滤器] 正在加载WASM模块...')
    await initializeWasmWithRetry()
    console.log('[推文过滤器] WASM模块加载完成')

    // 保存WASM计数到storage
    const accountCount = getAccountCount()
    const keywordCount = getWordCount()
    await persistSystemRuleCounts()
    console.log(`[推文过滤器] WASM统计 - 账号: ${accountCount}, 关键词: ${keywordCount}`)

    // 创建并启动过滤器
    tweetFilter = new TweetFilter()
    await tweetFilter.initialize()
    void remoteFilterUpdateAvailable()
      .then((available) => {
        if (available) void reloadRemoteRules()
      })
      .catch((error) => console.warn('[NewsLiquid] 在线过滤规则检查失败:', error))
  } catch (error) {
    console.error('[推文过滤器] 初始化失败:', error)
    // 即使WASM加载失败，也继续运行过滤器（使用手动列表）
    tweetFilter = new TweetFilter()
    await tweetFilter.initialize()
  }

  const pending = await chrome.storage.local.get('filterOpenControlCenterRequestedAt')
  const requestedAt = Number(pending.filterOpenControlCenterRequestedAt || 0)
  if (requestedAt && Date.now() - requestedAt < 60_000) {
    await chrome.storage.local.remove('filterOpenControlCenterRequestedAt')
    tweetFilter?.openControlCenter()
  }
}

void initialize().finally(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.remoteFilterUpdatedAt?.newValue) void reloadRemoteRules()
  })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'SHOW_FILTER_CONTROL_CENTER') return undefined
  if (!tweetFilter) {
    sendResponse({ success: false, error: 'NewsLiquid 过滤器仍在初始化' })
    return undefined
  }

  tweetFilter.openControlCenter()
  sendResponse({ success: true })
  return undefined
})
