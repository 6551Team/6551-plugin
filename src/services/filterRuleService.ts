export type FilterRuleKind = 'account' | 'keyword' | 'username'
export type FilterRuleMode = 'blocked' | 'allowed'

export interface PatternRule {
  text: string
  isRegexp: boolean
}

export type StoredFilterRule = string | PatternRule

export const FILTER_RULE_STORAGE: Record<FilterRuleKind, Record<FilterRuleMode, string>> = {
  account: { blocked: 'manualBlockedAccounts', allowed: 'manualWhitelistAccounts' },
  keyword: { blocked: 'manualBlockedKeywords', allowed: 'manualWhitelistKeywords' },
  username: { blocked: 'manualBlockedUsernames', allowed: 'manualWhitelistUsernames' },
}

export const FILTER_RULE_LABELS: Record<FilterRuleKind, string> = {
  account: '账号',
  keyword: '关键词',
  username: '显示名称',
}

export interface FilterRuleState {
  account: Record<FilterRuleMode, StoredFilterRule[]>
  keyword: Record<FilterRuleMode, StoredFilterRule[]>
  username: Record<FilterRuleMode, StoredFilterRule[]>
}

export function ruleText(rule: StoredFilterRule): string {
  return typeof rule === 'string' ? rule : rule.text
}

export function ruleIsRegexp(rule: StoredFilterRule): boolean {
  return typeof rule !== 'string' && Boolean(rule.isRegexp)
}

function normalizeRuleValue(kind: FilterRuleKind, value: string): string {
  const trimmed = value.trim()
  return kind === 'account' ? trimmed.replace(/^@/, '').toLowerCase() : trimmed
}

function normalizeStoredList(
  kind: FilterRuleKind,
  mode: FilterRuleMode,
  value: unknown,
): StoredFilterRule[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): StoredFilterRule[] => {
    if (typeof item === 'string') {
      const text = normalizeRuleValue(kind, item)
      if (!text) return []
      if (mode === 'blocked' && kind !== 'account') {
        return [{ text, isRegexp: false }]
      }
      return [text]
    }

    if (item && typeof item === 'object' && 'text' in item) {
      const text = normalizeRuleValue(kind, String((item as PatternRule).text || ''))
      if (!text) return []
      if (mode === 'blocked' && kind !== 'account') {
        return [{ text, isRegexp: Boolean((item as PatternRule).isRegexp) }]
      }
      return [text]
    }

    return []
  })
}

export async function loadFilterRules(): Promise<FilterRuleState> {
  const keys = Object.values(FILTER_RULE_STORAGE).flatMap((group) => Object.values(group))
  const stored = await chrome.storage.local.get(keys)
  const state = {
    account: { blocked: [], allowed: [] },
    keyword: { blocked: [], allowed: [] },
    username: { blocked: [], allowed: [] },
  } as FilterRuleState

  for (const kind of Object.keys(FILTER_RULE_STORAGE) as FilterRuleKind[]) {
    for (const mode of ['blocked', 'allowed'] as FilterRuleMode[]) {
      const key = FILTER_RULE_STORAGE[kind][mode]
      state[kind][mode] = normalizeStoredList(kind, mode, stored[key])
    }
  }

  return state
}

function sameRule(
  rule: StoredFilterRule,
  text: string,
  isRegexp: boolean,
  kind: FilterRuleKind,
): boolean {
  const left = normalizeRuleValue(kind, ruleText(rule))
  const right = normalizeRuleValue(kind, text)
  return left === right && ruleIsRegexp(rule) === isRegexp
}

export async function addFilterRule(
  kind: FilterRuleKind,
  mode: FilterRuleMode,
  value: string,
  isRegexp = false,
): Promise<{ added: boolean; rules: FilterRuleState }> {
  const text = normalizeRuleValue(kind, value)
  if (!text) throw new Error('规则内容不能为空')

  const useRegexp = mode === 'blocked' && kind !== 'account' && isRegexp
  if (useRegexp) {
    try {
      new RegExp(text, 'i')
    } catch {
      throw new Error('正则表达式格式不正确')
    }
  }

  const rules = await loadFilterRules()
  const current = rules[kind][mode]
  if (current.some((rule) => sameRule(rule, text, useRegexp, kind))) {
    return { added: false, rules }
  }

  const nextRule: StoredFilterRule = mode === 'blocked' && kind !== 'account'
    ? { text, isRegexp: useRegexp }
    : text
  const oppositeMode: FilterRuleMode = mode === 'blocked' ? 'allowed' : 'blocked'
  const opposite = rules[kind][oppositeMode].filter((rule) => {
    return normalizeRuleValue(kind, ruleText(rule)) !== text
  })
  const next = [...current, nextRule]

  rules[kind][mode] = next
  rules[kind][oppositeMode] = opposite
  await chrome.storage.local.set({
    [FILTER_RULE_STORAGE[kind][mode]]: next,
    [FILTER_RULE_STORAGE[kind][oppositeMode]]: opposite,
  })

  return { added: true, rules }
}

export async function removeFilterRule(
  kind: FilterRuleKind,
  mode: FilterRuleMode,
  value: string,
  isRegexp = false,
): Promise<FilterRuleState> {
  const rules = await loadFilterRules()
  const next = rules[kind][mode].filter((rule) => !sameRule(rule, value, isRegexp, kind))
  rules[kind][mode] = next
  await chrome.storage.local.set({ [FILTER_RULE_STORAGE[kind][mode]]: next })
  return rules
}

export function filterTypeToRuleKind(filterType: string): FilterRuleKind | null {
  if (filterType === '账户') return 'account'
  if (filterType === '关键词') return 'keyword'
  if (filterType === '用户名') return 'username'
  return null
}

export async function openFilterControlCenter(): Promise<{ opened: boolean; createdTab: boolean }> {
  const response = await chrome.runtime.sendMessage({ type: 'OPEN_FILTER_CONTROL_CENTER' }) as {
    success?: boolean
    data?: { opened?: boolean; createdTab?: boolean }
    error?: string
  }
  if (!response?.success) throw new Error(response?.error || '无法打开 NewsLiquid 过滤设置')
  return {
    opened: Boolean(response.data?.opened),
    createdTab: Boolean(response.data?.createdTab),
  }
}
