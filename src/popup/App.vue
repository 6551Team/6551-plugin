<script setup lang="ts">
import { gsap } from 'gsap'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useFilterStore } from '../stores/filterStore'
import {
  checkPhoenixHealth,
  loadPhoenixSettings,
  openComposerAssistant,
  savePhoenixSettings,
} from '../services/phoenixScoreService'
import { openFilterControlCenter } from '../services/filterRuleService'

const filterStore = useFilterStore()
const popupRoot = ref<HTMLElement | null>(null)
const state = reactive({ blockCount: 0, remoteUpdatedAt: 0, remoteError: '' })
const service = reactive({ apiKey: '' })
const healthOnline = ref(false)
const isChecking = ref(false)
const isLaunchingComposer = ref(false)
const isOpeningCenter = ref(false)
const isSaving = ref(false)
const isOpeningApiKeyPage = ref(false)
const isRefreshingRules = ref(false)
const notice = reactive<{ text: string; tone: 'success' | 'warning' | 'error' }>({ text: '', tone: 'success' })
let noticeTimer: number | undefined

const healthLabel = computed(() => healthOnline.value ? '服务可用' : '未连接')
const filterLabel = computed(() => filterStore.state.isEnabled ? '过滤已启用' : '过滤已暂停')
const systemRuleCount = computed(() => (
  filterStore.state.wasmAccountCount + filterStore.state.wasmKeywordCount + filterStore.state.wasmHandleCount
))
const remoteLabel = computed(() => {
  if (isRefreshingRules.value) return '同步中…'
  if (state.remoteError) return '重新同步'
  return '同步列表'
})

function showNotice(text: string, tone: 'success' | 'warning' | 'error' = 'success'): void {
  notice.text = text
  notice.tone = tone
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.text = '' }, 2400)
}

async function saveFilterState(): Promise<void> {
  await filterStore.saveToStorage()
}

async function refreshHealth(): Promise<void> {
  isChecking.value = true
  try {
    const health = await checkPhoenixHealth()
    healthOnline.value = health.online
  } finally {
    isChecking.value = false
  }
}

async function launchComposer(): Promise<void> {
  isLaunchingComposer.value = true
  try {
    await openComposerAssistant()
    window.close()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '无法打开 X 发帖框', 'error')
  } finally {
    isLaunchingComposer.value = false
  }
}

async function launchFilterCenter(): Promise<void> {
  isOpeningCenter.value = true
  try {
    await openFilterControlCenter()
    window.close()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '无法打开过滤设置', 'error')
  } finally {
    isOpeningCenter.value = false
  }
}

async function openApiKeyPage(): Promise<void> {
  isOpeningApiKeyPage.value = true
  try {
    if (chrome.tabs?.create) {
      await chrome.tabs.create({ url: 'https://app.newsliquid.com/mcp' })
      return
    }
    const opened = window.open('https://app.newsliquid.com/mcp', '_blank')
    if (!opened) throw new Error('无法打开 APIKEY 页面')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '无法打开 APIKEY 页面', 'error')
  } finally {
    isOpeningApiKeyPage.value = false
  }
}

async function saveServiceSettings(): Promise<void> {
  isSaving.value = true
  try {
    await savePhoenixSettings({ apiKey: service.apiKey.trim() })
    showNotice('APIKEY 已保存')
    await refreshHealth()
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    isSaving.value = false
  }
}

async function loadRemoteState(): Promise<void> {
  const stored = await chrome.storage.local.get(['remoteFilterCheckedAt', 'remoteFilterUpdatedAt', 'remoteFilterUpdateError'])
  state.remoteUpdatedAt = Number(stored.remoteFilterCheckedAt || stored.remoteFilterUpdatedAt || 0)
  state.remoteError = String(stored.remoteFilterUpdateError || '')
}

async function refreshRemoteRules(): Promise<void> {
  isRefreshingRules.value = true
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FILTER_DATA_REFRESH' }) as { success?: boolean; error?: string }
    if (!response?.success) throw new Error(response?.error || '在线列表更新失败')
    await loadRemoteState()
    showNotice('在线过滤列表已更新')
  } catch (error) {
    await loadRemoteState()
    showNotice(error instanceof Error ? error.message : '在线列表更新失败', 'error')
  } finally {
    isRefreshingRules.value = false
  }
}

async function loadPopup(): Promise<void> {
  await filterStore.initialize()
  const stored = await chrome.storage.local.get('totalBlockCount')
  state.blockCount = Number(stored.totalBlockCount || 0)
  const settings = await loadPhoenixSettings()
  service.apiKey = settings.apiKey
  await Promise.all([refreshHealth(), loadRemoteState()])

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    if (changes.totalBlockCount) state.blockCount = Number(changes.totalBlockCount.newValue || 0)
    if (changes.remoteFilterCheckedAt || changes.remoteFilterUpdatedAt || changes.remoteFilterUpdateError) void loadRemoteState()
    if (changes.wasmAccountCount || changes.wasmKeywordCount || changes.wasmHandleCount) void filterStore.loadFromStorage()
  })
}

function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

watch(() => notice.text, async (value) => {
  if (!value || prefersReducedMotion()) return
  await nextTick()
  const element = popupRoot.value?.querySelector<HTMLElement>('.popup-notice')
  if (element) gsap.fromTo(element, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power2.out' })
})

onMounted(async () => {
  await loadPopup()
  await nextTick()
  if (prefersReducedMotion()) return
  const sections = popupRoot.value?.querySelectorAll<HTMLElement>('.popup-header,.weui-panel')
  if (sections?.length) {
    gsap.fromTo(sections, { autoAlpha: 0, y: 9 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.055, ease: 'power2.out' })
  }
})
</script>

<template>
  <main ref="popupRoot" class="popup-shell">
    <header class="popup-header">
      <div class="popup-brand">
        <img src="/newsliquid-mark.png" alt="NewsLiquid" />
        <div><strong>NewsLiquid</strong><span>X 网页插件</span></div>
      </div>
      <span class="weui-badge plain-state" :class="{ paused: !filterStore.state.isEnabled }">{{ filterLabel }}</span>
    </header>

    <p v-if="notice.text" class="weui-toptips popup-notice" :class="`is-${notice.tone}`" role="status">{{ notice.text }}</p>

    <section class="weui-panel primary-card">
      <div class="weui-cell section-heading">
        <h1>内容过滤</h1>
        <input v-model="filterStore.state.isEnabled" class="weui-switch toggle-control" type="checkbox" aria-label="启用内容过滤" @change="saveFilterState" />
      </div>

      <div class="filter-metrics">
        <div class="filter-metric is-primary"><strong>{{ systemRuleCount.toLocaleString() }}</strong><span>系统规则</span></div>
        <div class="filter-metric"><strong>{{ state.blockCount.toLocaleString() }}</strong><span>累计隐藏</span></div>
      </div>

      <div class="weui-cells filter-list">
        <label class="weui-cell weui-cell_switch"><span class="weui-cell__bd filter-name">账号</span><span class="filter-count"><strong>{{ filterStore.state.wasmAccountCount.toLocaleString() }}</strong><small>规则</small></span><span class="weui-cell__ft"><input v-model="filterStore.state.accountFilterEnabled" class="weui-switch toggle-control" type="checkbox" aria-label="启用账号过滤" @change="saveFilterState" /></span></label>
        <label class="weui-cell weui-cell_switch"><span class="weui-cell__bd filter-name">推文内容</span><span class="filter-count"><strong>{{ filterStore.state.wasmKeywordCount.toLocaleString() }}</strong><small>规则</small></span><span class="weui-cell__ft"><input v-model="filterStore.state.keywordFilterEnabled" class="weui-switch toggle-control" type="checkbox" aria-label="启用推文内容过滤" @change="saveFilterState" /></span></label>
        <label class="weui-cell weui-cell_switch"><span class="weui-cell__bd filter-name">显示名称</span><span class="filter-count"><strong>{{ filterStore.state.wasmHandleCount.toLocaleString() }}</strong><small>规则</small></span><span class="weui-cell__ft"><input v-model="filterStore.state.usernameFilterEnabled" class="weui-switch toggle-control" type="checkbox" aria-label="启用显示名称过滤" @change="saveFilterState" /></span></label>
      </div>

      <div class="panel-actions filter-actions">
        <button class="weui-btn weui-btn_primary popup-action primary-action" type="button" :disabled="isOpeningCenter" @click="launchFilterCenter">
          {{ isOpeningCenter ? '正在打开…' : '管理过滤规则' }}
        </button>
        <button class="weui-btn weui-btn_default popup-action sync-action" type="button" :disabled="isRefreshingRules" @click="refreshRemoteRules">{{ remoteLabel }}</button>
      </div>
    </section>

    <section class="weui-panel score-card">
      <div class="weui-cell section-heading score-heading">
        <h2>发帖评分</h2>
        <button class="weui-btn weui-btn_mini weui-btn_default health-action" :class="{ 'is-online': healthOnline }" type="button" aria-label="重新检测评分服务" @click="refreshHealth">{{ isChecking ? '检测中…' : healthLabel }}</button>
      </div>
      <div class="panel-actions score-actions">
        <button class="weui-btn weui-btn_primary popup-action primary-action" type="button" :disabled="isLaunchingComposer" @click="launchComposer">
          {{ isLaunchingComposer ? '正在打开…' : '打开评分浮窗' }}
        </button>
      </div>

      <details class="advanced-settings">
        <summary>评分服务 APIKEY</summary>
        <div class="settings-body">
          <label>API Key<input v-model="service.apiKey" class="weui-input" type="password" autocomplete="off" placeholder="复制后粘贴到这里" /></label>
          <div class="settings-actions">
            <button class="popup-action settings-action" type="button" :disabled="isOpeningApiKeyPage" @click="openApiKeyPage">{{ isOpeningApiKeyPage ? '打开中…' : '获取 APIKEY' }}</button>
            <button class="popup-action settings-action" type="button" :disabled="isSaving" @click="saveServiceSettings">{{ isSaving ? '保存中…' : '保存 APIKEY' }}</button>
          </div>
        </div>
      </details>
    </section>
  </main>
</template>
