import type { StorageManager } from './storageManager'

interface FilterResult {
  type: '账户' | '关键词' | '用户名'
  value: string
}

type PresentationState =
  | 'timeline'
  | 'timeline-revealed'
  | 'reply-summary'
  | 'reply-hidden'
  | 'reply-revealed-summary'
  | 'reply-revealed'

/**
 * 读取并过滤 X 推文。时间线为每条命中内容保留紧凑占位，
 * 推文详情页则把被过滤回复汇总为一条可恢复提示。
 */
export class TweetProcessor {
  private static readonly STYLE_ID = 'newsliquid-filter-placeholder-style'
  private static readonly REPLY_AGGREGATE_ID = 'newsliquid-reply-aggregate-host'

  private processedTweets = new WeakSet<Element>()
  private userDisplayNames = new Map<string, string>()
  private hiddenTargets = new WeakMap<Element, HTMLElement>()
  private originalDisplay = new WeakMap<HTMLElement, string>()
  private presentationRefreshQueued = false
  private revealedReplyThreadPath: string | null = null

  constructor(private storageManager: StorageManager) {}

  private getElementText(element: Element): string {
    const parts: string[] = []
    const collect = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent || '')
        return
      }
      if (!(node instanceof Element)) return
      if (node instanceof HTMLImageElement) {
        parts.push(node.alt || node.getAttribute('aria-label') || node.title || '')
        return
      }
      node.childNodes.forEach(collect)
    }
    collect(element)
    return parts.join('').trim()
  }

  getTweetUsername(element: Element): string | null {
    const userName = element.querySelector('[data-testid="User-Name"]')
    const profileLinks = userName?.querySelectorAll<HTMLAnchorElement>('a[href]') || []
    for (const link of Array.from(profileLinks)) {
      const match = link.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)$/)
      if (match) return match[1]
    }

    const statusLink = element.querySelector<HTMLAnchorElement>('a[href*="/status/"]')
    return statusLink?.getAttribute('href')?.match(/^\/([^/]+)\/status\/\d+/)?.[1] || null
  }

  getUserDisplayName(element: Element, username: string): string {
    const cached = this.userDisplayNames.get(username)
    if (cached) return cached

    const userName = element.querySelector('[data-testid="User-Name"]')
    if (userName) {
      for (const span of Array.from(userName.querySelectorAll('span'))) {
        const text = this.getElementText(span)
        if (text && !text.startsWith('@') && text !== username && text !== '·' && text.length > 1) {
          this.userDisplayNames.set(username, text)
          return text
        }
      }
    }
    return username
  }

  getTweetContent(element: Element): string {
    const tweetText = element.querySelector('[data-testid="tweetText"]')
    return tweetText ? this.getElementText(tweetText) : ''
  }

  private shouldFilterTweet(element: Element): FilterResult | null {
    const username = this.getTweetUsername(element)
    if (username) {
      if (this.storageManager.shouldFilterAccount(username)) {
        this.getUserDisplayName(element, username)
        return { type: '账户', value: username }
      }

      if (this.storageManager.isAccountWhitelisted(username)) return null

      const displayName = this.getUserDisplayName(element, username)
      const matchedUsername = this.storageManager.shouldFilterUsername(displayName)
      if (matchedUsername) return { type: '用户名', value: matchedUsername }
    }

    const matchedKeyword = this.storageManager.shouldFilterKeyword(this.getTweetContent(element))
    return matchedKeyword ? { type: '关键词', value: matchedKeyword } : null
  }

  private getHideTarget(element: Element): HTMLElement {
    return element.closest<HTMLElement>('[data-testid="cellInnerDiv"]') || element as HTMLElement
  }

  private ensurePresentationStyles(): void {
    if (document.getElementById(TweetProcessor.STYLE_ID)) return

    const style = document.createElement('style')
    style.id = TweetProcessor.STYLE_ID
    style.textContent = `
      [data-newsliquid-filter-state="timeline"],
      [data-newsliquid-filter-state="timeline-revealed"],
      [data-newsliquid-filter-state="reply-summary"],
      [data-newsliquid-filter-state="reply-revealed-summary"],
      [data-newsliquid-filter-state="reply-revealed"] {
        display: block !important;
      }

      [data-newsliquid-filter-state="timeline"] > :not(.nl-filter-placeholder):not(.nl-reply-aggregate-host),
      [data-newsliquid-filter-state="reply-summary"] > :not(.nl-filter-placeholder) {
        display: none !important;
      }

      [data-newsliquid-filter-state="reply-hidden"] {
        display: none !important;
      }

      .nl-reply-aggregate-host {
        display: block;
        width: 100%;
      }

      .nl-filter-placeholder {
        box-sizing: border-box;
        min-height: 44px;
        width: 100%;
        padding: 7px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: #6f6b78;
        background: #ffffff;
        border-bottom: 1px solid rgba(35, 31, 48, 0.10);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.35;
      }

      .nl-filter-placeholder[data-revealed="true"] {
        background: #faf9fd;
      }

      .nl-filter-placeholder[data-theme="dark"] {
        color: #a9a5b2;
        background: #000000;
        border-bottom-color: rgba(255, 255, 255, 0.11);
      }

      .nl-filter-placeholder[data-theme="dark"][data-revealed="true"] {
        background: #111015;
      }

      .nl-filter-placeholder__message {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nl-filter-placeholder__brand {
        color: #35313f;
        font-weight: 650;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__brand {
        color: #f2eff8;
      }

      .nl-filter-placeholder__count {
        margin: 0 2px;
        color: #6d55e7;
        font-size: 14px;
        font-weight: 750;
        font-variant-numeric: tabular-nums;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__count {
        color: #a995ff;
      }

      .nl-filter-placeholder__button {
        box-sizing: border-box;
        min-width: 52px;
        min-height: 30px;
        flex: 0 0 auto;
        padding: 5px 12px;
        border: 0;
        border-radius: 999px;
        color: #5e47d2;
        background: #eeebff;
        font: inherit;
        font-weight: 650;
        line-height: 20px;
        cursor: pointer;
      }

      .nl-filter-placeholder__actions {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
      }

      .nl-filter-placeholder__button--secondary {
        min-width: auto;
        padding-inline: 8px;
        color: #6f6b78;
        background: transparent;
      }

      .nl-filter-placeholder__button--secondary:hover {
        color: #5e47d2;
        background: #f3f1fb;
      }

      .nl-filter-placeholder__button:disabled {
        cursor: wait;
        opacity: 0.58;
      }

      .nl-filter-placeholder__button:hover {
        background: #e3defe;
      }

      .nl-filter-placeholder__button:focus-visible {
        outline: 2px solid #6d55e7;
        outline-offset: 2px;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__button {
        color: #c9beff;
        background: #29243f;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__button--secondary {
        color: #a9a5b2;
        background: transparent;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__button--secondary:hover {
        color: #c9beff;
        background: #211d31;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__button:hover {
        background: #342d50;
      }

      .nl-filter-placeholder__button.nl-filter-placeholder__button--secondary:hover {
        color: #5e47d2;
        background: #f3f1fb;
      }

      .nl-filter-placeholder[data-theme="dark"] .nl-filter-placeholder__button.nl-filter-placeholder__button--secondary:hover {
        color: #c9beff;
        background: #211d31;
      }

      @media (max-width: 420px) {
        .nl-filter-placeholder {
          padding-inline: 12px;
        }
      }
    `
    ;(document.head || document.documentElement).appendChild(style)
  }

  private getTheme(): 'light' | 'dark' {
    const elements = [document.body, document.documentElement]
    for (const element of elements) {
      const color = getComputedStyle(element).backgroundColor
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (!match || match[4] === '0') continue
      const luminance = Number(match[1]) * 0.299 + Number(match[2]) * 0.587 + Number(match[3]) * 0.114
      return luminance < 128 ? 'dark' : 'light'
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  private getDirectPlaceholder(target: HTMLElement): HTMLElement | null {
    return Array.from(target.children).find((child) => child.classList.contains('nl-filter-placeholder')) as HTMLElement | undefined || null
  }

  private restoreOriginalTargetDisplay(target: HTMLElement): void {
    const display = this.originalDisplay.get(target)
    if (display) target.style.setProperty('display', display)
    else target.style.removeProperty('display')
  }

  private clearTargetPresentation(target: HTMLElement): void {
    this.getDirectPlaceholder(target)?.remove()
    target.removeAttribute('data-newsliquid-filter-state')
    this.restoreOriginalTargetDisplay(target)
    this.originalDisplay.delete(target)
  }

  private setPresentationState(target: HTMLElement, state: PresentationState): void {
    target.setAttribute('data-newsliquid-filter-state', state)
    if (state === 'reply-hidden') {
      target.style.setProperty('display', 'none', 'important')
    } else {
      this.restoreOriginalTargetDisplay(target)
    }
    if (state === 'reply-hidden' || state === 'reply-revealed') this.getDirectPlaceholder(target)?.remove()
  }

  private getFilteredTweetsInTarget(target: HTMLElement): HTMLElement[] {
    const selector = 'article[data-testid="tweet"][data-filtered-user]'
    const tweets = Array.from(target.querySelectorAll<HTMLElement>(selector))
    if (target.matches(selector)) tweets.unshift(target)
    return Array.from(new Set(tweets))
  }

  private isRevealed(tweet: Element): boolean {
    return tweet.getAttribute('data-newsliquid-revealed') === 'true'
  }

  private targetHasHiddenTweets(target: HTMLElement): boolean {
    return this.getFilteredTweetsInTarget(target).some((tweet) => !this.isRevealed(tweet))
  }

  private targetHasRevealedTweets(target: HTMLElement): boolean {
    return this.getFilteredTweetsInTarget(target).some((tweet) => this.isRevealed(tweet))
  }

  private getActionTargets(target: HTMLElement, state: PresentationState): HTMLElement[] {
    if (state === 'reply-summary') {
      return this.getFilteredReplyTargets().filter((replyTarget) => this.targetHasHiddenTweets(replyTarget))
    }
    if (state === 'reply-revealed-summary') {
      return this.getFilteredReplyTargets().filter((replyTarget) => (
        !this.targetHasHiddenTweets(replyTarget) && this.targetHasRevealedTweets(replyTarget)
      ))
    }
    return [target]
  }

  private createPlaceholder(
    target: HTMLElement,
    state: 'timeline' | 'timeline-revealed' | 'reply-summary' | 'reply-revealed-summary',
    count = 1,
  ): void {
    this.setPresentationState(target, state)

    const presentationKey = `${state}:${count}`
    const current = this.getDirectPlaceholder(target)
    if (current?.dataset.presentationKey === presentationKey) {
      current.dataset.theme = this.getTheme()
      if (state.includes('revealed') && target.firstElementChild !== current) target.prepend(current)
      return
    }
    current?.remove()

    const placeholder = document.createElement('div')
    placeholder.className = 'nl-filter-placeholder'
    placeholder.dataset.theme = this.getTheme()
    placeholder.dataset.revealed = state.includes('revealed') ? 'true' : 'false'
    placeholder.dataset.presentationKey = presentationKey

    const message = document.createElement('div')
    message.className = 'nl-filter-placeholder__message'
    message.setAttribute('role', 'status')

    const brand = document.createElement('span')
    brand.className = 'nl-filter-placeholder__brand'
    brand.textContent = 'NewsLiquid '
    message.appendChild(brand)

    if (state === 'reply-summary' || state === 'reply-revealed-summary') {
      message.append(state === 'reply-summary' ? '已帮你屏蔽 ' : '正在显示 ')
      const countText = document.createElement('strong')
      countText.className = 'nl-filter-placeholder__count'
      countText.textContent = String(count)
      message.append(countText, state === 'reply-summary' ? ' 条回复' : ' 条已屏蔽回复')
    } else if (state === 'timeline-revealed') {
      message.append('正在显示已屏蔽内容')
    } else {
      message.append('已隐藏一条内容')
    }

    const actions = document.createElement('div')
    actions.className = 'nl-filter-placeholder__actions'

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'nl-filter-placeholder__button nl-filter-placeholder__button--secondary'
    cancelButton.textContent = '取消屏蔽'
    cancelButton.setAttribute('aria-label', state.includes('reply') ? '取消这些回复对应的屏蔽规则' : '取消这条内容对应的屏蔽规则')

    const primaryButton = document.createElement('button')
    primaryButton.type = 'button'
    primaryButton.className = 'nl-filter-placeholder__button'
    const revealed = state.includes('revealed')
    if (revealed) {
      primaryButton.textContent = '恢复屏蔽'
      primaryButton.setAttribute('aria-label', state.includes('reply') ? `重新隐藏这 ${count} 条回复` : '重新隐藏这条内容')
    } else if (state === 'reply-summary') {
      primaryButton.textContent = `显示 ${count} 条`
      primaryButton.setAttribute('aria-label', `临时显示已屏蔽的 ${count} 条回复`)
    } else {
      primaryButton.textContent = '显示'
      primaryButton.setAttribute('aria-label', '临时显示这条已屏蔽内容')
    }

    const stopEvent = (event: Event): void => event.stopPropagation()
    for (const button of [cancelButton, primaryButton]) {
      button.addEventListener('pointerdown', stopEvent)
      button.addEventListener('mousedown', stopEvent)
    }

    cancelButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void this.cancelFilteringForTargets(this.getActionTargets(target, state), cancelButton)
    })

    primaryButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const actionTargets = this.getActionTargets(target, state)
      if (revealed) this.restoreTargets(actionTargets)
      else this.revealTargets(actionTargets)
    })

    actions.append(cancelButton, primaryButton)
    placeholder.append(message, actions)
    if (revealed) target.prepend(placeholder)
    else target.appendChild(placeholder)
  }

  private getThreadPath(): string | null {
    const match = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/)
    return match ? `/${match[1]}/status/${match[2]}` : null
  }

  private getThreadRootTarget(): HTMLElement | null {
    const threadPath = this.getThreadPath()
    if (!threadPath) return null

    const rootArticle = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')).find((article) => {
      return Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')).some((link) => {
        try {
          return new URL(link.href, location.origin).pathname.replace(/\/$/, '') === threadPath
        } catch {
          return (link.getAttribute('href') || '').split('?')[0].replace(/\/$/, '') === threadPath
        }
      })
    })

    return rootArticle ? this.getHideTarget(rootArticle) : null
  }

  /**
   * 回复汇总条固定在主推文/回复编辑器单元底部，不依附任何一条回复。
   * 宿主放在 X 管理高度的根单元内部，避免虚拟列表把普通兄弟节点定位到错误位置。
   */
  private ensureReplyAggregateHost(rootTarget: HTMLElement): HTMLElement | null {
    if (!rootTarget.parentElement) return null

    const duplicateHosts = document.querySelectorAll<HTMLElement>(`#${TweetProcessor.REPLY_AGGREGATE_ID}`)
    let host = duplicateHosts[0] || null
    duplicateHosts.forEach((duplicate, index) => {
      if (index > 0) duplicate.remove()
    })

    if (!host) {
      host = document.createElement('div')
      host.id = TweetProcessor.REPLY_AGGREGATE_ID
      host.className = 'nl-reply-aggregate-host'
      host.setAttribute('data-newsliquid-reply-aggregate', 'true')
    }

    if (host.parentElement !== rootTarget || rootTarget.lastElementChild !== host) rootTarget.appendChild(host)
    return host
  }

  private clearReplyAggregateHost(): void {
    const host = document.getElementById(TweetProcessor.REPLY_AGGREGATE_ID)
    if (!host) return
    this.clearTargetPresentation(host)
    host.remove()
  }

  private getFilteredTargets(): HTMLElement[] {
    const tweets = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"][data-filtered-user]')
    return Array.from(new Set(Array.from(tweets, (tweet) => this.hiddenTargets.get(tweet) || this.getHideTarget(tweet))))
      .filter((target) => target.isConnected)
  }

  private getFilteredReplyTargets(): HTMLElement[] {
    if (!this.getThreadPath()) return []
    const rootTarget = this.getThreadRootTarget()
    return this.getFilteredTargets().filter((target) => target !== rootTarget)
  }

  private revealTargets(targets: HTMLElement[]): void {
    const threadPath = this.getThreadPath()
    const rootTarget = this.getThreadRootTarget()
    if (threadPath && targets.some((target) => target !== rootTarget)) {
      this.revealedReplyThreadPath = threadPath
    }
    targets.forEach((target) => {
      this.getFilteredTweetsInTarget(target).forEach((tweet) => {
        tweet.setAttribute('data-newsliquid-revealed', 'true')
      })
      this.restoreOriginalTargetDisplay(target)
    })
    this.refreshPresentation()
  }

  private restoreTargets(targets: HTMLElement[]): void {
    if (this.revealedReplyThreadPath === this.getThreadPath()) this.revealedReplyThreadPath = null
    targets.forEach((target) => {
      this.getFilteredTweetsInTarget(target).forEach((tweet) => {
        tweet.removeAttribute('data-newsliquid-revealed')
      })
    })
    this.refreshPresentation()
  }

  private getFilterMatches(targets: HTMLElement[]): FilterResult[] {
    const matches = new Map<string, FilterResult>()
    targets.forEach((target) => {
      this.getFilteredTweetsInTarget(target).forEach((tweet) => {
        const type = tweet.getAttribute('data-filtered-type') as FilterResult['type'] | null
        const value = tweet.getAttribute('data-filtered-user')
        if (!type || !value || !['账户', '关键词', '用户名'].includes(type)) return
        matches.set(`${type}:${value}`, { type, value })
      })
    })
    return Array.from(matches.values())
  }

  private async addAllowRule(match: FilterResult): Promise<void> {
    const storageKeys: Record<FilterResult['type'], { blocked: string, allowed: string }> = {
      账户: { blocked: 'manualBlockedAccounts', allowed: 'manualWhitelistAccounts' },
      关键词: { blocked: 'manualBlockedKeywords', allowed: 'manualWhitelistKeywords' },
      用户名: { blocked: 'manualBlockedUsernames', allowed: 'manualWhitelistUsernames' },
    }
    const keys = storageKeys[match.type]
    const normalize = (value: string): string => (
      match.type === '账户' ? value.replace(/^@/, '').toLowerCase() : value
    )
    const ruleText = (rule: unknown): string => {
      if (typeof rule === 'string') return rule
      if (rule && typeof rule === 'object' && 'text' in rule) return String((rule as { text?: unknown }).text || '')
      return ''
    }

    const stored = await chrome.storage.local.get([keys.allowed, keys.blocked])
    const rawAllowed: unknown[] = Array.isArray(stored[keys.allowed]) ? stored[keys.allowed] : []
    const allowed = rawAllowed
      .map(ruleText)
      .filter(Boolean)
    const normalizedValue = normalize(match.value)
    if (!allowed.some((rule) => normalize(rule) === normalizedValue)) allowed.push(normalizedValue)

    const blocked = (Array.isArray(stored[keys.blocked]) ? stored[keys.blocked] : []).filter((rule: unknown) => (
      normalize(ruleText(rule)) !== normalizedValue
    ))
    await chrome.storage.local.set({ [keys.allowed]: allowed, [keys.blocked]: blocked })
  }

  private async cancelFilteringForTargets(targets: HTMLElement[], button: HTMLButtonElement): Promise<void> {
    const matches = this.getFilterMatches(targets)
    if (matches.length === 0) return

    const originalLabel = button.textContent || '取消屏蔽'
    button.disabled = true
    button.textContent = '处理中'

    try {
      for (const match of matches) {
        await this.addAllowRule(match)
      }

      if (this.revealedReplyThreadPath === this.getThreadPath()) this.revealedReplyThreadPath = null
      const matchKeys = new Set(matches.map((match) => `${match.type}:${match.value}`))
      document.querySelectorAll<HTMLElement>('article[data-testid="tweet"][data-filtered-user]').forEach((tweet) => {
        const key = `${tweet.getAttribute('data-filtered-type')}:${tweet.getAttribute('data-filtered-user')}`
        if (matchKeys.has(key)) this.showTweetInternal(tweet, false)
      })
      this.refreshPresentation()
    } catch (error) {
      console.error('[NewsLiquid] 取消屏蔽失败:', error)
      if (button.isConnected) {
        button.disabled = false
        button.textContent = '重试'
        button.title = error instanceof Error ? error.message : '取消屏蔽失败'
        button.setAttribute('aria-label', `${originalLabel}失败，请重试`)
      }
    }
  }

  private schedulePresentationRefresh(): void {
    if (this.presentationRefreshQueued) return
    this.presentationRefreshQueued = true
    queueMicrotask(() => {
      this.presentationRefreshQueued = false
      this.refreshPresentation()
    })
  }

  refreshPresentation(): void {
    this.ensurePresentationStyles()

    const filteredTargets = this.getFilteredTargets()
    const filteredTargetSet = new Set(filteredTargets)
    document.querySelectorAll<HTMLElement>('[data-newsliquid-filter-state]').forEach((target) => {
      if (target.id === TweetProcessor.REPLY_AGGREGATE_ID) return
      if (!filteredTargetSet.has(target)) this.clearTargetPresentation(target)
    })

    if (filteredTargets.length === 0) {
      this.clearReplyAggregateHost()
      return
    }

    const threadPath = this.getThreadPath()
    if (!threadPath) {
      this.revealedReplyThreadPath = null
      this.clearReplyAggregateHost()
      filteredTargets.forEach((target) => {
        this.createPlaceholder(target, this.targetHasHiddenTweets(target) ? 'timeline' : 'timeline-revealed')
      })
      return
    }

    const rootTarget = this.getThreadRootTarget()
    if (!rootTarget) {
      this.clearReplyAggregateHost()
      filteredTargets.forEach((target) => {
        this.createPlaceholder(target, this.targetHasHiddenTweets(target) ? 'timeline' : 'timeline-revealed')
      })
      return
    }

    if (rootTarget && filteredTargetSet.has(rootTarget)) {
      this.createPlaceholder(rootTarget, this.targetHasHiddenTweets(rootTarget) ? 'timeline' : 'timeline-revealed')
    }

    const replyTargets = filteredTargets.filter((target) => target !== rootTarget)
    if (replyTargets.length === 0) {
      this.clearReplyAggregateHost()
      return
    }

    // 用户在当前详情页选择“显示”后，新载入的命中回复也沿用显示状态，
    // 这样固定汇总条始终只有一个明确的显示/恢复状态。
    if (this.revealedReplyThreadPath !== threadPath) {
      replyTargets.forEach((target) => {
        this.getFilteredTweetsInTarget(target).forEach((tweet) => {
          tweet.removeAttribute('data-newsliquid-revealed')
        })
      })
    }
    const revealReplies = this.revealedReplyThreadPath === threadPath
    replyTargets.forEach((target) => {
      if (revealReplies) {
        this.getFilteredTweetsInTarget(target).forEach((tweet) => {
          tweet.setAttribute('data-newsliquid-revealed', 'true')
        })
      }
      this.setPresentationState(target, revealReplies ? 'reply-revealed' : 'reply-hidden')
    })

    const aggregateHost = this.ensureReplyAggregateHost(rootTarget)
    if (aggregateHost) {
      this.createPlaceholder(
        aggregateHost,
        revealReplies ? 'reply-revealed-summary' : 'reply-summary',
        replyTargets.length,
      )
    }
  }

  hideTweet(element: Element, filterType: string, filterValue: string): void {
    const tweet = element as HTMLElement
    const wasFiltered = tweet.hasAttribute('data-filtered-user')
    const matchChanged = tweet.getAttribute('data-filtered-user') !== filterValue
      || tweet.getAttribute('data-filtered-type') !== filterType
    tweet.setAttribute('data-filtered-user', filterValue)
    tweet.setAttribute('data-filtered-type', filterType)
    if (!wasFiltered || matchChanged) tweet.removeAttribute('data-newsliquid-revealed')

    const target = this.getHideTarget(element)
    if (!this.originalDisplay.has(target)) this.originalDisplay.set(target, target.style.display)
    this.hiddenTargets.set(element, target)
    if (this.isRevealed(tweet)) this.restoreOriginalTargetDisplay(target)
    else target.style.setProperty('display', 'none', 'important')
    this.schedulePresentationRefresh()

    if (!wasFiltered) {
      void this.storageManager.incrementBlockCount()
      console.log(`[NewsLiquid] 已隐藏推文 - 类型: ${filterType}, 值: ${filterValue}`)
    }
  }

  private showTweetInternal(element: Element, refresh: boolean): void {
    const tweet = element as HTMLElement
    if (!tweet.hasAttribute('data-filtered-user')) return

    const target = this.hiddenTargets.get(element) || this.getHideTarget(element)
    tweet.removeAttribute('data-filtered-user')
    tweet.removeAttribute('data-filtered-type')
    tweet.removeAttribute('data-newsliquid-revealed')
    this.hiddenTargets.delete(element)

    if (this.getFilteredTweetsInTarget(target).length === 0) this.clearTargetPresentation(target)
    if (refresh) this.refreshPresentation()
  }

  showTweet(element: Element): void {
    const target = this.hiddenTargets.get(element) || this.getHideTarget(element)
    this.revealTargets([target])
  }

  showAllTweets(): number {
    const hidden = Array.from(document.querySelectorAll<HTMLElement>(
      'article[data-testid="tweet"][data-filtered-user]:not([data-newsliquid-revealed="true"])',
    ))
    const targets = Array.from(new Set(hidden.map((tweet) => this.hiddenTargets.get(tweet) || this.getHideTarget(tweet))))
    this.revealTargets(targets)
    return hidden.length
  }

  showUserTweets(value: string): void {
    const hidden = document.querySelectorAll('article[data-testid="tweet"][data-filtered-user]')
    hidden.forEach((tweet) => {
      if (tweet.getAttribute('data-filtered-user') === value) this.showTweetInternal(tweet, false)
    })
    this.userDisplayNames.delete(value)
    this.refreshPresentation()
  }

  processTweet(element: Element, forceUpdate = false): void {
    if (this.processedTweets.has(element) && !forceUpdate) return

    const result = this.shouldFilterTweet(element)
    if (result && this.storageManager.isFilterEnabled) {
      this.hideTweet(element, result.type, result.value)
    } else if (element.hasAttribute('data-filtered-user')) {
      this.showTweetInternal(element, false)
      this.schedulePresentationRefresh()
    }
    this.processedTweets.add(element)
  }

  scanAndFilterTweets(forceUpdate = false): void {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((tweet) => {
      this.processTweet(tweet, forceUpdate)
    })
    this.refreshPresentation()
  }

  clearProcessed(): void {
    this.processedTweets = new WeakSet<Element>()
  }

  getFilteredUsers(): Map<string, { type: string, value: string, count: number }> {
    const counts = new Map<string, { type: string, value: string, count: number }>()
    document.querySelectorAll('article[data-testid="tweet"][data-filtered-user]').forEach((tweet) => {
      const value = tweet.getAttribute('data-filtered-user')
      const type = tweet.getAttribute('data-filtered-type')
      if (!value || !type) return
      const key = `${type}:${value}`
      const current = counts.get(key)
      if (current) current.count += 1
      else counts.set(key, { type, value, count: 1 })
    })
    return counts
  }

  getUserDisplayNameFromCache(username: string): string {
    return this.userDisplayNames.get(username) || username
  }

  getFilteredCount(): number {
    return document.querySelectorAll(
      'article[data-testid="tweet"][data-filtered-user]:not([data-newsliquid-revealed="true"])',
    ).length
  }
}
