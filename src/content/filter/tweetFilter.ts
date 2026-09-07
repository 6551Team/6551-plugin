import { StorageManager } from './storageManager'
import { TweetProcessor } from './tweetProcessor'
import { ReportManager } from './reportManager'
import { UIManager } from './uiManager'

/**
 * 推文过滤器主类
 * 协调各个模块，负责初始化和DOM监听
 */
export class TweetFilter {
  private storageManager: StorageManager
  private tweetProcessor: TweetProcessor
  private reportManager: ReportManager
  private uiManager: UIManager
  private observer: MutationObserver | null = null
  private debounceTimer: number | null = null

  constructor() {
    this.storageManager = new StorageManager()
    this.reportManager = new ReportManager()
    this.tweetProcessor = new TweetProcessor(this.storageManager)
    this.uiManager = new UIManager(this.tweetProcessor, this.reportManager, this.storageManager)

    // 设置UI更新回调
    this.uiManager.setOnUIUpdateCallback(() => {
      this.scanAndFilterTweets(true)
    })
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    console.log('[推文过滤器] 正在初始化...')

    // 加载过滤账号列表
    await this.storageManager.loadFilterAccounts()

    // 设置存储监听
    this.storageManager.setupStorageListener(() => {
      this.tweetProcessor.clearProcessed()
      this.scanAndFilterTweets(true)
    })

    // 等待页面加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.start()
      })
    } else {
      this.start()
    }

    console.log('[推文过滤器] 初始化完成')
  }

  /**
   * 启动过滤器
   */
  private start(): void {
    this.uiManager.initialize()
    this.scanAndFilterTweets()
    this.observeDOMChanges()
  }

  /**
   * 从插件弹窗打开 X 页面内的过滤控制中心。
   */
  openControlCenter(): void {
    this.uiManager.openControlCenter()
  }

  /**
   * 在线规则更新后重新检查当前页面，包括推文详情页里的回复。
   */
  refreshSystemRules(): void {
    this.tweetProcessor.clearProcessed()
    this.scanAndFilterTweets(true)
  }

  /**
   * 扫描并处理页面上的所有推文
   */
  private scanAndFilterTweets(forceUpdate = false): void {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]')

    tweets.forEach(tweet => {
      this.processTweet(tweet, forceUpdate)
    })

    this.tweetProcessor.refreshPresentation()

    // 根据showBlockUI设置决定是否显示右侧UI
    if (this.storageManager.showBlockUI) {
      this.uiManager.updateFilterUI()
    } else {
      this.uiManager.hideFilterUI()
    }
  }

  /**
   * 处理单个推文
   */
  private processTweet(element: Element, forceUpdate = false): void {
    this.tweetProcessor.processTweet(element, forceUpdate)

    // 如果推文未被过滤，添加手动上报按钮
    const isFiltered = element.getAttribute('data-filtered-user')
    if (!isFiltered && this.storageManager.isFilterEnabled) {
      this.uiManager.addManualReportButton(element)
    }
  }

  /**
   * 使用 MutationObserver 监听 DOM 变化
   */
  private observeDOMChanges(): void {
    this.observer = new MutationObserver((mutations) => {
      let hasNewTweets = false

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node instanceof Element) {
              if (node.matches('article[data-testid="tweet"]')) {
                this.processTweet(node)
                hasNewTweets = true
              } else {
                const tweets = node.querySelectorAll('article[data-testid="tweet"]')
                tweets.forEach(tweet => {
                  this.processTweet(tweet)
                  hasNewTweets = true
                })
              }
            }
          })
        }
      }

      if (hasNewTweets) {
        this.debounce(() => {
          this.tweetProcessor.refreshPresentation()

          // 根据showBlockUI设置决定是否显示右侧UI
          if (this.storageManager.showBlockUI) {
            this.uiManager.updateFilterUI()
          } else {
            this.uiManager.hideFilterUI()
          }
        }, 300)
      }
    })

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    })

    console.log('[推文过滤器] DOM 监听已启动')
  }

  /**
   * 简单的防抖函数
   */
  private debounce(func: () => void, delay: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = window.setTimeout(() => {
      func()
      this.debounceTimer = null
    }, delay)
  }

  /**
   * 销毁过滤器
   */
  destroy(): void {
    this.uiManager.destroy()

    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    console.log('[推文过滤器] 已销毁')
  }
}
