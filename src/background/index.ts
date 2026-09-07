/**
 * Background Script
 * 用于处理反馈、上报等功能
 */

import { aesEncrypt } from "../utils/crypto";
import { DEFAULT_PHOENIX_ENDPOINT } from "../services/phoenixScoreService";

console.log("[推文过滤器] Background Script 已启动");

const REMOTE_FILTER_METADATA_KEY = 'newsLiquidRemoteFilterMetadata'
const REMOTE_FILTER_REFRESH_ALARM = 'newsLiquidRemoteFilterRefresh'
const REMOTE_FILTER_MAX_AGE_MS = 60 * 60 * 1000
const REMOTE_FILTER_URLS = {
  wasm: 'https://6551.tos-cn-hongkong.volces.com/yap/yap.wasm.v2',
  infofi: 'https://6551.tos-cn-hongkong.volces.com/yap/infofi.v2.json',
  handle: 'https://6551.tos-cn-hongkong.volces.com/yap/handle.v2.json',
} as const
const BASELINE_REMOTE_FILTER_ETAGS: Record<keyof typeof REMOTE_FILTER_URLS, string> = {
  wasm: '"c420c05e88c7a1892909dadaeff453b8"',
  infofi: '"2a2f82b1c50b9a684fc16f4cc003662e"',
  handle: '"f4da44907b077282674bdda1748e8db4"',
}

interface RemoteFilterMetadata {
  fetchedAt: number
  etags: Record<keyof typeof REMOTE_FILTER_URLS, string>
  updateAvailable: boolean
}

function isRemoteFilterMetadata(value: unknown): value is RemoteFilterMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Partial<RemoteFilterMetadata>
  return Number.isFinite(metadata.fetchedAt)
    && Boolean(metadata.etags)
    && typeof metadata.updateAvailable === 'boolean'
}

async function checkRemoteFilterSources(): Promise<RemoteFilterMetadata> {
  const [wasmResponse, infofiResponse, handleResponse] = await Promise.all([
    fetch(REMOTE_FILTER_URLS.wasm, { method: 'HEAD', cache: 'no-store' }),
    fetch(REMOTE_FILTER_URLS.infofi, { method: 'HEAD', cache: 'no-store' }),
    fetch(REMOTE_FILTER_URLS.handle, { method: 'HEAD', cache: 'no-store' }),
  ])

  const responses = [wasmResponse, infofiResponse, handleResponse]
  const failed = responses.find((response) => !response.ok)
  if (failed) throw new Error(`在线过滤规则请求失败 (${failed.status})`)

  const etags: RemoteFilterMetadata['etags'] = {
    wasm: wasmResponse.headers.get('etag') || '',
    infofi: infofiResponse.headers.get('etag') || '',
    handle: handleResponse.headers.get('etag') || '',
  }
  const updateAvailable = (Object.keys(etags) as Array<keyof typeof etags>).some((key) => (
    Boolean(etags[key]) && etags[key] !== BASELINE_REMOTE_FILTER_ETAGS[key]
  ))
  const metadata: RemoteFilterMetadata = {
    fetchedAt: Date.now(),
    etags,
    updateAvailable,
  }

  const previousStored = await chrome.storage.local.get(REMOTE_FILTER_METADATA_KEY)
  const previous = previousStored[REMOTE_FILTER_METADATA_KEY]
  const versionChanged = !isRemoteFilterMetadata(previous)
    || (Object.keys(etags) as Array<keyof typeof etags>).some((key) => previous.etags[key] !== etags[key])
  const values: Record<string, unknown> = {
    [REMOTE_FILTER_METADATA_KEY]: metadata,
    remoteFilterCheckedAt: metadata.fetchedAt,
    remoteFilterUpdateError: '',
  }
  if (updateAvailable && versionChanged) values.remoteFilterUpdatedAt = metadata.fetchedAt
  await chrome.storage.local.set(values)
  await chrome.storage.local.remove(['newsLiquidRemoteFilterBundle', 'newsLiquidRemoteDebug'])
  return metadata
}

async function ensureRemoteFilterSources(force = false): Promise<RemoteFilterMetadata> {
  const stored = await chrome.storage.local.get(REMOTE_FILTER_METADATA_KEY)
  const cached = stored[REMOTE_FILTER_METADATA_KEY]
  await chrome.storage.local.remove(['newsLiquidRemoteFilterBundle', 'newsLiquidRemoteDebug'])
  if (!force && isRemoteFilterMetadata(cached) && Date.now() - cached.fetchedAt < REMOTE_FILTER_MAX_AGE_MS) {
    return cached
  }

  try {
    return await checkRemoteFilterSources()
  } catch (error) {
    const message = error instanceof Error ? error.message : '在线过滤规则更新失败'
    await chrome.storage.local.set({ remoteFilterUpdateError: message })
    if (isRemoteFilterMetadata(cached)) return cached
    throw error
  }
}

function scheduleRemoteFilterRefresh(): void {
  chrome.alarms.create(REMOTE_FILTER_REFRESH_ALARM, { periodInMinutes: 60 })
}

// 监听插件安装/更新事件
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    console.log("[推文过滤器] 插件首次安装");
  } else if (details.reason === "update") {
    console.log("[推文过滤器] 插件已更新");
  }
  scheduleRemoteFilterRefresh()
  await ensureRemoteFilterSources(true).catch((error) => {
    console.warn('[NewsLiquid] 首次同步在线过滤规则失败:', error)
  })
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRemoteFilterRefresh()
  void ensureRemoteFilterSources()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMOTE_FILTER_REFRESH_ALARM) void ensureRemoteFilterSources(true)
})

scheduleRemoteFilterRefresh()
void ensureRemoteFilterSources()

interface PhoenixConfig {
  endpoint: string
  apiKey: string
}

async function getPhoenixConfig(): Promise<PhoenixConfig> {
  const stored = await chrome.storage.local.get(['phoenixScoreApiKey'])
  return {
    endpoint: DEFAULT_PHOENIX_ENDPOINT,
    apiKey: String(stored.phoenixScoreApiKey || ''),
  }
}

async function phoenixFetch(path: string, init?: RequestInit): Promise<Response> {
  const { endpoint, apiKey } = await getPhoenixConfig()
  const headers = new Headers(init?.headers)
  const token = apiKey.trim()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${endpoint}${path}`, { ...init, headers })
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string; message?: string }
    return body.detail || body.message || `请求失败 (${response.status})`
  } catch {
    return `请求失败 (${response.status})`
  }
}

async function getPhoenixHealth() {
  const { endpoint } = await getPhoenixConfig()
  try {
    const healthResponse = await phoenixFetch('/health')

    if (!healthResponse.ok) {
      throw new Error(await responseError(healthResponse))
    }

    const health = await healthResponse.json() as { service?: string; version?: string }

    return {
      online: true,
      ready: true,
      service: health.service,
      version: health.version,
      endpoint,
    }
  } catch (error) {
    return {
      online: false,
      ready: false,
      endpoint,
      error: error instanceof Error ? error.message : '无法连接评分服务',
    }
  }
}

async function scorePhoenixTweet(payload: unknown) {
  const response = await phoenixFetch('/v1/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json()
}

/**
 * 发送误报反馈
 */
async function sendFeedback(twAccount: string, feedbackUser: string) {
  try {
    // 加密数据
    const encryptedData = await aesEncrypt({
      twAccount,
      feedbackUser,
    });

    const response = await fetch("https://ai.6551.io/api/plugin/yap/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: encryptedData,
    });

    if (!response.ok) {
      throw new Error(`HTTP 错误! 状态: ${response.status}`);
    }

    const data = await response.json();
    console.log("[推文过滤器] 反馈成功:", data);

    // 保存到手动不屏蔽列表
    await addManualWhitelistAccount(twAccount);

    return { success: true, data };
  } catch (error) {
    console.error("[推文过滤器] 反馈失败:", error);
    throw error;
  }
}

/**
 * 发送手动上报
 */
async function sendManualReport(twAccount: string, url: string, feedbackUser: string) {
  try {
    // 加密数据
    const encryptedData = await aesEncrypt({
      twAccount,
      feedbackUser,
      url,
    });

    const response = await fetch('https://ai.6551.io/api/plugin/yap/manual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: encryptedData,
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误! 状态: ${response.status}`)
    }

    const data = await response.json()
    console.log('[推文过滤器] 手动上报成功:', data)

    // 保存到本地存储
    await addManualBlockedAccount(twAccount);

    return { success: true, data };
  } catch (error) {
    console.error("[推文过滤器] 手动上报失败:", error);
    throw error;
  }
}

/**
 * 添加手动上报的账号到本地存储
 */
async function addManualBlockedAccount(twAccount: string) {
  try {
    const result = await chrome.storage.local.get(['manualBlockedAccounts', 'manualWhitelistAccounts'])
    const manualBlocked = result.manualBlockedAccounts || []
    const whitelist = result.manualWhitelistAccounts || []

    // 添加到黑名单
    if (!manualBlocked.includes(twAccount)) {
      manualBlocked.push(twAccount)
      await chrome.storage.local.set({ manualBlockedAccounts: manualBlocked })
      console.log(`[推文过滤器] 已添加手动上报账号: ${twAccount}`)
    }

    // 从白名单中移除(如果存在)
    if (whitelist.includes(twAccount)) {
      const newWhitelist = whitelist.filter((acc: string) => acc !== twAccount)
      await chrome.storage.local.set({ manualWhitelistAccounts: newWhitelist })
      console.log(`[推文过滤器] 已从手动不屏蔽列表移除: ${twAccount}`)
    }
  } catch (error) {
    console.error('[推文过滤器] 保存手动上报账号失败:', error)
  }
}

/**
 * 添加手动不屏蔽的账号到本地存储(白名单)
 */
async function addManualWhitelistAccount(twAccount: string) {
  try {
    const result = await chrome.storage.local.get(["manualWhitelistAccounts", "manualBlockedAccounts"]);
    const whitelist = result.manualWhitelistAccounts || [];
    const blacklist = result.manualBlockedAccounts || [];

    // 添加到白名单
    if (!whitelist.includes(twAccount)) {
      whitelist.push(twAccount);
      await chrome.storage.local.set({ manualWhitelistAccounts: whitelist });
      console.log(`[推文过滤器] 已添加手动不屏蔽账号: ${twAccount}`);
    }

    // 从黑名单中移除(如果存在)
    if (blacklist.includes(twAccount)) {
      const newBlacklist = blacklist.filter((acc: string) => acc !== twAccount);
      await chrome.storage.local.set({ manualBlockedAccounts: newBlacklist });
      console.log(`[推文过滤器] 已从手动上报列表移除: ${twAccount}`);
    }
  } catch (error) {
    console.error("[推文过滤器] 保存手动不屏蔽账号失败:", error);
  }
}

async function openComposerAssistant() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeTab = tabs[0]

  if (activeTab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'SHOW_COMPOSER_ASSISTANT',
      }) as { success?: boolean } | undefined
      if (response?.success) return { opened: true, createdTab: false }
    } catch {
      // 当前页面不是 X，或内容脚本尚未就绪，转到 X 发帖页。
    }
  }

  await chrome.storage.local.set({ phoenixOpenComposerRequestedAt: Date.now() })
  await chrome.tabs.create({ url: 'https://x.com/compose/post' })
  return { opened: false, createdTab: true }
}

async function openFilterControlCenter() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeTab = tabs[0]

  if (activeTab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'SHOW_FILTER_CONTROL_CENTER',
      }) as { success?: boolean } | undefined
      if (response?.success) return { opened: true, createdTab: false }
    } catch {
      // 当前页面不是 X，转到 X 首页后打开控制中心。
    }
  }

  await chrome.storage.local.set({ filterOpenControlCenterRequestedAt: Date.now() })
  await chrome.tabs.create({ url: 'https://x.com/home' })
  return { opened: false, createdTab: true }
}

// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILTER_DATA_ENSURE' || message.type === 'FILTER_DATA_REFRESH') {
    ensureRemoteFilterSources(message.type === 'FILTER_DATA_REFRESH')
      .then((metadata) => sendResponse({
        success: true,
        data: {
          fetchedAt: metadata.fetchedAt,
          etags: metadata.etags,
          updateAvailable: metadata.updateAvailable,
        },
      }))
      .catch((error) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '在线过滤规则更新失败',
      }))
    return true
  }

  if (message.type === 'PHOENIX_HEALTH') {
    getPhoenixHealth()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }))
    return true
  }

  if (message.type === 'PHOENIX_SCORE') {
    scorePhoenixTweet(message.data)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }))
    return true
  }

  if (message.type === 'OPEN_COMPOSER_ASSISTANT') {
    openComposerAssistant()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '无法打开 X 发帖助手',
      }))
    return true
  }

  if (message.type === 'OPEN_FILTER_CONTROL_CENTER') {
    openFilterControlCenter()
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '无法打开 NewsLiquid 过滤设置',
      }))
    return true
  }

  if (message.type === "FEEDBACK_MISREPORT") {
    const { twAccount, feedbackUser } = message.data;

    sendFeedback(twAccount, feedbackUser)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 表示异步响应
    return true;
  }

  if (message.type === "MANUAL_REPORT") {
    const { twAccount, url, feedbackUser } = message.data;

    sendManualReport(twAccount, url, feedbackUser)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 表示异步响应
    return true;
  }

  if (message.type === "MANUAL_UPDATE") {
    console.log('[推文过滤器] 收到手动刷新请求');
    // content script 会自己重新加载 WASM
    sendResponse({ success: true });
    return true;
  }
});
