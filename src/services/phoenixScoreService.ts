export const DEFAULT_PHOENIX_ENDPOINT = 'https://phoenix-score.6551.io'

export interface PhoenixProfile {
  handle: string
  name: string
  followers: number
  verified: boolean
}

export interface PhoenixDraft {
  text: string
  hasPhoto: boolean
  hasVideo: boolean
  hasLink: boolean
  isReply: boolean
  isQuote: boolean
}

export interface PhoenixSettings {
  endpoint: string
  apiKey: string
  profile: PhoenixProfile
  draft: PhoenixDraft
}

export interface PhoenixQuality {
  score: number
  level: string
  label: string
}

export interface PhoenixForecast {
  views: number
  views_low: number
  views_high: number
  likes: number
  replies: number
  retweets: number
  quotes: number
  spread: string
  spread_label: string
  lane: string
  lane_label: string
}

export interface PhoenixScoreResult {
  tweet_id: string
  author: string
  score: number
  weighted_score: number
  pred: number
  positive: number
  negative: number
  labels: {
    audience: string
    situation: string
    unit: string
    voice: string
    thickness: string
    spread: string
    lane: string
  }
  impulse: string
  review: string
  improve: string
  display: {
    quality: PhoenixQuality
    forecast: PhoenixForecast
    summary: string
    note: string
  } | null
  in_network: boolean
  mutual_follow: boolean
}

export interface PhoenixHealthResult {
  online: boolean
  ready: boolean
  service?: string
  version?: string
  model?: string
  endpoint: string
  error?: string
}

export interface PhoenixMessageResponse<T> {
  success: boolean
  data?: T
  error?: string
  status?: number
}

export const DEFAULT_PHOENIX_PROFILE: PhoenixProfile = {
  handle: '',
  name: '',
  followers: 0,
  verified: false,
}

export const DEFAULT_PHOENIX_DRAFT: PhoenixDraft = {
  text: '',
  hasPhoto: false,
  hasVideo: false,
  hasLink: false,
  isReply: false,
  isQuote: false,
}

function extensionStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function extensionRuntimeAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
}

export function normalizePhoenixEndpoint(value?: string): string {
  const endpoint = (value || DEFAULT_PHOENIX_ENDPOINT).trim().replace(/\/+$/, '')
  return endpoint || DEFAULT_PHOENIX_ENDPOINT
}

function localStorageSettings(): Partial<PhoenixSettings> {
  try {
    return JSON.parse(localStorage.getItem('phoenixScoreSettings') || '{}') as Partial<PhoenixSettings>
  } catch {
    return {}
  }
}

export async function loadPhoenixSettings(): Promise<PhoenixSettings> {
  let source: Record<string, unknown> = {}

  if (extensionStorageAvailable()) {
    source = await chrome.storage.local.get([
      'phoenixScoreApiKey',
      'phoenixProfile',
      'phoenixDraft',
    ])
  } else {
    const saved = localStorageSettings()
    source = {
      phoenixScoreApiKey: saved.apiKey,
      phoenixProfile: saved.profile,
      phoenixDraft: saved.draft,
    }
  }

  return {
    endpoint: DEFAULT_PHOENIX_ENDPOINT,
    apiKey: String(source.phoenixScoreApiKey || ''),
    profile: {
      ...DEFAULT_PHOENIX_PROFILE,
      ...((source.phoenixProfile as Partial<PhoenixProfile> | undefined) || {}),
    },
    draft: {
      ...DEFAULT_PHOENIX_DRAFT,
      ...((source.phoenixDraft as Partial<PhoenixDraft> | undefined) || {}),
    },
  }
}

export async function savePhoenixSettings(settings: Partial<PhoenixSettings>): Promise<void> {
  const current = await loadPhoenixSettings()
  const merged: PhoenixSettings = {
    endpoint: DEFAULT_PHOENIX_ENDPOINT,
    apiKey: settings.apiKey ?? current.apiKey,
    profile: { ...current.profile, ...(settings.profile || {}) },
    draft: { ...current.draft, ...(settings.draft || {}) },
  }

  if (extensionStorageAvailable()) {
    await chrome.storage.local.set({
      phoenixScoreEndpoint: merged.endpoint,
      phoenixScoreApiKey: merged.apiKey,
      phoenixProfile: merged.profile,
      phoenixDraft: merged.draft,
    })
    return
  }

  localStorage.setItem('phoenixScoreSettings', JSON.stringify(merged))
}

async function runtimeMessage<T>(type: string, data?: unknown): Promise<PhoenixMessageResponse<T>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response: PhoenixMessageResponse<T>) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string; message?: string }
    return body.detail || body.message || `请求失败 (${response.status})`
  } catch {
    return `请求失败 (${response.status})`
  }
}

function applyPhoenixAuth(headers: Headers, apiKey: string): void {
  const token = apiKey.trim()
  if (token) headers.set('Authorization', `Bearer ${token}`)
}

async function directHealth(endpoint: string, apiKey = ''): Promise<PhoenixMessageResponse<PhoenixHealthResult>> {
  try {
    const headers = new Headers()
    applyPhoenixAuth(headers, apiKey)
    const healthResponse = await fetch(`${endpoint}/health`, { headers })

    if (!healthResponse.ok) {
      return { success: false, error: await parseError(healthResponse), status: healthResponse.status }
    }

    const health = await healthResponse.json() as { service?: string; version?: string }

    return {
      success: true,
      data: {
        online: true,
        ready: true,
        service: health.service,
        version: health.version,
        endpoint,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法连接评分服务',
    }
  }
}

export async function checkPhoenixHealth(): Promise<PhoenixHealthResult> {
  const settings = await loadPhoenixSettings()
  const response = extensionRuntimeAvailable()
    ? await runtimeMessage<PhoenixHealthResult>('PHOENIX_HEALTH')
    : await directHealth(settings.endpoint, settings.apiKey)

  if (!response.success || !response.data) {
    return {
      online: false,
      ready: false,
      endpoint: settings.endpoint,
      error: response.error || '无法连接评分服务',
    }
  }

  return response.data
}

export async function scorePhoenixDraft(
  profile: PhoenixProfile,
  draft: PhoenixDraft,
): Promise<PhoenixScoreResult> {
  const payload = {
    id: `preview-${Date.now()}`,
    text: draft.text.trim(),
    author: profile.handle.replace(/^@/, '') || profile.name || 'me',
    author_name: profile.name || profile.handle.replace(/^@/, '') || '我的账号',
    followers: Math.max(0, Number(profile.followers) || 0),
    verified: Boolean(profile.verified),
    created_at: new Date().toISOString(),
    has_photo: draft.hasPhoto,
    has_video: draft.hasVideo,
    has_link: draft.hasLink || /https?:\/\//i.test(draft.text),
    is_reply: draft.isReply,
    is_quote: draft.isQuote,
    is_retweet: false,
    in_network: true,
    mutual_follow: false,
    include_heads: false,
    include_observed: false,
  }

  if (extensionRuntimeAvailable()) {
    const response = await runtimeMessage<PhoenixScoreResult>('PHOENIX_SCORE', payload)
    if (!response.success || !response.data) {
      throw new Error(response.error || '评分失败')
    }
    return response.data
  }

  const settings = await loadPhoenixSettings()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  applyPhoenixAuth(headers, settings.apiKey)
  const response = await fetch(`${settings.endpoint}/v1/score`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<PhoenixScoreResult>
}

export async function openComposerAssistant(): Promise<{ opened: boolean; createdTab: boolean }> {
  if (!extensionRuntimeAvailable()) {
    window.open('https://x.com/compose/post', '_blank', 'noopener,noreferrer')
    return { opened: false, createdTab: true }
  }

  const response = await runtimeMessage<{ opened: boolean; createdTab: boolean }>('OPEN_COMPOSER_ASSISTANT')
  if (!response.success || !response.data) {
    throw new Error(response.error || '无法打开 X 发帖助手')
  }
  return response.data
}
