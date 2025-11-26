import type { StorageManager } from './storageManager'
import type { ReportManager } from './reportManager'

/**
 * 推文处理类
 * 负责推文的过滤、隐藏和显示
 */
export class TweetProcessor {
  // 已处理的推文集合,避免重复处理
  private processedTweets = new WeakSet<Element>()
  // 用户名到显示名称的映射
  private userDisplayNames = new Map<string, string>()
  // 存储管理器引用
  private storageManager: StorageManager
  // 上报管理器引用
  private reportManager: ReportManager

  constructor(storageManager: StorageManager, reportManager: ReportManager) {
    this.storageManager = storageManager
    this.reportManager = reportManager
  }

  /**
   * 获取用户的显示名称
   */
  getUserDisplayName(element: Element, username: string): string {
    // 先检查缓存
    if (this.userDisplayNames.has(username)) {
      return this.userDisplayNames.get(username)!
    }

    // 尝试从推文中找到显示名称
    const userLinks = element.querySelectorAll('a[href*="/"]')

    for (const link of Array.from(userLinks)) {
      const href = link.getAttribute('href')
      if (href && href.match(new RegExp(`^/${username}$`))) {
        const parent = link.closest('[data-testid="User-Name"]')
        if (parent) {
          const spans = parent.querySelectorAll('span')
          for (const span of Array.from(spans)) {
            const text = span.textContent?.trim()
            // 过滤掉无效的显示名称：空字符串、@开头、用户名本身、单个特殊字符（如·）
            if (text &&
                !text.startsWith('@') &&
                text !== username &&
                text.length > 1 &&
                text !== '·') {
              this.userDisplayNames.set(username, text)
              return text
            }
          }

          const firstSpan = parent.querySelector('span')
          if (firstSpan) {
            const displayName = firstSpan.textContent?.trim()
            if (displayName &&
                displayName !== `@${username}` &&
                displayName.length > 1 &&
                displayName !== '·') {
              this.userDisplayNames.set(username, displayName)
              return displayName
            }
          }
        }
      }
    }

    return username
  }

  /**
   * 从推文元素获取用户名
   */
  getTweetUsername(element: Element): string | null {
    const userLinks = element.querySelectorAll('a[href*="/"]')

    for (const link of Array.from(userLinks)) {
      const href = link.getAttribute('href')
      if (!href) continue

      const match = href.match(/^\/([^/]+)$/)
      if (match) {
        return match[1]
      }
    }

    return null
  }

  /**
   * 获取推文文本内容
   */
  getTweetContent(element: Element): string {
    // 获取推文的文本内容
    const tweetTextElement = element.querySelector('[data-testid="tweetText"]')
    if (tweetTextElement) {
      return tweetTextElement.textContent || ''
    }
    return ''
  }

  /**
   * 检查推文内容是否包含过滤关键词（不区分大小写）
   */
  containsFilterKeyword(content: string): string | null {
    // 使用 storageManager 的关键词过滤方法，返回匹配到的具体关键词
    return this.storageManager.shouldFilterKeyword(content)
  }

  /**
   * 检查推文是否应该被过滤
   * @returns 返回过滤原因和类型: { type: '账户'|'关键词'|'用户名', value: string }
   * 优先级: 手动白名单 > 手动屏蔽 > WASM白名单 > WASM黑名单 > 关键词/用户名过滤
   * 注意: 白名单账号（手动+WASM）不受关键词和用户名过滤影响
   */
  shouldFilterTweet(element: Element): { type: string, value: string } | null {
    // 获取账号信息
    const username = this.getTweetUsername(element)

    if (username) {
      // 检查是否在账号白名单中（手动白名单 + WASM白名单）
      const isInAccountWhitelist = this.storageManager.isAccountWhitelisted(username)
      if (isInAccountWhitelist) {
        // 账号在白名单中，不进行任何过滤（包括关键词和用户名）
        return null
      }

      // 检查账号过滤（包括手动屏蔽和WASM黑名单）
      if (this.storageManager.shouldFilterAccount(username)) {
        // 保存显示名称
        this.getUserDisplayName(element, username)
        return { type: '账户', value: username }
      }

      // 检查用户名（显示名称）过滤
      const displayName = this.getUserDisplayName(element, username)
      const matchedUsername = this.storageManager.shouldFilterUsername(displayName)
      if (matchedUsername) {
        return { type: '用户名', value: matchedUsername }
      }
    }

    // 检查关键词过滤
    const content = this.getTweetContent(element)
    const keyword = this.containsFilterKeyword(content)
    if (keyword) {
      return { type: '关键词', value: keyword }
    }

    return null
  }

  /**
   * 检测主题
   */
  private detectTheme(): 'light' | 'dark' {
    try {
      const htmlStyle = window.getComputedStyle(document.documentElement)
      const colorScheme = htmlStyle.colorScheme || htmlStyle.getPropertyValue('color-scheme')

      if (colorScheme && colorScheme.includes('light')) {
        return 'light'
      }
    } catch (error) {
      console.log('[主题检测] 检测失败，使用默认暗色主题')
    }

    // 默认使用暗色主题
    return 'dark'
  }

  /**
   * 创建占位块元素
   */
  private createPlaceholder(filterType: string, filterValue: string): HTMLElement {
    const placeholder = document.createElement('div')
    placeholder.className = 'tweet-filter-placeholder'
    placeholder.setAttribute('data-filter-placeholder', 'true')

    // 根据主题设置颜色
    const theme = this.detectTheme()
    const bgColor = theme === 'dark' ? '#1e1e1e' : '#f7f9f9'
    const borderColor = theme === 'dark' ? '#2f2f2f' : '#eff3f4'
    const textColor = theme === 'dark' ? '#8b8b8b' : '#536471'
    const strongColor = theme === 'dark' ? '#b4b4b4' : '#0f1419'
    const btnTextColor = theme === 'dark' ? '#ffffff' : '#0f1419'

    placeholder.style.cssText = `
      padding: 8px 12px;
      margin: 4px 4px;
      background-color: ${bgColor};
      border: 1px solid ${borderColor};
      color: ${textColor};
      font-size: 12px;
      text-align: left;
      cursor: default;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `

    // 根据过滤类型格式化显示文本
    let messageText = ''
    if (filterType === '账户') {
      messageText = `检测到<strong style="color: ${strongColor};">${filterValue}</strong>账户疑似自动化运营账户或yapper达人，6551已为您自动屏蔽`
    } else if (filterType === '关键词') {
      messageText = `检测到内容包含敏感关键词<strong style="color: ${strongColor};">${filterValue}</strong>，6551已为您自动屏蔽`
    } else if (filterType === '用户名') {
      messageText = `检测到用户名包含敏感词<strong style="color: ${strongColor};">${filterValue}</strong>，6551已为您自动屏蔽`
    }

    placeholder.innerHTML = `
      <span>${messageText}</span>
      <div style="display: flex; gap: 8px; flex-shrink: 0; margin-left: 12px;">
        <span class="show-original-tweet" style="color: #409eff; cursor: pointer;">显示原文</span>
      </div>
    `

    // 添加"显示原文"点击事件
    const showBtn = placeholder.querySelector('.show-original-tweet')
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        // 找到被隐藏的推文并显示
        const hiddenTweet = placeholder.previousElementSibling
        if (hiddenTweet && hiddenTweet.getAttribute('data-filtered-user')) {
          const htmlElement = hiddenTweet as HTMLElement
          htmlElement.style.display = ''

          // 在时间戳旁边添加"设为白名单"按钮
          const timeElement = htmlElement.querySelector('time')
          if (timeElement) {
            const parentElement = timeElement.parentElement?.parentElement
            if (parentElement) {
              const whitelistBtn = document.createElement('img')
              whitelistBtn.className = 'whitelist-btn'
              whitelistBtn.src = chrome.runtime.getURL('white.png')

              whitelistBtn.style.cssText = `
                cursor: pointer;
                width: 16px;
                height: 16px;
                margin-left: 8px;
                vertical-align: middle;
              `
              whitelistBtn.title = '设为白名单(6551提供)'

              whitelistBtn.addEventListener('click', async (e) => {
                e.stopPropagation()
                e.preventDefault()

                try {
                  if (filterType === '账户') {
                    // 账户类型：发送误报反馈到 background
                    const result = await this.reportManager.handleFeedbackMisreport(filterValue)
                    if (result.success) {
                      alert(`已将账户 "${filterValue}" 加入白名单`)
                    } else {
                      alert(`反馈失败: ${result.error}`)
                      return
                    }
                  } else if (filterType === '关键词') {
                    // 关键词类型：添加到关键词白名单
                    const result = await chrome.storage.local.get(['manualWhitelistKeywords'])
                    const whitelist = result.manualWhitelistKeywords || []
                    if (!whitelist.includes(filterValue)) {
                      whitelist.push(filterValue)
                      await chrome.storage.local.set({ manualWhitelistKeywords: whitelist })
                    }
                    alert(`已将关键词 "${filterValue}" 加入白名单`)
                  } else if (filterType === '用户名') {
                    // 用户名类型：添加到用户名白名单
                    const result = await chrome.storage.local.get(['manualWhitelistUsernames'])
                    const whitelist = result.manualWhitelistUsernames || []
                    if (!whitelist.includes(filterValue)) {
                      whitelist.push(filterValue)
                      await chrome.storage.local.set({ manualWhitelistUsernames: whitelist })
                    }
                    alert(`已将用户名 "${filterValue}" 加入白名单`)
                  }

                  // 移除白名单按钮
                  whitelistBtn.remove()
                } catch (error) {
                  alert('加入白名单失败')
                  console.error('[推文过滤器] 加入白名单失败:', error)
                }
              })

              parentElement.appendChild(whitelistBtn)
            }
          }

          placeholder.remove()
        }
      })
    }

    return placeholder
  }

  /**
   * 隐藏推文元素并显示占位块
   */
  hideTweet(element: Element, filterType: string, filterValue: string): void {
    const htmlElement = element as HTMLElement

    // 检查是否已经添加了占位块
    const existingPlaceholder = htmlElement.nextElementSibling
    if (existingPlaceholder && existingPlaceholder.getAttribute('data-filter-placeholder') === 'true') {
      return
    }

    // 隐藏推文
    if (htmlElement.style.display !== 'none') {
      htmlElement.style.display = 'none'
      htmlElement.setAttribute('data-filtered-user', filterValue)
      htmlElement.setAttribute('data-filtered-type', filterType)

      // 始终显示占位块（清爽模式只隐藏右侧UI）
      const placeholder = this.createPlaceholder(filterType, filterValue)
      htmlElement.after(placeholder)

      // 增加拦截计数
      this.storageManager.incrementBlockCount()

      console.log(`[推文过滤器] 已隐藏推文 - 类型: ${filterType}, 值: ${filterValue}`)
    }
  }

  /**
   * 显示推文元素并移除占位块
   */
  showTweet(element: Element): void {
    const htmlElement = element as HTMLElement
    if (htmlElement.style.display === 'none' && htmlElement.getAttribute('data-filtered-user')) {
      htmlElement.style.display = ''
      htmlElement.removeAttribute('data-filtered-user')

      // 移除占位块
      const nextElement = htmlElement.nextElementSibling
      if (nextElement && nextElement.getAttribute('data-filter-placeholder') === 'true') {
        nextElement.remove()
      }
    }
  }

  /**
   * 显示指定用户的所有推文
   */
  showUserTweets(username: string): void {
    const allTweets = document.querySelectorAll('article[data-testid="tweet"][data-filtered-user]')

    allTweets.forEach(tweet => {
      const filteredUser = tweet.getAttribute('data-filtered-user')
      if (filteredUser === username) {
        this.showTweet(tweet)
        console.log(`[推文过滤器] 已显示推文 - 用户: ${username}`)
      }
    })

    // 从缓存中移除
    this.userDisplayNames.delete(username)
  }

  /**
   * 处理推文元素
   */
  processTweet(element: Element, forceUpdate = false): void {
    // 如果已经处理过且不是强制更新,跳过
    if (this.processedTweets.has(element) && !forceUpdate) {
      return
    }

    const filterResult = this.shouldFilterTweet(element)
    if (filterResult && this.storageManager.isFilterEnabled) {
      this.hideTweet(element, filterResult.type, filterResult.value)
      this.processedTweets.add(element)
    } else if (!this.storageManager.isFilterEnabled) {
      this.showTweet(element)
    } else {
      this.processedTweets.add(element)
    }
  }

  /**
   * 扫描并处理页面上的所有推文
   */
  scanAndFilterTweets(forceUpdate = false): void {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]')

    tweets.forEach(tweet => {
      this.processTweet(tweet, forceUpdate)
    })
  }

  /**
   * 清空已处理记录
   */
  clearProcessed(): void {
    // WeakSet 没有 clear 方法，但新版本可能有
    if ('clear' in this.processedTweets) {
      (this.processedTweets as any).clear()
    }
  }

  /**
   * 获取被过滤的用户统计
   * @returns Map<过滤键(type:value), { type, value, count }>
   */
  getFilteredUsers(): Map<string, { type: string, value: string, count: number }> {
    const filterCounts = new Map<string, { type: string, value: string, count: number }>()
    const hiddenTweets = document.querySelectorAll('article[data-testid="tweet"][data-filtered-user]')

    hiddenTweets.forEach(tweet => {
      const filterValue = tweet.getAttribute('data-filtered-user')
      const filterType = tweet.getAttribute('data-filtered-type')

      if (filterValue && filterType) {
        const key = `${filterType}:${filterValue}`
        const existing = filterCounts.get(key)

        if (existing) {
          existing.count++
        } else {
          filterCounts.set(key, { type: filterType, value: filterValue, count: 1 })
        }

        // 如果是账户类型，保存显示名称
        if (filterType === '账户' && !this.userDisplayNames.has(filterValue)) {
          this.getUserDisplayName(tweet, filterValue)
        }
      }
    })

    return filterCounts
  }

  /**
   * 获取用户显示名称
   */
  getUserDisplayNameFromCache(username: string): string {
    return this.userDisplayNames.get(username) || username
  }

  /**
   * 获取已过滤推文数量
   */
  getFilteredCount(): number {
    return document.querySelectorAll('article[data-testid="tweet"][data-filtered-user]').length
  }
}
