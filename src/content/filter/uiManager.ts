import type { TweetProcessor } from './tweetProcessor'
import type { ReportManager } from './reportManager'
import type { StorageManager } from './storageManager'

/**
 * UI管理类
 * 负责推文上的按钮和状态UI显示
 */
export class UIManager {
  private tweetProcessor: TweetProcessor
  private reportManager: ReportManager
  private storageManager: StorageManager
  private filterUI: HTMLElement | null = null

  // 更新UI的回调
  private onUIUpdateCallback?: () => void

  constructor(
    tweetProcessor: TweetProcessor,
    reportManager: ReportManager,
    storageManager: StorageManager
  ) {
    this.tweetProcessor = tweetProcessor
    this.reportManager = reportManager
    this.storageManager = storageManager
  }

  /**
   * 在推文中添加手动上报按钮
   */
  addManualReportButton(element: Element): void {
    // 检查是否已经添加过按钮
    if (element.querySelector('.manual-report-btn')) {
      return
    }

    // 查找时间戳元素
    const timeElement = element.querySelector('time')
    if (!timeElement) {
      return
    }

    const parentElement = timeElement.parentElement?.parentElement
    if (!parentElement) {
      return
    }

    // 创建上报按钮
    const reportBtn = document.createElement('span')
    reportBtn.className = 'manual-report-btn'
    reportBtn.innerHTML = '🚫'
    reportBtn.style.cssText = `
      cursor: pointer;
      font-size: 14px;
      margin-left: 8px;
      opacity: 0.6;
      transition: opacity 0.2s;
    `
    reportBtn.title = '手动上报此账号(6551提供)'

    reportBtn.addEventListener('mouseenter', () => {
      reportBtn.style.opacity = '1'
    })

    reportBtn.addEventListener('mouseleave', () => {
      reportBtn.style.opacity = '0.6'
    })

    reportBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      e.preventDefault()

      const username = this.tweetProcessor.getTweetUsername(element)
      if (username) {
        const result = await this.reportManager.handleManualReport(username)
        if (result.success) {
          alert(`已手动上报 ${username}`)
        } else {
          alert(`手动上报失败: ${result.error}`)
        }
      }
    })

    parentElement.appendChild(reportBtn)
  }

  /**
   * 隐藏过滤器 UI
   */
  hideFilterUI(): void {
    if (this.filterUI) {
      this.filterUI.remove()
      this.filterUI = null
    }
  }

  /**
   * 创建或更新过滤器 UI
   */
  updateFilterUI(): void {
    if (!this.filterUI) {
      this.filterUI = this.createFilterUI()
    }

    const filteredCount = this.tweetProcessor.getFilteredCount()
    const filteredUsers = this.tweetProcessor.getFilteredUsers()

    const userListHtml = Array.from(filteredUsers.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, filterInfo]) => {
        const { type, value, count } = filterInfo

        // 根据类型格式化显示文本
        let displayText = ''
        if (type === '账户') {
          const displayName = this.tweetProcessor.getUserDisplayNameFromCache(value)
          displayText = displayName && displayName.trim() ? displayName : `@${value}`
        } else if (type === '关键词') {
          displayText = `关键词:${value}`
        } else if (type === '用户名') {
          displayText = `用户名:${value}`
        }

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; color: #536471; gap: 8px;">
            <span class="filter-feedback-btn" data-username="${value}" data-filter-type="${type}"
                  style="cursor: pointer; font-size: 16px; flex-shrink: 0;"
                  title="反馈误报">⚠️</span>
            <span class="filter-user-link" data-username="${value}" data-filter-type="${type}"
                  style="cursor: pointer; color: #1d9bf0; flex: 1; width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title="${type === '账户' ? `点击查看 @${value}` : displayText}">
              ${displayText}
            </span>
            <span style="font-weight: bold; color: #1d9bf0; margin-left: 8px; flex-shrink: 0;">${count}</span>
          </div>
        `
      }).join('')

    this.filterUI.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <input type="checkbox" id="filter-toggle" ${this.storageManager.isFilterEnabled ? 'checked' : ''}
               style="width: 16px; height: 16px; cursor: pointer;">
        <label for="filter-toggle" style="cursor: pointer; user-select: none; color: #536471;">
          已过滤 <span style="font-weight: bold; color: #1d9bf0;">${filteredCount}</span> 条推文/回复
        </label>
      </div>
      ${filteredCount > 0 ? `
        <div style="border-top: 1px solid #e1e8ed; padding-top: 8px; max-height: 300px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none;">
          ${userListHtml}
        </div>
        <style>
          #filter-status-ui > div::-webkit-scrollbar {
            display: none;
          }
        </style>
      ` : ''}
    `
  }

  /**
   * 创建过滤器UI
   */
  private createFilterUI(): HTMLElement {
    const filterUI = document.createElement('div')
    filterUI.id = 'filter-status-ui'
    filterUI.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      background: white;
      border: 1px solid #e1e8ed;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      min-width: 250px;
      max-width: 350px;
    `
    document.body.appendChild(filterUI)

    // 使用事件委托
    filterUI.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement

      // 处理 checkbox 点击
      if (target.id === 'filter-toggle') {
        const checkbox = target as HTMLInputElement
        await this.storageManager.updateFilterEnabled(checkbox.checked)
        console.log(`[推文过滤器] 过滤功能已${checkbox.checked ? '启用' : '禁用'}`)
        if (this.onUIUpdateCallback) {
          this.onUIUpdateCallback()
        }
        return
      }

      // 处理反馈按钮点击
      if (target.classList.contains('filter-feedback-btn')) {
        const filterValue = target.getAttribute('data-username')
        const filterType = target.getAttribute('data-filter-type')
        if (filterValue && filterType) {
          if (filterType === '账户') {
            // 账户过滤：发送到background
            const result = await this.reportManager.handleFeedbackMisreport(filterValue)
            if (result.success) {
              alert(`已反馈 ${filterValue} 为误报`)
              this.tweetProcessor.showUserTweets(filterValue)
              this.updateFilterUI()
            } else {
              alert(`反馈失败: ${result.error}`)
            }
          } else if (filterType === '关键词') {
            // 关键词过滤：加入白名单
            try {
              const result = await chrome.storage.local.get(['manualWhitelistKeywords'])
              const whitelist = result.manualWhitelistKeywords || []
              if (!whitelist.includes(filterValue)) {
                whitelist.push(filterValue)
                await chrome.storage.local.set({ manualWhitelistKeywords: whitelist })
              }
              alert(`已将关键词 "${filterValue}" 加入白名单`)
              this.tweetProcessor.showUserTweets(filterValue)
              this.updateFilterUI()
            } catch (error) {
              alert('加入白名单失败')
            }
          } else if (filterType === '用户名') {
            // 用户名过滤：从过滤列表中移除
            try {
              const result = await chrome.storage.local.get(['manualBlockedUsernames'])
              const blockedList = result.manualBlockedUsernames || []
              const newList = blockedList.filter((item: string) => item !== filterValue)
              await chrome.storage.local.set({ manualBlockedUsernames: newList })
              alert(`已将用户名 "${filterValue}" 从过滤列表中移除`)
              this.tweetProcessor.showUserTweets(filterValue)
              this.updateFilterUI()
            } catch (error) {
              alert('移除失败')
            }
          }
        }
        return
      }

      // 处理用户名点击
      if (target.classList.contains('filter-user-link')) {
        const username = target.getAttribute('data-username')
        const filterType = target.getAttribute('data-filter-type')
        // 只有账户类型才打开Twitter链接
        if (username && filterType === '账户') {
          window.open(`https://x.com/${username}`, '_blank')
        }
        return
      }

      // 处理 label 点击
      if (target.tagName === 'LABEL' && target.getAttribute('for') === 'filter-toggle') {
        const checkbox = document.getElementById('filter-toggle') as HTMLInputElement
        if (checkbox) {
          checkbox.checked = !checkbox.checked
          await this.storageManager.updateFilterEnabled(checkbox.checked)
          console.log(`[推文过滤器] 过滤功能已${checkbox.checked ? '启用' : '禁用'}`)
          if (this.onUIUpdateCallback) {
            this.onUIUpdateCallback()
          }
        }
        e.preventDefault()
      }
    })

    return filterUI
  }

  /**
   * 设置UI更新回调
   */
  setOnUIUpdateCallback(callback: () => void): void {
    this.onUIUpdateCallback = callback
  }
}
