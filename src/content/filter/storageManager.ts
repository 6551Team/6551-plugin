import { hasAccount, hasWhiteAccount, hasWord, hasHandle, getAccountCount, getWordCount, getHandleCount, isWasmLoaded } from '../../services/wasmService'

// 过滤项类型
interface FilterItem {
  text: string
  isRegexp: boolean
}

/**
 * 存储管理类
 * 负责加载和监听过滤账号列表和关键词列表
 */
export class StorageManager {
  // 手动上报的账号列表
  public manualBlockedAccounts: string[] = []
  // 手动不屏蔽的账号列表(白名单)
  public manualWhitelistAccounts: string[] = []
  // 手动上报的关键词列表
  public manualBlockedKeywords: FilterItem[] = []
  // 关键词白名单
  public manualWhitelistKeywords: string[] = []
  // 手动上报的用户名列表
  public manualBlockedUsernames: FilterItem[] = []
  // 用户名白名单
  public manualWhitelistUsernames: string[] = []
  // 是否启用过滤
  public isFilterEnabled = true
  // 账号过滤开关
  public accountFilterEnabled = true
  // 关键词过滤开关
  public keywordFilterEnabled = true
  // 用户名过滤开关
  public usernameFilterEnabled = true
  // 是否显示屏蔽数据UI（清爽模式默认开启，即默认隐藏右侧UI）
  public showBlockUI = false
  // 总拦截数量
  public totalBlockCount = 0

  // 存储变化回调
  private onStorageChangeCallback?: () => void

  /**
   * 加载配置数据
   */
  async loadFilterAccounts(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'isEnabled',
        'accountFilterEnabled',
        'keywordFilterEnabled',
        'usernameFilterEnabled',
        'showBlockUI',
        'manualBlockedAccounts',
        'manualWhitelistAccounts',
        'manualBlockedKeywords',
        'manualWhitelistKeywords',
        'manualBlockedUsernames',
        'manualWhitelistUsernames',
        'totalBlockCount'
      ])

      if (result.manualBlockedAccounts) {
        this.manualBlockedAccounts = Array.isArray(result.manualBlockedAccounts)
          ? result.manualBlockedAccounts
          : Object.values(result.manualBlockedAccounts)
        console.log(`[推文过滤器] 已加载 ${this.manualBlockedAccounts.length} 个手动上报账号`)
      }

      if (result.manualWhitelistAccounts) {
        this.manualWhitelistAccounts = Array.isArray(result.manualWhitelistAccounts)
          ? result.manualWhitelistAccounts
          : Object.values(result.manualWhitelistAccounts)
        console.log(`[推文过滤器] 已加载 ${this.manualWhitelistAccounts.length} 个手动不屏蔽账号`)
      }

      if (result.manualBlockedKeywords) {
        const rawKeywords = Array.isArray(result.manualBlockedKeywords)
          ? result.manualBlockedKeywords
          : Object.values(result.manualBlockedKeywords)
        // 兼容旧格式 string[] 和新格式 FilterItem[]
        this.manualBlockedKeywords = rawKeywords.map((item: any) => {
          if (typeof item === 'string') {
            return { text: item, isRegexp: false }
          }
          return item as FilterItem
        })
        console.log(`[推文过滤器] 已加载 ${this.manualBlockedKeywords.length} 个手动过滤关键词`)
      }

      if (result.manualWhitelistKeywords) {
        this.manualWhitelistKeywords = Array.isArray(result.manualWhitelistKeywords)
          ? result.manualWhitelistKeywords
          : Object.values(result.manualWhitelistKeywords)
        console.log(`[推文过滤器] 已加载 ${this.manualWhitelistKeywords.length} 个关键词白名单`)
      }

      if (result.manualBlockedUsernames) {
        const rawUsernames = Array.isArray(result.manualBlockedUsernames)
          ? result.manualBlockedUsernames
          : Object.values(result.manualBlockedUsernames)
        // 兼容旧格式 string[] 和新格式 FilterItem[]
        this.manualBlockedUsernames = rawUsernames.map((item: any) => {
          if (typeof item === 'string') {
            return { text: item, isRegexp: false }
          }
          return item as FilterItem
        })
        console.log(`[推文过滤器] 已加载 ${this.manualBlockedUsernames.length} 个手动过滤用户名`)
      }

      if (result.manualWhitelistUsernames) {
        this.manualWhitelistUsernames = Array.isArray(result.manualWhitelistUsernames)
          ? result.manualWhitelistUsernames
          : Object.values(result.manualWhitelistUsernames)
        console.log(`[推文过滤器] 已加载 ${this.manualWhitelistUsernames.length} 个用户名白名单`)
      }

      this.isFilterEnabled = result.isEnabled !== undefined ? result.isEnabled : true
      this.accountFilterEnabled = result.accountFilterEnabled !== undefined ? result.accountFilterEnabled : true
      this.keywordFilterEnabled = result.keywordFilterEnabled !== undefined ? result.keywordFilterEnabled : true
      this.usernameFilterEnabled = result.usernameFilterEnabled !== undefined ? result.usernameFilterEnabled : true
      this.showBlockUI = result.showBlockUI !== undefined ? result.showBlockUI : false
      this.totalBlockCount = result.totalBlockCount || 0
      console.log(`[推文过滤器] 总拦截数量: ${this.totalBlockCount}`)

      // 保存WASM计数到storage供Dashboard使用
      if (isWasmLoaded()) {
        const accountCount = getAccountCount()
        const keywordCount = getWordCount()
        const handleCount = getHandleCount()
        console.log(`[推文过滤器] WASM账号数量: ${accountCount}`)
        console.log(`[推文过滤器] WASM关键词数量: ${keywordCount}`)
        console.log(`[推文过滤器] WASM用户名数量: ${handleCount}`)

        await chrome.storage.local.set({
          wasmAccountCount: accountCount,
          wasmKeywordCount: keywordCount,
          wasmHandleCount: handleCount
        })
      }
    } catch (error) {
      console.error('[推文过滤器] 加载配置失败:', error)
    }
  }

  /**
   * 增加拦截计数
   */
  async incrementBlockCount(): Promise<void> {
    this.totalBlockCount++
    try {
      await chrome.storage.local.set({ totalBlockCount: this.totalBlockCount })
    } catch (error) {
      console.error('[推文过滤器] 保存拦截计数失败:', error)
    }
  }

  /**
   * 监听存储变化
   */
  setupStorageListener(callback: () => void): void {
    this.onStorageChangeCallback = callback

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        let hasChanges = false

        if (changes.manualBlockedAccounts) {
          const newValue = changes.manualBlockedAccounts.newValue || []
          this.manualBlockedAccounts = Array.isArray(newValue) ? newValue : Object.values(newValue)
          console.log(`[推文过滤器] 手动上报列表已更新，共 ${this.manualBlockedAccounts.length} 个账号`)
          hasChanges = true
        }

        if (changes.manualWhitelistAccounts) {
          const newValue = changes.manualWhitelistAccounts.newValue || []
          this.manualWhitelistAccounts = Array.isArray(newValue) ? newValue : Object.values(newValue)
          console.log(`[推文过滤器] 手动不屏蔽列表已更新，共 ${this.manualWhitelistAccounts.length} 个账号`)
          hasChanges = true
        }

        if (changes.manualBlockedKeywords) {
          const newValue = changes.manualBlockedKeywords.newValue || []
          const rawKeywords = Array.isArray(newValue) ? newValue : Object.values(newValue)
          this.manualBlockedKeywords = rawKeywords.map((item: any) => {
            if (typeof item === 'string') {
              return { text: item, isRegexp: false }
            }
            return item as FilterItem
          })
          console.log(`[推文过滤器] 手动过滤关键词已更新，共 ${this.manualBlockedKeywords.length} 个关键词`)
          hasChanges = true
        }

        if (changes.manualWhitelistKeywords) {
          const newValue = changes.manualWhitelistKeywords.newValue || []
          this.manualWhitelistKeywords = Array.isArray(newValue) ? newValue : Object.values(newValue)
          console.log(`[推文过滤器] 关键词白名单已更新，共 ${this.manualWhitelistKeywords.length} 个关键词`)
          hasChanges = true
        }

        if (changes.manualBlockedUsernames) {
          const newValue = changes.manualBlockedUsernames.newValue || []
          const rawUsernames = Array.isArray(newValue) ? newValue : Object.values(newValue)
          this.manualBlockedUsernames = rawUsernames.map((item: any) => {
            if (typeof item === 'string') {
              return { text: item, isRegexp: false }
            }
            return item as FilterItem
          })
          console.log(`[推文过滤器] 手动过滤用户名已更新，共 ${this.manualBlockedUsernames.length} 个用户名`)
          hasChanges = true
        }

        if (changes.manualWhitelistUsernames) {
          const newValue = changes.manualWhitelistUsernames.newValue || []
          this.manualWhitelistUsernames = Array.isArray(newValue) ? newValue : Object.values(newValue)
          console.log(`[推文过滤器] 用户名白名单已更新，共 ${this.manualWhitelistUsernames.length} 个用户名`)
          hasChanges = true
        }

        if (changes.isEnabled) {
          this.isFilterEnabled = changes.isEnabled.newValue
          console.log(`[推文过滤器] 过滤状态已更新: ${this.isFilterEnabled ? '启用' : '禁用'}`)
          hasChanges = true
        }

        if (changes.accountFilterEnabled) {
          this.accountFilterEnabled = changes.accountFilterEnabled.newValue
          console.log(`[推文过滤器] 账号过滤已更新: ${this.accountFilterEnabled ? '启用' : '禁用'}`)
          hasChanges = true
        }

        if (changes.keywordFilterEnabled) {
          this.keywordFilterEnabled = changes.keywordFilterEnabled.newValue
          console.log(`[推文过滤器] 关键词过滤已更新: ${this.keywordFilterEnabled ? '启用' : '禁用'}`)
          hasChanges = true
        }

        if (changes.usernameFilterEnabled) {
          this.usernameFilterEnabled = changes.usernameFilterEnabled.newValue
          console.log(`[推文过滤器] 用户名过滤已更新: ${this.usernameFilterEnabled ? '启用' : '禁用'}`)
          hasChanges = true
        }

        if (changes.showBlockUI) {
          this.showBlockUI = Boolean(changes.showBlockUI.newValue)
          console.log(`[推文过滤器] 页面入口已更新: ${this.showBlockUI ? '显示' : '隐藏'}`)
          hasChanges = true
        }

        if (changes.totalBlockCount) {
          this.totalBlockCount = changes.totalBlockCount.newValue || 0
          console.log(`[推文过滤器] 拦截计数已更新: ${this.totalBlockCount}`)
          hasChanges = true
        }

        if (hasChanges && this.onStorageChangeCallback) {
          this.onStorageChangeCallback()
        }
      }
    })
  }

  /**
   * 检查账号是否在白名单中（手动白名单 + WASM白名单）
   */
  isAccountWhitelisted(username: string): boolean {
    const cleanUsername = username.replace(/^@/, '').toLowerCase()

    // 检查手动白名单
    const isManualWhitelisted = this.manualWhitelistAccounts.some((account) => (
      account.replace(/^@/, '').toLowerCase() === cleanUsername
    ))
    if (isManualWhitelisted) {
      return true
    }

    // 检查WASM白名单
    if (isWasmLoaded() && hasWhiteAccount(cleanUsername)) {
      return true
    }

    return false
  }

  /**
   * 检查账号是否应该被过滤
   * 优先级: 手动白名单 > 手动屏蔽 > WASM白名单 > WASM黑名单
   */
  shouldFilterAccount(username: string): boolean {
    // 检查账号过滤是否启用
    if (!this.accountFilterEnabled) {
      return false
    }

    const cleanUsername = username.replace(/^@/, '').toLowerCase()

    // 1. 检查手动白名单（优先级最高）
    const isManualWhitelisted = this.manualWhitelistAccounts.some((account) => (
      account.replace(/^@/, '').toLowerCase() === cleanUsername
    ))
    if (isManualWhitelisted) {
      return false
    }

    // 2. 检查手动屏蔽列表
    const isManualBlocked = this.manualBlockedAccounts.some((account) => (
      account.replace(/^@/, '').toLowerCase() === cleanUsername
    ))
    if (isManualBlocked) {
      return true
    }

    // 3. 检查WASM白名单
    if (isWasmLoaded() && hasWhiteAccount(cleanUsername)) {
      return false
    }

    // 4. 检查WASM黑名单
    if (isWasmLoaded() && hasAccount(cleanUsername)) {
      return true
    }

    return false
  }

  /**
   * 检查关键词是否应该被过滤
   * @returns 返回匹配到的关键词，如果没有匹配则返回null
   */
  shouldFilterKeyword(keyword: string): string | null {
    // 检查关键词过滤是否启用
    if (!this.keywordFilterEnabled) {
      return null
    }

    // 检查是否在白名单中(优先级最高)
    const keywordLower = keyword.toLowerCase()
    for (const whiteKeyword of this.manualWhitelistKeywords) {
      if (keywordLower.includes(whiteKeyword.toLowerCase())) {
        return null
      }
    }

    // 检查WASM过滤列表
    if (isWasmLoaded()) {
      const matchedWord = hasWord(keyword)
      if (matchedWord) {
        return matchedWord
      }
    }

    // 检查手动过滤列表
    for (const filterItem of this.manualBlockedKeywords) {
      const filterKeywordLower = filterItem.text.toLowerCase()

      if (filterItem.isRegexp) {
        // 正则表达式匹配
        try {
          const regex = new RegExp(filterItem.text, 'i')
          if (regex.test(keyword)) {
            return filterItem.text
          }
        } catch (e) {
          console.error('[推文过滤器] 正则表达式错误:', filterItem.text, e)
        }
      } else {
        // 检查是否是组合关键词（包含逗号）
        if (filterKeywordLower.includes(',')) {
          // 分割组合关键词，去除空格
          const parts = filterKeywordLower.split(',').map(p => p.trim()).filter(p => p.length > 0)
          // 检查是否所有部分都命中
          const allMatched = parts.every(part => keywordLower.includes(part))
          if (allMatched) {
            return filterItem.text
          }
        } else {
          // 单个关键词直接匹配
          if (keywordLower.includes(filterKeywordLower)) {
            return filterItem.text
          }
        }
      }
    }

    return null
  }

  /**
   * 检查用户名是否应该被过滤
   * @returns 返回匹配到的用户名关键词，如果没有匹配则返回null
   */
  shouldFilterUsername(username: string): string | null {
    // 检查用户名过滤是否启用
    if (!this.usernameFilterEnabled) {
      return null
    }

    // 检查是否在白名单中(优先级最高)
    const usernameLower = username.toLowerCase()
    for (const whiteUsername of this.manualWhitelistUsernames) {
      if (usernameLower.includes(whiteUsername.toLowerCase())) {
        return null
      }
    }

    // 检查系统用户名过滤列表 (handle.json)
    if (isWasmLoaded()) {
      const matchedHandle = hasHandle(username)
      if (matchedHandle) {
        return matchedHandle
      }
    }

    // 检查手动过滤列表
    for (const filterItem of this.manualBlockedUsernames) {
      const filterUsernameLower = filterItem.text.toLowerCase()

      if (filterItem.isRegexp) {
        // 正则表达式匹配
        try {
          const regex = new RegExp(filterItem.text, 'i')
          if (regex.test(username)) {
            return filterItem.text
          }
        } catch (e) {
          console.error('[推文过滤器] 正则表达式错误:', filterItem.text, e)
        }
      } else {
        // 检查是否是组合用户名（包含逗号）
        if (filterUsernameLower.includes(',')) {
          // 分割组合用户名，去除空格
          const parts = filterUsernameLower.split(',').map(p => p.trim()).filter(p => p.length > 0)
          // 检查是否所有部分都命中
          const allMatched = parts.every(part => usernameLower.includes(part))
          if (allMatched) {
            return filterItem.text
          }
        } else {
          // 单个用户名直接匹配
          if (usernameLower.includes(filterUsernameLower)) {
            return filterItem.text
          }
        }
      }
    }

    return null
  }

  /**
   * 更新过滤启用状态
   */
  async updateFilterEnabled(enabled: boolean): Promise<void> {
    this.isFilterEnabled = enabled
    await chrome.storage.local.set({ isEnabled: enabled })
  }
}
