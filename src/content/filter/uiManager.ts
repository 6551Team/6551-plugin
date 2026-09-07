import { gsap } from 'gsap'
import weuiCss from 'weui/dist/style/weui.min.css?inline'
import type { TweetProcessor } from './tweetProcessor'
import type { ReportManager } from './reportManager'
import type { StorageManager } from './storageManager'
import {
  addFilterRule,
  FILTER_RULE_LABELS,
  filterTypeToRuleKind,
  removeFilterRule,
  ruleIsRegexp,
  ruleText,
  type FilterRuleKind,
  type FilterRuleMode,
  type StoredFilterRule,
} from '../../services/filterRuleService'
import { getAccountCount, getHandleCount, getWordCount } from '../../services/wasmService'
import { showPageNotice } from './pageUi'

type CenterView = 'overview' | FilterRuleKind

interface MoreMenuContext {
  article: HTMLElement
  trigger: HTMLButtonElement
  username: string
}

interface UiPalette {
  page: string
  surface: string
  surfaceMuted: string
  backdrop: string
  border: string
  borderStrong: string
  text: string
  soft: string
  muted: string
  brand: string
  brandStrong: string
  onBrand: string
  brandSurface: string
  danger: string
  dangerSurface: string
  shadow: string
}

/** 管理 X 页面中的过滤入口、规则抽屉和低干扰手动上报。 */
export class UIManager {
  private host: HTMLElement | null = null
  private root: ShadowRoot | null = null
  private panelOpen = false
  private activeView: CenterView = 'overview'
  private activeMode: FilterRuleMode = 'blocked'
  private searchQuery = ''
  private regexpMode = false
  private reportPopover: HTMLElement | null = null
  private moreMenuContext: MoreMenuContext | null = null
  private moreMenuObserver: MutationObserver | null = null
  private moreMenuInjectionQueued = false
  private onUIUpdateCallback?: () => void

  constructor(
    private tweetProcessor: TweetProcessor,
    private reportManager: ReportManager,
    private storageManager: StorageManager,
  ) {}

  initialize(): void {
    if (this.moreMenuObserver || !document.body) return
    this.ensureReportButtonStyle()
    document.addEventListener('click', this.handleMoreMenuTrigger, true)
    this.moreMenuObserver = new MutationObserver(() => this.scheduleMoreMenuInjection())
    this.moreMenuObserver.observe(document.body, { childList: true, subtree: true })
  }

  destroy(): void {
    document.removeEventListener('click', this.handleMoreMenuTrigger, true)
    document.removeEventListener('keydown', this.handleDocumentKeydown)
    this.moreMenuObserver?.disconnect()
    this.moreMenuObserver = null
    this.moreMenuContext = null
    this.closeReportConfirmation()
  }

  addManualReportButton(element: Element): void {
    if (element.querySelector('.nl-manual-report-btn')) return
    const username = this.tweetProcessor.getTweetUsername(element)
    if (!username) return
    const currentUser = this.reportManager.getCurrentTwitterUser()
    if (currentUser !== 'anonymous' && currentUser.toLowerCase() === username.toLowerCase()) return

    const userNameElement = element.querySelector<HTMLElement>('[data-testid="User-Name"]')
    const timeElement = userNameElement?.querySelector('time')
    const parentElement = timeElement?.parentElement?.parentElement || userNameElement
    if (!parentElement) return
    this.ensureReportButtonStyle()

    const reportButton = document.createElement('button')
    reportButton.type = 'button'
    reportButton.className = 'nl-manual-report-btn'
    reportButton.setAttribute('aria-label', `NewsLiquid 屏蔽 @${username}`)
    reportButton.title = `NewsLiquid 屏蔽 @${username}`
    const logo = document.createElement('img')
    logo.src = chrome.runtime.getURL('newsliquid-mark.png')
    logo.alt = ''
    const label = document.createElement('span')
    label.textContent = '屏蔽'
    reportButton.append(logo, label)
    reportButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.openReportConfirmation(reportButton, username)
    })
    parentElement.appendChild(reportButton)
  }

  private ensureReportButtonStyle(): void {
    if (document.getElementById('newsliquid-report-button-style')) return
    const style = document.createElement('style')
    style.id = 'newsliquid-report-button-style'
    style.textContent = `
      .nl-manual-report-btn{display:inline-flex;min-width:0;height:20px;box-sizing:border-box;align-items:center;justify-content:center;gap:3px;border:0;border-radius:999px;margin-left:4px;padding:0 5px 0 4px;color:inherit;background:transparent;cursor:pointer;font:650 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;opacity:.64;white-space:nowrap;transition:opacity 120ms ease,background 120ms ease,color 120ms ease}
      .nl-manual-report-btn img{width:11px;height:11px;flex:0 0 auto;object-fit:contain}
      .nl-manual-report-btn:hover{color:#5e47d2;background:rgba(109,85,231,.1);opacity:1}
      .nl-manual-report-btn:focus-visible{outline:2px solid #6d55e7;outline-offset:1px;opacity:1}
      @media (hover:hover) and (pointer:fine){
        .nl-manual-report-btn{opacity:0;pointer-events:none}
        article[data-testid="tweet"]:hover .nl-manual-report-btn,article[data-testid="tweet"]:focus-within .nl-manual-report-btn,.nl-manual-report-btn:focus-visible{opacity:.68;pointer-events:auto}
        .nl-manual-report-btn:hover,.nl-manual-report-btn:focus-visible{opacity:1}
      }
      .nl-more-menu-item{display:flex;min-height:48px;width:100%;box-sizing:border-box;align-items:center;gap:12px;padding:12px 16px;color:inherit;background:transparent;cursor:pointer;font:700 15px/20px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;text-align:left;user-select:none}
      .nl-more-menu-item:hover,.nl-more-menu-item:focus-visible{background:rgba(109,85,231,.11);outline:0}
      .nl-more-menu-item[aria-disabled="true"]{cursor:wait;opacity:.58}
      .nl-more-menu-item img{width:20px;height:20px;flex:0 0 20px;object-fit:contain}
      .nl-more-menu-item__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media (prefers-reduced-motion:reduce){.nl-manual-report-btn{transition:none}}
    `
    document.head.appendChild(style)
  }

  private handleMoreMenuTrigger = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    const menuItem = target.closest<HTMLElement>('[data-newsliquid-menu-item]')
    const menu = menuItem?.closest<HTMLElement>('[role="menu"]')
    if (menuItem && menu && this.moreMenuContext) {
      const blocked = menuItem.dataset.newsliquidMenuItem === 'unblock'
      void this.activateMoreMenuItem(event, menu, menuItem, this.moreMenuContext, blocked)
      return
    }

    const trigger = target.closest<HTMLButtonElement>('button[data-testid="caret"]')
    if (!trigger) {
      if (target.closest('button[aria-haspopup="menu"],button[aria-label*="更多"]')) this.moreMenuContext = null
      return
    }

    const article = trigger.closest<HTMLElement>('article[data-testid="tweet"]')
    const username = article ? this.tweetProcessor.getTweetUsername(article) : null
    const currentUser = this.reportManager.getCurrentTwitterUser()
    if (!article || !username || (currentUser !== 'anonymous' && currentUser.toLowerCase() === username.toLowerCase())) {
      this.moreMenuContext = null
      return
    }

    this.moreMenuContext = { article, trigger, username }
    ;[0, 80, 240, 600].forEach((delay) => {
      window.setTimeout(() => this.scheduleMoreMenuInjection(), delay)
    })
  }

  private scheduleMoreMenuInjection(): void {
    if (!this.moreMenuContext || this.moreMenuInjectionQueued) return
    this.moreMenuInjectionQueued = true
    queueMicrotask(() => {
      this.moreMenuInjectionQueued = false
      this.injectMoreMenuItem()
    })
  }

  private isAccountBlocked(context: MoreMenuContext): boolean {
    const username = context.username.replace(/^@/, '').toLowerCase()
    if (this.storageManager.isAccountWhitelisted(username)) return false

    const manuallyBlocked = this.storageManager.manualBlockedAccounts.some((account) => (
      account.replace(/^@/, '').toLowerCase() === username
    ))
    // 已临时显示的命中内容也提供“取消屏蔽”。这里放行该账号，
    // 不会删除可能同时命中的全局关键词或显示名称规则。
    const filteredContent = context.article.hasAttribute('data-filtered-user')
    return manuallyBlocked || filteredContent || this.storageManager.shouldFilterAccount(username)
  }

  private injectMoreMenuItem(): void {
    const context = this.moreMenuContext
    if (!context || !this.storageManager.isFilterEnabled) return

    const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
    const menu = menus.findLast((candidate) => candidate.isConnected)
    const dropdown = menu?.querySelector<HTMLElement>('[data-testid="Dropdown"]')
    if (!menu || !dropdown) return

    const blocked = this.isAccountBlocked(context)
    const action = blocked ? 'unblock' : 'block'
    const existingItem = dropdown.querySelector<HTMLElement>('[data-newsliquid-menu-item]')
    if (existingItem?.dataset.newsliquidMenuItem === action
      && existingItem.dataset.newsliquidUsername === context.username.toLowerCase()) return
    existingItem?.remove()

    const item = document.createElement('div')
    item.className = 'nl-more-menu-item'
    item.tabIndex = 0
    item.setAttribute('role', 'menuitem')
    item.setAttribute('data-newsliquid-menu-item', action)
    item.setAttribute('data-newsliquid-username', context.username.toLowerCase())
    item.setAttribute('aria-label', blocked
      ? `NewsLiquid 取消屏蔽 @${context.username}`
      : `NewsLiquid 屏蔽 @${context.username}`)

    const logo = document.createElement('img')
    logo.src = chrome.runtime.getURL('newsliquid-mark.png')
    logo.alt = ''
    const label = document.createElement('span')
    label.className = 'nl-more-menu-item__label'
    label.textContent = blocked
      ? `NewsLiquid 取消屏蔽 @${context.username}`
      : `NewsLiquid 屏蔽 @${context.username}`
    item.append(logo, label)

    const stopEvent = (event: Event): void => event.stopPropagation()
    item.addEventListener('pointerdown', stopEvent)
    item.addEventListener('mousedown', stopEvent)
    item.addEventListener('click', (event) => {
      void this.activateMoreMenuItem(event, menu, item, context, blocked)
    })
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      void this.activateMoreMenuItem(event, menu, item, context, blocked)
    })

    const nativeBlockItem = Array.from(dropdown.children).find((candidate) => (
      candidate.getAttribute('role') === 'menuitem'
      && candidate.textContent?.includes(`屏蔽 @${context.username}`)
    ))
    if (nativeBlockItem) dropdown.insertBefore(item, nativeBlockItem)
    else dropdown.appendChild(item)
  }

  private closeNativeMoreMenu(menu: HTMLElement, trigger: HTMLButtonElement): void {
    const backdrop = menu.parentElement?.firstElementChild
    if (backdrop instanceof HTMLElement && backdrop !== menu) backdrop.click()
    else if (trigger.isConnected) trigger.click()
    this.moreMenuContext = null
  }

  private async activateMoreMenuItem(
    event: Event,
    menu: HTMLElement,
    item: HTMLElement,
    context: MoreMenuContext,
    blocked: boolean,
  ): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    if (item.getAttribute('aria-disabled') === 'true') return

    if (!blocked) {
      this.closeNativeMoreMenu(menu, context.trigger)
      const inlineButton = context.article.querySelector<HTMLButtonElement>('.nl-manual-report-btn')
      window.setTimeout(() => {
        if (inlineButton?.isConnected) inlineButton.click()
        else this.openReportConfirmation(context.trigger, context.username)
      }, 180)
      return
    }

    item.setAttribute('aria-disabled', 'true')
    try {
      await addFilterRule('account', 'allowed', context.username)
      this.closeNativeMoreMenu(menu, context.trigger)
      showPageNotice(`已取消屏蔽 @${context.username}`, 'success')
    } catch (error) {
      item.removeAttribute('aria-disabled')
      showPageNotice(error instanceof Error ? error.message : '取消屏蔽失败', 'error')
    }
  }

  openControlCenter(view: CenterView = 'overview'): void {
    const wasOpen = this.panelOpen
    this.panelOpen = true
    this.activeView = view
    this.ensureHost()
    this.render()
    if (wasOpen) this.animatePanelBodyIn()
    else this.animateControlCenterIn()
    window.setTimeout(() => this.root?.querySelector<HTMLButtonElement>('[data-action="close"]')?.focus(), 240)
  }

  hideFilterUI(): void {
    if (!this.host) return
    if (!this.panelOpen) this.host.style.display = 'none'
    else this.render()
  }

  updateFilterUI(): void {
    if (!this.panelOpen) {
      this.hideFilterUI()
      return
    }
    this.ensureHost()
    this.render()
  }

  setOnUIUpdateCallback(callback: () => void): void {
    this.onUIUpdateCallback = callback
  }

  private ensureHost(): void {
    if (this.host?.isConnected && this.root) {
      this.host.style.display = 'block'
      return
    }
    this.host = document.createElement('div')
    this.host.id = 'newsliquid-filter-control-host'
    this.host.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;'
    this.root = this.host.attachShadow({ mode: 'open' })
    this.root.addEventListener('click', this.handleRootClick)
    this.root.addEventListener('change', this.handleRootChange)
    this.root.addEventListener('input', this.handleRootInput)
    this.root.addEventListener('keydown', this.handleRootKeydown)
    document.addEventListener('keydown', this.handleDocumentKeydown)
    document.body.appendChild(this.host)
  }

  private closeControlCenter(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.searchQuery = ''
    const panel = this.root?.querySelector<HTMLElement>('.panel')
    const overlay = this.root?.querySelector<HTMLElement>('.overlay')
    if (!panel || !overlay || this.prefersReducedMotion()) {
      this.render()
      return
    }
    gsap.killTweensOf([panel, overlay])
    gsap.timeline({ onComplete: () => this.render() })
      .to(panel, { xPercent: 100, duration: 0.22, ease: 'power2.in' })
      .to(overlay, { autoAlpha: 0, duration: 0.18, ease: 'power1.in' }, '<')
  }

  private prefersReducedMotion(): boolean {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private animateControlCenterIn(): void {
    if (this.prefersReducedMotion()) return
    const panel = this.root?.querySelector<HTMLElement>('.panel')
    const overlay = this.root?.querySelector<HTMLElement>('.overlay')
    if (!panel || !overlay) return
    gsap.killTweensOf([panel, overlay])
    gsap.timeline()
      .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power1.out' })
      .fromTo(panel, { xPercent: 100 }, { xPercent: 0, duration: 0.32, ease: 'power3.out' }, '<')
  }

  private animatePanelBodyIn(): void {
    if (this.prefersReducedMotion()) return
    const body = this.root?.querySelector<HTMLElement>('.panel-body')
    if (!body) return
    gsap.fromTo(body, { autoAlpha: 0, x: 8 }, { autoAlpha: 1, x: 0, duration: 0.22, ease: 'power2.out' })
  }

  private getPalette(): UiPalette {
    const background = getComputedStyle(document.body).backgroundColor
    const channels = background.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
    const dark = channels?.length === 3
      ? channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < 128
      : matchMedia('(prefers-color-scheme:dark)').matches
    return dark
      ? {
          page: '#0f1014', surface: '#17181e', surfaceMuted: '#202129', backdrop: 'rgba(0,0,0,.48)',
          border: 'rgba(238,235,247,.11)', borderStrong: 'rgba(238,235,247,.2)', text: '#f5f3fa', soft: '#cbc7d5',
          muted: '#918c9e', brand: '#a995ff', brandStrong: '#bbaeff', onBrand: '#1b123b', brandSurface: '#2d2647',
          danger: '#ff9b9e', dangerSurface: '#3d2328', shadow: 'rgba(0,0,0,.35)',
        }
      : {
          page: '#f5f5f8', surface: '#ffffff', surfaceMuted: '#f0eff5', backdrop: 'rgba(20,18,27,.24)',
          border: 'rgba(35,31,48,.12)', borderStrong: 'rgba(35,31,48,.22)', text: '#18171d', soft: '#4e4a58',
          muted: '#74707f', brand: '#6d55e7', brandStrong: '#583fd4', onBrand: '#ffffff', brandSurface: '#eeebff',
          danger: '#b8424a', dangerSurface: '#ffe8e9', shadow: 'rgba(28,22,48,.16)',
        }
  }

  private render(): void {
    if (!this.root || !this.host) return
    if (!this.panelOpen) {
      this.host.style.display = 'none'
      return
    }

    this.host.style.display = 'block'
    const palette = this.getPalette()
    this.root.innerHTML = `
      <style>${weuiCss}\n${this.renderStyles(palette)}</style>
      ${this.panelOpen ? `
        <div class="overlay" data-overlay="true">
          <section class="weui-half-screen-dialog panel" role="dialog" aria-modal="true" aria-label="NewsLiquid 过滤设置">
            ${this.renderHeader()}
            ${this.renderNavigation()}
            <div class="panel-body">${this.activeView === 'overview' ? this.renderOverview() : this.renderRuleCenter(this.activeView)}</div>
          </section>
        </div>
      ` : ''}
    `
  }

  private renderStyles(p: UiPalette): string {
    return `
      :host{all:initial}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
      .overlay{position:fixed;inset:0;background:${p.backdrop};pointer-events:auto}
      .panel{position:absolute;top:0;right:0;bottom:auto;left:auto;display:flex;width:min(408px,100vw);max-width:none;height:100%;max-height:none;flex-direction:column;border-radius:0;color:${p.text};background:${p.page};box-shadow:-12px 0 36px ${p.shadow};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;transform:none;transition:none}
      .panel-header{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:60px;border-bottom:1px solid ${p.border};padding:10px 14px;background:${p.surface}}
      .panel-header img{width:30px;height:30px;object-fit:contain}.title{display:flex;min-width:0;flex-direction:column;gap:2px}.title strong{font-size:15.5px;font-weight:760;letter-spacing:-.015em;line-height:1.2}.title small{color:${p.muted};font-size:11.5px;line-height:1.3}
      .close,.secondary,.add,.remove{display:inline-flex;align-items:center;justify-content:center;appearance:none;transition:border-color 150ms ease,color 150ms ease,background 150ms ease,transform 150ms ease}.close{width:auto;min-height:32px;border:0;border-radius:8px;margin:0;padding:0 8px;color:${p.muted};background:transparent;font-size:12px;font-weight:700;line-height:1.2}.close::after{display:none}.close:hover{color:${p.text};background:${p.surfaceMuted}}.close:active,.secondary:active,.add:active,.remove:active{transform:scale(.985)}
      .nav-wrap{border-bottom:1px solid ${p.border};padding:8px 12px 9px;background:${p.surface}}
      .nav{position:relative;z-index:0;display:grid;grid-template-columns:repeat(4,1fr);gap:3px;border:0;border-radius:11px;padding:3px;background:${p.surfaceMuted}}
      .nav::after,.nav button::after{display:none}.nav button{min-height:34px;border:0;border-radius:8px;padding:0;color:${p.muted};background:transparent;font-size:12.5px;font-weight:700;line-height:34px}.nav button.active{color:${p.text};background:${p.surface};box-shadow:0 1px 3px ${p.shadow}}
      .panel-body{min-height:0;overflow-y:auto;flex:1;padding:16px 14px 24px;scrollbar-width:thin}
      h2{margin:0;color:${p.text};font-size:20px;line-height:1.25;letter-spacing:-.025em}.subline{margin:7px 0 0;color:${p.muted};font-size:13px;line-height:1.55}
      .overview-summary{overflow:hidden;border:1px solid ${p.border};border-radius:14px;padding:17px 16px 14px;background:${p.surface}}
      .summary-grid{display:grid;grid-template-columns:1.4fr 1fr;align-items:end}.summary-metric{display:flex;min-width:0;flex-direction:column;gap:7px}.summary-metric+.summary-metric{border-left:1px solid ${p.border};padding-left:17px}.summary-metric strong{color:${p.text};font-size:24px;font-variant-numeric:tabular-nums;font-weight:820;letter-spacing:-.045em;line-height:1}.summary-metric.primary strong{color:${p.brand};font-size:34px}.summary-metric span{color:${p.muted};font-size:11.5px;font-weight:700}
      .secondary{width:100%;min-height:36px;border:0;border-radius:9px;margin:14px 0 0;padding:0 12px;color:${p.soft};background:${p.surfaceMuted};font-size:12px;font-weight:720;line-height:1.2}.secondary::after{display:none}.secondary:hover{color:${p.text};background:color-mix(in srgb,${p.surfaceMuted} 88%,${p.text});transform:translateY(-1px)}
      .section-label{margin:19px 2px 8px;color:${p.soft};font-size:13px;font-weight:760;letter-spacing:0;line-height:1.3}
      .setting-list{overflow:hidden;border:1px solid ${p.border};border-radius:13px;margin:0;background:${p.surface}}.setting-list::before,.setting-list::after{display:none}
      .setting-row{display:grid;min-height:56px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;border-bottom:1px solid ${p.border};padding:0 13px}.setting-row::before{display:none}.setting-row:last-child{border-bottom:0}.setting-copy{display:flex;min-width:0;align-items:baseline;justify-content:space-between;gap:10px}.setting-copy strong{color:${p.soft};font-size:13.5px;font-weight:700}.setting-copy small{color:${p.muted};font-size:11.5px;white-space:nowrap}
      .switch{position:relative;width:40px;height:22px;appearance:none;border:1px solid ${p.borderStrong};border-radius:999px;margin:0;background:${p.surfaceMuted}}.switch::before{display:none}.switch::after{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:${p.muted};content:'';transition:transform 140ms ease,background 140ms ease}.switch:checked{border-color:color-mix(in srgb,${p.brand} 54%,${p.borderStrong});background:${p.brandSurface}}.switch:checked::after{background:${p.brand};transform:translateX(18px)}
      .rule-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.rule-count{display:flex;align-items:baseline;gap:4px;color:${p.muted}}.rule-count strong{color:${p.brand};font-size:24px;font-variant-numeric:tabular-nums;font-weight:820;line-height:1}.rule-count small{font-size:11px;font-weight:700}.mode{position:relative;z-index:0;display:grid;grid-template-columns:1fr 1fr;gap:3px;border:0;border-radius:11px;margin-top:15px;padding:3px;background:${p.surfaceMuted}}.mode::after,.mode button::after{display:none}.mode button{min-height:36px;border:0;border-radius:8px;padding:0;color:${p.muted};background:transparent;font-size:12.5px;font-weight:700;line-height:36px}.mode button.active{color:${p.text};background:${p.surface};box-shadow:0 1px 3px ${p.shadow}}
      .rule-form{margin-top:12px}.add-row{display:grid;grid-template-columns:minmax(0,1fr) 70px;gap:8px;padding:0;background:transparent}.add-row::before{display:none}.text-input{width:100%;height:42px;border:1px solid ${p.border};border-radius:9px;padding:0 12px;color:${p.text};background:${p.surface};outline:none;font-size:13px}.text-input:focus{border-color:${p.brand};box-shadow:0 0 0 3px color-mix(in srgb,${p.brand} 14%,transparent)}.add{width:100%;min-height:42px;border:1px solid ${p.brand};border-radius:9px;margin:0;color:${p.onBrand};background:${p.brand};font-size:13px;font-weight:750;line-height:1.2}.add::after{display:none}.add:hover{border-color:${p.brandStrong};background:${p.brandStrong};transform:translateY(-1px)}
      .regexp{display:flex;min-height:44px;align-items:center;gap:7px;margin-top:9px;padding:0 2px;color:${p.soft};background:transparent;font-size:12px}.regexp::before{display:none}
      .search-wrap{margin-top:15px;padding:0;background:transparent}.search-wrap::before,.search-wrap::after{display:none}.search{height:40px;margin:0}.rule-list{overflow:hidden;border:1px solid ${p.border};border-radius:12px;margin-top:8px;background:${p.surface}}.rule-list::before,.rule-list::after{display:none}.rule-row{display:grid;min-height:48px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:9px;border-bottom:1px solid ${p.border};padding:5px 7px 5px 12px}.rule-row::before{display:none}.rule-row:last-child{border-bottom:0}.rule-copy{display:flex;min-width:0;align-items:center;gap:7px}.rule-copy strong{overflow:hidden;color:${p.soft};font-size:13px;font-weight:680;text-overflow:ellipsis;white-space:nowrap}.tag{width:auto;height:auto;border-radius:5px;padding:3px 5px;color:${p.brand};background:${p.brandSurface};font-size:10px;font-weight:750;line-height:1.2}.remove{width:auto;min-height:32px;border:0;border-radius:8px;margin:0;padding:0 9px;color:${p.muted};background:transparent;font-size:11.5px;font-weight:700;line-height:32px}.remove::after{display:none}.remove:hover{color:${p.danger};background:${p.dangerSurface}}.empty{border:1px solid ${p.border};border-radius:12px;margin-top:12px;padding:18px 14px;color:${p.muted};background:${p.surface};font-size:12.5px;text-align:center}
      button:focus-visible,input:focus-visible{outline:3px solid color-mix(in srgb,${p.brand} 38%,transparent);outline-offset:2px}
      @media(max-width:520px){.panel{width:100vw}.panel-body{padding:15px 12px 22px}.panel-header{padding-inline:12px}.nav-wrap{padding-inline:10px}}
      @media(prefers-reduced-motion:reduce){.switch::after{transition:none}}
      @media(forced-colors:active){.panel,.setting-list,.mode,.text-input,.rule-list{border:1px solid CanvasText;box-shadow:none}.overlay{background:Canvas}.switch:checked::after{background:Highlight}}
    `
  }

  private renderHeader(): string {
    return `
      <header class="panel-header">
        <img src="${chrome.runtime.getURL('newsliquid-mark.png')}" alt="NewsLiquid" />
        <span class="title"><strong>NewsLiquid</strong><small>过滤规则 · ${this.storageManager.isFilterEnabled ? '已开启' : '已暂停'}</small></span>
        <button class="weui-btn weui-btn_mini weui-btn_default close" type="button" data-action="close" aria-label="关闭过滤设置">关闭</button>
      </header>
    `
  }

  private renderNavigation(): string {
    const items: Array<[CenterView, string]> = [
      ['overview', '总览'], ['account', '账号'], ['keyword', '内容'], ['username', '名称'],
    ]
    return `<div class="nav-wrap"><nav class="weui-navbar nav" aria-label="过滤设置">${items.map(([view, label]) => (
      `<button type="button" data-action="navigate" data-view="${view}" class="weui-navbar__item ${this.activeView === view ? 'active' : ''}">${label}</button>`
    )).join('')}</nav></div>`
  }

  private renderOverview(): string {
    const filteredCount = this.tweetProcessor.getFilteredCount()
    const systemCount = getAccountCount() + getWordCount() + getHandleCount()
    return `
      <section class="overview-summary" aria-label="过滤概况">
        <div class="summary-grid">
          <div class="summary-metric primary"><strong>${systemCount.toLocaleString()}</strong><span>系统规则</span></div>
          <div class="summary-metric"><strong>${this.storageManager.totalBlockCount.toLocaleString()}</strong><span>累计隐藏</span></div>
        </div>
        ${filteredCount ? `<button class="weui-btn weui-btn_mini weui-btn_default secondary" type="button" data-action="show-all">查看本页 ${filteredCount} 条</button>` : ''}
      </section>
      <h2 class="section-label">过滤范围</h2>
      <div class="weui-cells setting-list">
        ${this.renderSettingRow('启用过滤', '', 'isEnabled', this.storageManager.isFilterEnabled)}
        ${this.renderSettingRow('账号过滤', `${getAccountCount().toLocaleString()} 条`, 'accountFilterEnabled', this.storageManager.accountFilterEnabled)}
        ${this.renderSettingRow('内容过滤', `${getWordCount().toLocaleString()} 条`, 'keywordFilterEnabled', this.storageManager.keywordFilterEnabled)}
        ${this.renderSettingRow('显示名称过滤', `${getHandleCount().toLocaleString()} 条`, 'usernameFilterEnabled', this.storageManager.usernameFilterEnabled)}
      </div>
    `
  }

  private renderSettingRow(label: string, meta: string, key: string, checked: boolean): string {
    return `<label class="weui-cell weui-cell_switch setting-row"><span class="weui-cell__bd setting-copy"><strong>${label}</strong>${meta ? `<small>${meta}</small>` : ''}</span><span class="weui-cell__ft"><input class="weui-switch switch" type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''} aria-label="${label}" /></span></label>`
  }

  private renderRuleCenter(kind: FilterRuleKind): string {
    const label = FILTER_RULE_LABELS[kind]
    const total = this.getRules(kind, 'blocked').length + this.getRules(kind, 'allowed').length
    const visibleRuleCount = this.getRules(kind, this.activeMode).length
    const placeholder = kind === 'account' ? '@username' : kind === 'keyword' ? '输入关键词' : '输入显示名称特征'
    return `
      <div class="rule-head"><h2>${label}规则</h2><span class="rule-count"><strong>${total}</strong><small>条</small></span></div>
      <div class="weui-navbar mode" role="tablist" aria-label="规则类型">
        <button type="button" data-action="mode" data-mode="blocked" class="weui-navbar__item ${this.activeMode === 'blocked' ? 'active' : ''}">屏蔽 ${this.getRules(kind, 'blocked').length}</button>
        <button type="button" data-action="mode" data-mode="allowed" class="weui-navbar__item ${this.activeMode === 'allowed' ? 'active' : ''}">放行 ${this.getRules(kind, 'allowed').length}</button>
      </div>
      <section class="rule-form">
        <div class="weui-cell add-row"><div class="weui-cell__bd"><input id="nl-rule-input" class="weui-input text-input" type="text" placeholder="${placeholder}" autocomplete="off" /></div><div class="weui-cell__ft"><button class="weui-btn weui-btn_mini weui-btn_primary add" type="button" data-action="add-rule">添加</button></div></div>
        ${this.activeMode === 'blocked' && kind !== 'account' ? `<label class="weui-cell weui-cell_switch regexp"><span class="weui-cell__bd">使用正则表达式</span><span class="weui-cell__ft"><input id="nl-rule-regexp" class="weui-switch switch" type="checkbox" ${this.regexpMode ? 'checked' : ''} /></span></label>` : ''}
      </section>
      ${visibleRuleCount ? `<div class="weui-search-bar search-wrap"><div class="weui-search-bar__form"><div class="weui-search-bar__box"><input id="nl-rule-search" class="weui-search-bar__input text-input search" type="search" value="${this.escapeHtml(this.searchQuery)}" placeholder="搜索规则" aria-label="搜索${label}规则" /></div></div></div>` : ''}
      <div data-role="rule-list">${this.renderRuleItems(kind)}</div>
    `
  }

  private renderRuleItems(kind: FilterRuleKind): string {
    const query = this.searchQuery.trim().toLowerCase()
    const rules = this.getRules(kind, this.activeMode).filter((rule) => !query || ruleText(rule).toLowerCase().includes(query))
    if (!rules.length) return `<div class="empty">${query ? '没有找到匹配规则' : '暂无本地规则'}</div>`
    return `<div class="weui-cells rule-list">${rules.map((rule) => {
      const text = ruleText(rule)
      const regexp = ruleIsRegexp(rule)
      const display = kind === 'account' ? `@${text.replace(/^@/, '')}` : text
      return `<div class="weui-cell rule-row"><span class="weui-cell__bd rule-copy">${regexp ? '<span class="weui-badge tag">正则</span>' : ''}<strong title="${this.escapeHtml(text)}">${this.escapeHtml(display)}</strong></span><span class="weui-cell__ft"><button class="weui-btn weui-btn_mini weui-btn_warn remove" type="button" data-action="remove-rule" data-value="${this.escapeHtml(text)}" data-regexp="${regexp ? 'true' : 'false'}">删除</button></span></div>`
    }).join('')}</div>`
  }

  private getRules(kind: FilterRuleKind, mode: FilterRuleMode): StoredFilterRule[] {
    if (kind === 'account') return mode === 'blocked' ? this.storageManager.manualBlockedAccounts : this.storageManager.manualWhitelistAccounts
    if (kind === 'keyword') return mode === 'blocked' ? this.storageManager.manualBlockedKeywords : this.storageManager.manualWhitelistKeywords
    return mode === 'blocked' ? this.storageManager.manualBlockedUsernames : this.storageManager.manualWhitelistUsernames
  }

  private updateRuleList(): void {
    if (!this.root || this.activeView === 'overview') return
    const container = this.root.querySelector<HTMLElement>('[data-role="rule-list"]')
    if (container) container.innerHTML = this.renderRuleItems(this.activeView)
  }

  private handleRootClick = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement
    const actionTarget = target.closest<HTMLElement>('[data-action]')
    if (!actionTarget) {
      if (target.dataset.overlay === 'true') this.closeControlCenter()
      return
    }
    const action = actionTarget.dataset.action
    if (action === 'open') return this.openControlCenter()
    if (action === 'close') return this.closeControlCenter()
    if (action === 'show-all') {
      const count = this.tweetProcessor.showAllTweets()
      showPageNotice(count ? `已显示本页 ${count} 条内容` : '本页没有隐藏内容', 'neutral')
      this.render()
      return
    }
    if (action === 'navigate') {
      this.activeView = (actionTarget.dataset.view || 'overview') as CenterView
      this.activeMode = 'blocked'
      this.searchQuery = ''
      this.regexpMode = false
      this.render()
      this.animatePanelBodyIn()
      return
    }
    if (action === 'mode') {
      this.activeMode = actionTarget.dataset.mode === 'allowed' ? 'allowed' : 'blocked'
      this.searchQuery = ''
      this.regexpMode = false
      this.render()
      this.animatePanelBodyIn()
      return
    }
    if (action === 'add-rule' && this.activeView !== 'overview') return void await this.addCurrentRule(actionTarget as HTMLButtonElement)
    if (action === 'remove-rule' && this.activeView !== 'overview') {
      await removeFilterRule(this.activeView, this.activeMode, actionTarget.dataset.value || '', actionTarget.dataset.regexp === 'true')
      showPageNotice('规则已删除', 'success')
      this.render()
      return
    }
    if (action === 'allow-match') {
      const type = actionTarget.dataset.type
      const value = actionTarget.dataset.value
      if (type && value) await this.allowMatch(type, value, actionTarget as HTMLButtonElement)
    }
  }

  private handleRootChange = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement
    if (input.id === 'nl-rule-regexp') {
      this.regexpMode = input.checked
      return
    }
    const allowed = ['isEnabled', 'accountFilterEnabled', 'keywordFilterEnabled', 'usernameFilterEnabled', 'showBlockUI'] as const
    const setting = input.dataset.setting as typeof allowed[number] | undefined
    if (!setting || !allowed.includes(setting)) return
    if (setting === 'isEnabled') this.storageManager.isFilterEnabled = input.checked
    else if (setting === 'accountFilterEnabled') this.storageManager.accountFilterEnabled = input.checked
    else if (setting === 'keywordFilterEnabled') this.storageManager.keywordFilterEnabled = input.checked
    else if (setting === 'usernameFilterEnabled') this.storageManager.usernameFilterEnabled = input.checked
    else this.storageManager.showBlockUI = input.checked
    await chrome.storage.local.set({ [setting]: input.checked })
    this.onUIUpdateCallback?.()
    this.render()
  }

  private handleRootInput = (event: Event): void => {
    const input = event.target as HTMLInputElement
    if (input.id !== 'nl-rule-search') return
    this.searchQuery = input.value
    this.updateRuleList()
  }

  private handleRootKeydown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent
    const input = keyboardEvent.target as HTMLInputElement
    if (keyboardEvent.key === 'Enter' && input.id === 'nl-rule-input' && this.activeView !== 'overview') {
      keyboardEvent.preventDefault()
      const button = this.root?.querySelector<HTMLButtonElement>('[data-action="add-rule"]')
      if (button) void this.addCurrentRule(button)
    }
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (this.reportPopover) this.closeReportConfirmation()
    else if (this.panelOpen) this.closeControlCenter()
  }

  private async addCurrentRule(button: HTMLButtonElement): Promise<void> {
    if (this.activeView === 'overview') return
    const input = this.root?.querySelector<HTMLInputElement>('#nl-rule-input')
    const value = input?.value.trim() || ''
    if (!value) {
      showPageNotice('请输入规则内容', 'warning')
      input?.focus()
      return
    }
    button.disabled = true
    try {
      const result = await addFilterRule(this.activeView, this.activeMode, value, this.regexpMode)
      showPageNotice(result.added ? '规则已添加' : '规则已经存在', result.added ? 'success' : 'warning')
      this.searchQuery = ''
      this.regexpMode = false
      this.render()
    } catch (error) {
      button.disabled = false
      showPageNotice(error instanceof Error ? error.message : '添加规则失败', 'error')
    }
  }

  private async allowMatch(type: string, value: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    try {
      if (type === '账户') {
        const result = await this.reportManager.handleFeedbackMisreport(value)
        if (!result.success) throw new Error(result.error || '放行失败')
      } else {
        const kind = filterTypeToRuleKind(type)
        if (!kind) throw new Error('无法识别规则类型')
        await addFilterRule(kind, 'allowed', value)
      }
      this.tweetProcessor.showUserTweets(value)
      showPageNotice('放行规则已生效', 'success')
      this.render()
    } catch (error) {
      button.disabled = false
      showPageNotice(error instanceof Error ? error.message : '放行失败', 'error')
    }
  }

  private openReportConfirmation(anchor: HTMLButtonElement, username: string): void {
    this.closeReportConfirmation()
    const palette = this.getPalette()
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(320, innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), innerWidth - width - 12)
    const top = Math.min(rect.bottom + 8, innerHeight - 150)
    const host = document.createElement('div')
    host.className = 'newsliquid-report-confirmation-host'
    host.style.cssText = `position:fixed;z-index:2147483647;top:${Math.max(12, top)}px;left:${left}px;width:${width}px;`
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `
      <style>${weuiCss}:host{all:initial}*{box-sizing:border-box}.card{position:relative;top:auto;left:auto;width:auto;max-width:none;border:1px solid ${palette.borderStrong};border-radius:14px;margin:0;padding:14px;color:${palette.text};background:${palette.surface};box-shadow:0 16px 45px ${palette.shadow};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;transform:none}.head{display:flex;align-items:center;gap:10px}img{width:30px;height:30px;object-fit:contain}.copy{display:flex;min-width:0;flex-direction:column;gap:4px}strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}small{color:${palette.muted};font-size:12px;line-height:1.45}.actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin-top:13px}.actions::after{display:none}button{min-height:38px;border:1px solid ${palette.border};border-radius:9px;color:${palette.soft};background:${palette.surfaceMuted};cursor:pointer;font:700 12px/38px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.actions button::after{display:none}.confirm{border-color:${palette.brand};color:${palette.onBrand};background:${palette.brand}}button:disabled{cursor:wait;opacity:.65}</style>
      <section class="weui-dialog card" role="dialog" aria-label="确认上报账号"><div class="head"><img src="${chrome.runtime.getURL('newsliquid-mark.png')}" alt="NewsLiquid"/><span class="copy"><strong></strong><small>提交反馈并加入本地屏蔽列表</small></span></div><div class="weui-dialog__ft actions"><button class="weui-dialog__btn weui-dialog__btn_default cancel" type="button">取消</button><button class="weui-dialog__btn weui-dialog__btn_primary confirm" type="button">上报并屏蔽</button></div></section>
    `
    const title = root.querySelector('strong')
    if (title) title.textContent = `屏蔽 @${username}`
    root.querySelector('.cancel')?.addEventListener('click', () => this.closeReportConfirmation())
    root.querySelector('.confirm')?.addEventListener('click', async () => {
      const button = root.querySelector('.confirm') as HTMLButtonElement | null
      if (!button) return
      button.disabled = true
      const result = await this.reportManager.handleManualReport(username)
      if (result.success) {
        this.closeReportConfirmation()
        showPageNotice(`已屏蔽 @${username}`, 'success')
      } else {
        button.disabled = false
        showPageNotice(result.error || '上报失败', 'error')
      }
    })
    document.body.appendChild(host)
    this.reportPopover = host
    const card = root.querySelector<HTMLElement>('.card')
    if (card && !this.prefersReducedMotion()) {
      gsap.fromTo(card, { autoAlpha: 0, y: 8, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' })
    }
  }

  private closeReportConfirmation(): void {
    this.reportPopover?.remove()
    this.reportPopover = null
  }

  private escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  }
}
