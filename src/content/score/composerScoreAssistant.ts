import { gsap } from 'gsap'
import weuiCss from 'weui/dist/style/weui.min.css?inline'
import {
  checkPhoenixHealth,
  loadPhoenixSettings,
  savePhoenixSettings,
  scorePhoenixDraft,
  type PhoenixProfile,
  type PhoenixScoreResult,
} from '../../services/phoenixScoreService'

const BUTTON_HOST_ID = 'newsliquid-compose-score-trigger'
const PANEL_HOST_ID = 'newsliquid-compose-score-panel'
const PANEL_POSITION_KEY = 'newsLiquidScorePanelPosition'
const PROFILE_DETECTED_AT_KEY = 'newsLiquidProfileDetectedAt'
const EDITOR_SELECTOR = '[data-testid^="tweetTextarea_"][contenteditable="true"], [data-testid^="tweetTextarea_"] [contenteditable="true"]'
const PANEL_WIDTH = 408
const PANEL_GUTTER = 12

interface ComposeMount {
  buttonTarget: HTMLElement
  root: HTMLElement
}

interface PanelPosition {
  left: number
  top: number
}

export class ComposerScoreAssistant {
  private buttonHost: HTMLSpanElement | null = null
  private buttonShadow: ShadowRoot | null = null
  private panelHost: HTMLDivElement | null = null
  private panelShadow: ShadowRoot | null = null
  private activeEditor: HTMLElement | null = null
  private composeRoot: HTMLElement | null = null
  private observer: MutationObserver | null = null
  private lastResult: PhoenixScoreResult | null = null
  private panelOpen = false
  private remountQueued = false
  private profileCaptureTimer: number | null = null
  private healthReady = false
  private profileProbePromise: Promise<Partial<PhoenixProfile> | null> | null = null
  private lastDraftText = ''

  initialize(): void {
    document.addEventListener('focusin', this.handleFocus, true)
    document.addEventListener('input', this.handleInput, true)
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage)
    window.addEventListener('resize', this.handleResize)
    this.observer = new MutationObserver(() => {
      this.queueRemount()
      this.queueProfileCapture()
    })
    this.observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    const active = document.activeElement
    if (active instanceof HTMLElement) this.activateFrom(active, false)
    this.queueProfileCapture()
    void this.consumeOpenRequest()
  }

  destroy(): void {
    document.removeEventListener('focusin', this.handleFocus, true)
    document.removeEventListener('input', this.handleInput, true)
    chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage)
    window.removeEventListener('resize', this.handleResize)
    if (this.profileCaptureTimer) window.clearTimeout(this.profileCaptureTimer)
    this.observer?.disconnect()
    this.buttonHost?.remove()
    this.panelHost?.remove()
    this.buttonHost = null
    this.buttonShadow = null
    this.panelHost = null
    this.panelShadow = null
    this.activeEditor = null
    this.composeRoot = null
  }

  private handleRuntimeMessage = (
    message: { type?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; error?: string }) => void,
  ): boolean | undefined => {
    if (message.type !== 'SHOW_COMPOSER_ASSISTANT') return undefined
    const editor = this.findVisibleEditor()
    if (!editor) {
      sendResponse({ success: false, error: '当前页面没有可见的 X 发帖框' })
      return false
    }
    this.activateEditor(editor, true)
    editor.focus({ preventScroll: true })
    sendResponse({ success: true })
    return false
  }

  private handleFocus = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement) this.activateFrom(event.target, false)
  }

  private handleInput = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null
    if (!target) return
    const editor = target.matches(EDITOR_SELECTOR)
      ? target as HTMLElement
      : target.closest<HTMLElement>(EDITOR_SELECTOR)
    if (!editor) return
    if (editor !== this.activeEditor) this.activateEditor(editor, false)
    this.lastResult = null
    this.renderDraft()
    this.renderResult(null)
  }

  private handleResize = (): void => {
    if (!this.panelOpen || !this.panelHost) return
    const rect = this.panelHost.getBoundingClientRect()
    this.applyPanelPosition(this.clampPosition({ left: rect.left, top: rect.top }))
  }

  private async consumeOpenRequest(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get('phoenixOpenComposerRequestedAt')
      const requestedAt = Number(stored.phoenixOpenComposerRequestedAt || 0)
      if (!requestedAt || Date.now() - requestedAt > 30_000) return
      await chrome.storage.local.remove('phoenixOpenComposerRequestedAt')
      const tryOpen = (): boolean => {
        const editor = this.findVisibleEditor()
        if (!editor) return false
        this.activateEditor(editor, true)
        editor.focus({ preventScroll: true })
        return true
      }
      if (tryOpen()) return
      let attempts = 0
      const timer = window.setInterval(() => {
        attempts += 1
        if (tryOpen() || attempts >= 24) window.clearInterval(timer)
      }, 250)
    } catch (error) {
      console.warn('[NewsLiquid] 无法读取评分浮窗打开请求:', error)
    }
  }

  private queueRemount(): void {
    if (this.remountQueued) return
    this.remountQueued = true
    queueMicrotask(() => {
      this.remountQueued = false
      if (this.activeEditor && !this.activeEditor.isConnected) {
        const replacement = this.findVisibleEditor()
        if (replacement) {
          this.activateEditor(replacement, false)
        } else {
          this.activeEditor = null
          this.composeRoot = null
          this.buttonHost?.remove()
          this.hidePanel()
          return
        }
      }
      if (this.activeEditor && !this.buttonHost?.isConnected) this.mountForEditor(this.activeEditor)
      if (this.activeEditor) {
        const text = this.editorText()
        if (text !== this.lastDraftText) {
          this.lastResult = null
          this.renderDraft()
          this.renderResult(null)
        }
      }
    })
  }

  private queueProfileCapture(): void {
    if (this.profileCaptureTimer) return
    this.profileCaptureTimer = window.setTimeout(() => {
      this.profileCaptureTimer = null
      void this.captureProfileFromCurrentPage().catch((error) => {
        if (!String(error).includes('Extension context invalidated')) {
          console.warn('[NewsLiquid] 自动识别账号失败:', error)
        }
      })
    }, 500)
  }

  private activateFrom(target: HTMLElement, openPanel: boolean): void {
    const editor = target.closest<HTMLElement>(EDITOR_SELECTOR)
    if (editor) this.activateEditor(editor, openPanel)
  }

  private activateEditor(editor: HTMLElement, openPanel: boolean): void {
    const changed = editor !== this.activeEditor
    this.activeEditor = editor
    this.ensureUI()
    this.mountForEditor(editor)
    this.renderDraft()
    if (changed) {
      this.lastResult = null
      this.renderResult(null)
    }
    if (openPanel) this.showPanel()
  }

  private findVisibleEditor(): HTMLElement | null {
    const editors = Array.from(document.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)).filter((editor) => this.isVisible(editor))
    return editors.find((editor) => Boolean(editor.closest('[role="dialog"]'))) || editors[0] || null
  }

  private isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  private findMount(editor: HTMLElement): ComposeMount | null {
    let scope: HTMLElement | null = editor.parentElement
    let toolbar: HTMLElement | null = null
    while (scope && scope !== document.documentElement) {
      toolbar = Array.from(scope.querySelectorAll<HTMLElement>('[data-testid="toolBar"]')).find((candidate) => this.isVisible(candidate)) || null
      if (toolbar) break
      scope = scope.parentElement
    }
    if (!toolbar) return null
    const navigation = toolbar.querySelector<HTMLElement>('nav')
    const buttonTarget = navigation?.firstElementChild instanceof HTMLElement ? navigation.firstElementChild : navigation || toolbar
    let root: HTMLElement | null = toolbar
    while (root.parentElement && !root.contains(editor)) root = root.parentElement
    return root ? { buttonTarget, root } : null
  }

  private mountForEditor(editor: HTMLElement): void {
    const mount = this.findMount(editor)
    if (!mount || !this.buttonHost) return
    if (this.buttonHost.parentElement !== mount.buttonTarget) mount.buttonTarget.appendChild(this.buttonHost)
    this.composeRoot = mount.root
    this.applyTheme()
  }

  private ensureUI(): void {
    if (!this.buttonHost || !this.buttonShadow) this.createTrigger()
    if (!this.panelHost || !this.panelShadow) this.createPanel()
  }

  private createTrigger(): void {
    this.buttonHost = document.createElement('span')
    this.buttonHost.id = BUTTON_HOST_ID
    this.buttonHost.style.cssText = 'display:inline-flex;align-items:center;flex:0 0 auto;'
    this.buttonShadow = this.buttonHost.attachShadow({ mode: 'open' })
    this.buttonShadow.innerHTML = `
      <style>
        ${weuiCss}
        :host{display:inline-flex;align-items:center;flex:0 0 auto;margin-inline-start:3px;color-scheme:light}*{box-sizing:border-box}
        button.weui-btn{display:inline-flex;width:auto;height:32px;align-items:center;gap:5px;border:0;border-radius:999px;margin:0;padding:0 9px 0 6px;color:#6048d4;background:rgba(109,85,231,.09);cursor:pointer;font:700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;line-height:32px;transition:color 140ms ease,background 140ms ease}button.weui-btn::after{display:none}
        button:hover{color:#5038c7;background:rgba(109,85,231,.15)}button:focus-visible{outline:3px solid rgba(109,85,231,.3);outline-offset:2px}img{width:18px;height:18px;object-fit:contain}
        :host([data-theme="dark"]) button{color:#b9aaff;background:rgba(169,149,255,.12)}:host([data-theme="dark"]) button:hover{color:#d3c9ff;background:rgba(169,149,255,.19)}
        @media(max-width:520px){button{width:32px;justify-content:center;padding:0}.label{display:none}}@media(forced-colors:active){button{border:1px solid ButtonText;color:ButtonText;background:ButtonFace}}
      </style>
      <button class="weui-btn weui-btn_mini weui-btn_default" type="button" aria-label="打开 NewsLiquid 推文评分" aria-expanded="false"><img src="${chrome.runtime.getURL('newsliquid-mark.png')}" alt=""/><span class="label">评分</span></button>
    `
    this.buttonShadow.querySelector('button')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.panelOpen) this.hidePanel()
      else this.showPanel()
    })
  }

  private createPanel(): void {
    this.panelHost = document.createElement('div')
    this.panelHost.id = PANEL_HOST_ID
    this.panelHost.style.cssText = `position:fixed;z-index:2147483646;display:none;width:min(${PANEL_WIDTH}px,calc(100vw - 24px));`
    this.panelShadow = this.panelHost.attachShadow({ mode: 'open' })
    this.panelShadow.innerHTML = `
      <style>
        ${weuiCss}
        :host{color-scheme:light}*{box-sizing:border-box}button{font:inherit}
        .panel{--canvas:#fdfcfe;--surface:#f5f3f8;--surface-strong:#ece9f1;--border:rgba(31,27,43,.12);--border-strong:rgba(31,27,43,.2);--text:#1d1925;--soft:#514b5b;--muted:#7b7485;--brand:#6d55e7;--brand-strong:#5940d5;--brand-ink:#4d35bc;--brand-bg:#efebff;--success:#177a5a;--success-bg:#edf8f3;--danger:#b3424b;--danger-bg:#fff0f1;max-height:min(78vh,720px);overflow:hidden;border:1px solid var(--border);border-radius:18px;color:var(--text);background:var(--canvas);box-shadow:0 22px 60px rgba(28,23,45,.2);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-synthesis:none;text-rendering:optimizeLegibility}
        .scroll{max-height:min(78vh,720px);overflow-y:auto;overscroll-behavior:contain;scrollbar-color:var(--border-strong) transparent;scrollbar-width:thin}.panel-header{display:flex;min-height:57px;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding:10px 12px 10px 15px;cursor:grab;user-select:none;touch-action:none}.panel-header:active{cursor:grabbing}.brand-lockup{display:flex;min-width:0;align-items:center;gap:9px}.brand-mark{width:24px;height:24px;flex:0 0 24px;object-fit:contain}.brand-name{color:var(--text);font-size:13px;font-weight:780;letter-spacing:-.015em;line-height:1.2;white-space:nowrap}.mode{border-left:1px solid var(--border-strong);padding-left:9px;color:var(--muted);font-size:11px;font-weight:720;line-height:1.2;white-space:nowrap}.header-tools{display:flex;flex:0 0 auto;align-items:center;gap:4px}.health{display:inline-flex;height:28px;align-items:center;gap:6px;border:0;border-radius:999px;padding:0 8px;color:var(--muted);background:var(--surface);cursor:pointer;font-size:10.5px;font-weight:700}.health::before{width:6px;height:6px;border-radius:999px;background:currentColor;content:""}.health.online{color:var(--success);background:var(--success-bg)}.health.offline{color:var(--danger);background:var(--danger-bg)}.close{height:28px;border:0;border-radius:8px;padding:0 7px;color:var(--muted);background:transparent;cursor:pointer;font-size:11px;font-weight:700}.close:hover{color:var(--text);background:var(--surface)}
        .content{padding:14px 15px 16px}.context-line.weui-cell{display:flex;min-height:40px;align-items:center;justify-content:space-between;gap:12px;padding:0 2px 11px;background:transparent}.context-line.weui-cell::before{display:none}.profile{display:flex;min-width:0;align-items:center}.profile-copy{display:flex;min-width:0;flex-direction:column;gap:1px}.profile-copy strong{overflow:hidden;color:var(--text);font-size:12px;font-weight:740;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.profile-copy small{color:var(--muted);font-size:10.5px;line-height:1.35}.count{flex:0 0 auto;color:var(--muted);font:720 11px/1.3 "SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums}.action-row{border-top:1px solid var(--border);padding-top:11px}.score.weui-btn{width:100%;min-height:42px;border:1px solid var(--brand);border-radius:11px;margin:0;padding:0 16px;color:#fff;background:var(--brand);box-shadow:0 7px 18px rgba(89,64,213,.2);cursor:pointer;font-size:13px;font-weight:780;letter-spacing:.01em;line-height:40px;transition:background 140ms ease,box-shadow 140ms ease,transform 140ms ease}.score.weui-btn::after{display:none}.score:hover{background:var(--brand-strong);box-shadow:0 9px 22px rgba(89,64,213,.27);transform:translateY(-1px)}.score:active{box-shadow:0 4px 12px rgba(89,64,213,.18);transform:translateY(0)}.score:disabled{cursor:not-allowed;box-shadow:none;opacity:.38;transform:none}.score.loading{cursor:wait}
        .result{display:none;margin-top:15px}.result.visible{display:grid;gap:13px}.result.error .signal{display:none}.signal{overflow:hidden;border:1px solid var(--border);border-radius:16px;background:var(--canvas)}.result-top{display:grid;grid-template-columns:132px minmax(0,1fr);min-height:126px;color:var(--text);background:var(--surface)}.quality,.forecast{display:flex;min-width:0;justify-content:center;padding:17px;flex-direction:column}.quality{border-right:1px solid var(--border)}.quality span,.forecast>span{color:var(--muted);font-size:10.5px;font-weight:720;line-height:1.3}.quality strong{margin-top:7px;color:var(--brand-ink);font:820 46px/.9 "SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.055em}.quality small{margin-top:8px;color:var(--soft);font-size:11px;font-weight:760;line-height:1.25}.forecast>strong{margin-top:8px;color:var(--text);font:790 28px/1 "SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.03em}.forecast>small{margin-top:9px;color:var(--soft);font-size:11px;line-height:1.45}.engagement{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);background:var(--canvas)}.metric{display:flex;min-width:0;align-items:baseline;justify-content:center;gap:5px;padding:10px 7px}.metric+.metric{border-left:1px solid var(--border)}.metric span{color:var(--muted);font-size:10px;line-height:1.3}.metric strong{overflow:hidden;color:var(--text);font:750 12.5px/1.2 "SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums;text-overflow:ellipsis}.insights.weui-cells{display:grid;margin:0;background:transparent}.insights.weui-cells::before,.insights.weui-cells::after{display:none}.insight.weui-cell{display:block;border-top:1px solid var(--border);padding:13px 4px 14px 2px;background:transparent}.insight:first-child{border-top:0}.insight strong{display:block;color:var(--muted);font-size:11px;font-weight:780;line-height:1.35}.insight.improve strong{color:var(--brand-ink)}.insight p{margin:6px 0 0;color:var(--soft);font-size:12.5px;line-height:1.65;white-space:pre-wrap}.insight.error{border:1px solid color-mix(in srgb,var(--danger) 22%,var(--border));border-radius:12px;padding:12px 13px;background:var(--danger-bg)}.insight.error strong,.insight.error p{color:var(--danger)}
        :host([data-theme="dark"]){color-scheme:dark}:host([data-theme="dark"]) .panel{--canvas:#17171d;--surface:#202027;--surface-strong:#2a2933;--border:rgba(241,238,248,.12);--border-strong:rgba(241,238,248,.22);--text:#f4f2f8;--soft:#cbc7d3;--muted:#948e9e;--brand:#a590ff;--brand-strong:#b5a5ff;--brand-ink:#cfc4ff;--brand-bg:#2d2747;--success:#65d6ad;--success-bg:#17342c;--danger:#ff9b9e;--danger-bg:#3c2328;box-shadow:0 24px 68px rgba(0,0,0,.46)}:host([data-theme="dark"]) .score{color:#1c143d}
        button:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 38%,transparent);outline-offset:2px}@media(max-width:560px){.panel-header{cursor:default}.mode{display:none}.health{width:28px;justify-content:center;padding:0}.health-label{display:none}}@media(max-width:420px){.panel-header{padding-inline:11px}.content{padding-inline:12px}.result-top{grid-template-columns:118px minmax(0,1fr)}}@media(forced-colors:active){.panel,.context-line,.signal,.insight{border:1px solid CanvasText;box-shadow:none}.health,.close,.score{border:1px solid ButtonText}.result-top{color:CanvasText;background:Canvas}.score{color:HighlightText;background:Highlight}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
      </style>
      <section class="panel" aria-label="NewsLiquid 发布前评分">
        <div class="scroll">
          <header class="panel-header">
            <span class="brand-lockup"><img class="brand-mark" src="${chrome.runtime.getURL('newsliquid-mark.png')}" alt="NewsLiquid"/><span class="brand-name">NewsLiquid</span><span class="mode">推文分析</span></span>
            <span class="header-tools"><button class="weui-btn weui-btn_mini weui-btn_default health" type="button" aria-label="检测评分服务"><span class="health-label">检测服务</span></button><button class="weui-btn weui-btn_mini weui-btn_default close" type="button">关闭</button></span>
          </header>
          <main class="content">
            <section class="weui-cell context-line"><div class="weui-cell__bd profile"><span class="profile-copy"><strong>正在识别当前账号</strong><small>读取账号数据</small></span></div><span class="weui-cell__ft count" aria-label="草稿字数">0 字</span></section>
            <div class="action-row"><button class="weui-btn weui-btn_primary score" type="button" disabled>开始分析</button></div>
            <div class="result" aria-live="polite">
              <div class="signal"><div class="result-top"><div class="quality"><span>质量分</span><strong>0</strong><small>等待分析</small></div><div class="forecast"><span>预估浏览</span><strong>0</strong><small>等待分析</small></div></div><div class="engagement"><div class="metric"><span>点赞</span><strong class="likes">0</strong></div><div class="metric"><span>回复</span><strong class="replies">0</strong></div><div class="metric"><span>转发</span><strong class="retweets">0</strong></div><div class="metric"><span>引用</span><strong class="quotes">0</strong></div></div></div>
              <div class="weui-cells insights"><div class="weui-cell insight review"><strong>内容判断</strong><p></p></div><div class="weui-cell insight improve"><strong>优化建议</strong><p></p></div></div>
            </div>
          </main>
        </div>
      </section>
    `
    this.panelShadow.querySelector('.close')?.addEventListener('click', () => this.hidePanel())
    this.panelShadow.querySelector('.health')?.addEventListener('click', () => void this.refreshHealth())
    this.panelShadow.querySelector('.score')?.addEventListener('click', () => void this.score())
    this.panelShadow.querySelector('.panel-header')?.addEventListener('pointerdown', this.startDrag)
    document.body.appendChild(this.panelHost)
  }

  private applyTheme(): void {
    const background = getComputedStyle(document.body).backgroundColor
    const channels = background.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
    const dark = channels?.length === 3
      ? channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < 128
      : matchMedia('(prefers-color-scheme:dark)').matches
    const theme = dark ? 'dark' : 'light'
    if (this.buttonHost) this.buttonHost.dataset.theme = theme
    if (this.panelHost) this.panelHost.dataset.theme = theme
  }

  private showPanel(): void {
    if (!this.activeEditor) return
    this.ensureUI()
    this.mountForEditor(this.activeEditor)
    if (!this.panelHost) return
    this.panelOpen = true
    this.panelHost.style.display = 'block'
    this.buttonShadow?.querySelector('button')?.setAttribute('aria-expanded', 'true')
    this.applyTheme()
    this.placePanelNearEditor()
    void this.restoreSavedPosition()
    this.animatePanelIn()
    this.renderDraft()
    void this.renderProfile(true)
    void this.refreshHealth()
  }

  private hidePanel(): void {
    this.panelOpen = false
    this.buttonShadow?.querySelector('button')?.setAttribute('aria-expanded', 'false')
    if (!this.panelHost) return
    const panel = this.panelShadow?.querySelector<HTMLElement>('.panel')
    if (!panel || this.prefersReducedMotion()) {
      this.panelHost.style.display = 'none'
      return
    }
    gsap.killTweensOf(panel)
    gsap.to(panel, {
      autoAlpha: 0,
      y: 8,
      scale: 0.985,
      duration: 0.16,
      ease: 'power2.in',
      onComplete: () => {
        if (this.panelHost && !this.panelOpen) this.panelHost.style.display = 'none'
      },
    })
  }

  private prefersReducedMotion(): boolean {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private animatePanelIn(): void {
    const panel = this.panelShadow?.querySelector<HTMLElement>('.panel')
    if (!panel) return
    gsap.killTweensOf(panel)
    if (this.prefersReducedMotion()) {
      gsap.set(panel, { clearProps: 'opacity,visibility,transform' })
      return
    }
    gsap.fromTo(
      panel,
      { autoAlpha: 0, y: 10, scale: 0.985 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out' },
    )
  }

  private animateResultIn(): void {
    if (this.prefersReducedMotion()) return
    const elements = this.panelShadow?.querySelectorAll<HTMLElement>('.result.visible .signal,.result.visible .insight')
    if (!elements?.length) return
    gsap.killTweensOf(elements)
    gsap.fromTo(
      elements,
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.055, ease: 'power2.out' },
    )
  }

  private placePanelNearEditor(): void {
    if (!this.panelHost || !this.activeEditor) return
    const editor = this.activeEditor.getBoundingClientRect()
    const width = this.panelHost.offsetWidth || Math.min(PANEL_WIDTH, innerWidth - PANEL_GUTTER * 2)
    const preferredRight = editor.right + 14
    const left = preferredRight + width <= innerWidth - PANEL_GUTTER
      ? preferredRight
      : Math.max(PANEL_GUTTER, editor.left - width - 14)
    this.applyPanelPosition(this.clampPosition({ left, top: Math.max(PANEL_GUTTER, editor.top - PANEL_GUTTER) }))
  }

  private async restoreSavedPosition(): Promise<void> {
    const stored = await chrome.storage.local.get(PANEL_POSITION_KEY)
    const value = stored[PANEL_POSITION_KEY] as Partial<PanelPosition> | undefined
    if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) return
    this.applyPanelPosition(this.clampPosition({ left: Number(value.left), top: Number(value.top) }))
  }

  private clampPosition(position: PanelPosition): PanelPosition {
    const width = this.panelHost?.offsetWidth || Math.min(PANEL_WIDTH, innerWidth - PANEL_GUTTER * 2)
    const height = Math.min(this.panelHost?.offsetHeight || 300, innerHeight - PANEL_GUTTER * 2)
    return {
      left: Math.min(Math.max(PANEL_GUTTER, position.left), Math.max(PANEL_GUTTER, innerWidth - width - PANEL_GUTTER)),
      top: Math.min(Math.max(PANEL_GUTTER, position.top), Math.max(PANEL_GUTTER, innerHeight - height - PANEL_GUTTER)),
    }
  }

  private applyPanelPosition(position: PanelPosition): void {
    if (!this.panelHost) return
    this.panelHost.style.left = `${Math.round(position.left)}px`
    this.panelHost.style.top = `${Math.round(position.top)}px`
    this.panelHost.style.right = 'auto'
  }

  private startDrag = (event: Event): void => {
    const pointer = event as PointerEvent
    if (!this.panelHost || innerWidth <= 560) return
    if ((pointer.target as Element | null)?.closest('button')) return
    pointer.preventDefault()
    const rect = this.panelHost.getBoundingClientRect()
    const offsetX = pointer.clientX - rect.left
    const offsetY = pointer.clientY - rect.top
    const move = (moveEvent: PointerEvent) => {
      this.applyPanelPosition(this.clampPosition({ left: moveEvent.clientX - offsetX, top: moveEvent.clientY - offsetY }))
    }
    const stop = async () => {
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', stop, true)
      const current = this.panelHost?.getBoundingClientRect()
      if (current) await chrome.storage.local.set({ [PANEL_POSITION_KEY]: { left: current.left, top: current.top } })
    }
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', stop, true)
  }

  private editorText(): string {
    return (this.activeEditor?.innerText || this.activeEditor?.textContent || '').trim()
  }

  private renderDraft(): void {
    if (!this.panelShadow) return
    const text = this.editorText()
    this.lastDraftText = text
    const length = Array.from(text).length
    const count = this.panelShadow.querySelector<HTMLElement>('.count')
    const button = this.panelShadow.querySelector<HTMLButtonElement>('.score')
    if (count) {
      count.textContent = `${length.toLocaleString('zh-CN')} 字`
    }
    if (button && !button.classList.contains('loading')) {
      button.disabled = !text
      button.textContent = this.lastResult ? '重新分析' : '开始分析'
    }
  }

  private async refreshHealth(): Promise<void> {
    if (!this.panelShadow) return
    const button = this.panelShadow.querySelector<HTMLButtonElement>('.health')
    const label = button?.querySelector<HTMLElement>('.health-label')
    if (label) label.textContent = '检测中'
    button?.classList.remove('online', 'offline')
    button?.setAttribute('aria-label', '正在检测评分服务')
    const health = await checkPhoenixHealth()
    this.healthReady = Boolean(health.online)
    button?.classList.toggle('online', this.healthReady)
    button?.classList.toggle('offline', !this.healthReady)
    const status = this.healthReady ? '服务正常' : '未连接'
    if (label) label.textContent = status
    button?.setAttribute('aria-label', `评分服务${status}，点击重新检测`)
    if (button) button.title = `评分服务${status}`
  }

  private currentHandle(): string {
    const link = document.querySelector<HTMLAnchorElement>('a[data-testid="AppTabBar_Profile_Link"]')
    return link?.getAttribute('href')?.match(/^\/([^/]+)$/)?.[1] || ''
  }

  private parseFollowerCount(value: string): number {
    const normalized = value.trim().replaceAll(',', '').replaceAll('，', '').replace(/\s+/g, '')
    const match = normalized.match(/([\d.]+)(万|亿|千|[KMB])?/i)
    if (!match) return 0
    const multiplier: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000, 千: 1_000, 万: 10_000, 亿: 100_000_000 }
    return Math.max(0, Math.round(Number(match[1]) * (multiplier[(match[2] || '').toUpperCase()] || multiplier[match[2] || ''] || 1)))
  }

  private readCurrentAccountFromDocument(doc: Document, handle: string): Partial<PhoenixProfile> | null {
    const switcher = doc.querySelector<HTMLElement>('[data-testid="SideNav_AccountSwitcher_Button"]')
    if (!switcher) return null
    const textValues = Array.from(switcher.querySelectorAll('span'))
      .map((span) => (span.textContent || '').trim())
      .filter(Boolean)
    const accountHandle = textValues.find((value) => value.startsWith('@'))?.slice(1) || ''
    const normalizedHandle = handle.replace(/^@/, '').toLowerCase()
    if (accountHandle && normalizedHandle && accountHandle.toLowerCase() !== normalizedHandle) return null
    const name = textValues.find((value) => !value.startsWith('@') && value !== '·') || ''
    const verified = Boolean(switcher.querySelector('[data-testid="icon-verified"],[aria-label*="认证"],[aria-label*="Verified"]'))
    if (!name && !verified) return null
    return { handle, name, verified }
  }

  private isTargetProfileDocument(doc: Document, handle: string): boolean {
    try {
      const segments = new URL(doc.URL).pathname.split('/').filter(Boolean)
      if (segments[0]?.toLowerCase() !== handle.replace(/^@/, '').toLowerCase()) return false
      return !segments[1] || ['with_replies', 'media', 'likes', 'followers', 'verified_followers', 'following'].includes(segments[1])
    } catch {
      return false
    }
  }

  private readProfileFromDocument(doc: Document, handle: string): Partial<PhoenixProfile> | null {
    if (!handle) return null
    const followersLink = doc.querySelector<HTMLAnchorElement>(`a[href="/${handle}/followers"],a[href="/${handle}/verified_followers"]`)
    const followers = this.parseFollowerCount(followersLink?.textContent || followersLink?.getAttribute('aria-label') || '')
    const isTargetProfile = this.isTargetProfileDocument(doc, handle)
    const userName = isTargetProfile ? doc.querySelector('[data-testid="UserName"]') : null
    const currentAccount = this.readCurrentAccountFromDocument(doc, handle)
    let name = ''
    for (const span of Array.from(userName?.querySelectorAll('span') || [])) {
      const text = (span.textContent || '').trim()
      if (text && !text.startsWith('@') && text !== '·' && text.length > 1) {
        name = text
        break
      }
    }
    if (!name && isTargetProfile) {
      const titleMatch = doc.title.match(/^(.+?)\s+\(@[^)]+\)\s*\/\s*X$/)
      name = titleMatch?.[1]?.trim() || ''
    }
    if (!name) name = currentAccount?.name || ''
    const verified = Boolean(
      userName?.querySelector('[data-testid="icon-verified"],[aria-label*="认证"],[aria-label*="Verified"]')
      || currentAccount?.verified,
    )
    if (!followers && !name && !verified) return null
    return { handle, name, followers, verified }
  }

  private async captureProfileFromCurrentPage(): Promise<void> {
    const settings = await loadPhoenixSettings()
    const handle = this.currentHandle() || settings.profile.handle
    if (!handle) return
    const sameAccount = settings.profile.handle.replace(/^@/, '').toLowerCase() === handle.replace(/^@/, '').toLowerCase()
    const detected = this.readProfileFromDocument(document, handle)
    if (!detected) {
      if (!settings.profile.handle) await savePhoenixSettings({ profile: { ...settings.profile, handle } })
      return
    }
    const profile: PhoenixProfile = {
      ...settings.profile,
      ...detected,
      followers: detected.followers || (sameAccount ? settings.profile.followers : 0),
      name: detected.name || (sameAccount ? settings.profile.name : ''),
      verified: Boolean(detected.verified || (sameAccount && settings.profile.verified)),
      handle,
    }
    await savePhoenixSettings({ profile })
    await chrome.storage.local.set({ [PROFILE_DETECTED_AT_KEY]: Date.now() })
    if (this.panelOpen) this.renderProfileSummary(profile, true)
  }

  private async probeProfileInFrame(handle: string): Promise<Partial<PhoenixProfile> | null> {
    if (this.profileProbePromise) return this.profileProbePromise
    this.profileProbePromise = new Promise<Partial<PhoenixProfile> | null>((resolve) => {
      const frame = document.createElement('iframe')
      frame.id = 'newsliquid-profile-probe'
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;'
      frame.src = `https://x.com/${encodeURIComponent(handle)}`
      let settled = false
      let poll: number | undefined
      const finish = (value: Partial<PhoenixProfile> | null) => {
        if (settled) return
        settled = true
        if (poll) window.clearInterval(poll)
        window.clearTimeout(timeout)
        frame.remove()
        resolve(value)
      }
      const inspect = () => {
        try {
          const doc = frame.contentDocument
          const detected = doc ? this.readProfileFromDocument(doc, handle) : null
          if (detected?.followers) finish(detected)
        } catch {
          finish(null)
        }
      }
      frame.addEventListener('load', () => {
        inspect()
        poll = window.setInterval(inspect, 400)
      })
      const timeout = window.setTimeout(() => finish(null), 8_000)
      document.body.appendChild(frame)
    }).finally(() => {
      this.profileProbePromise = null
    })
    return this.profileProbePromise
  }

  private async detectProfile(allowProbe: boolean): Promise<PhoenixProfile> {
    const settings = await loadPhoenixSettings()
    const handle = this.currentHandle() || settings.profile.handle
    const sameAccount = settings.profile.handle.replace(/^@/, '').toLowerCase() === handle.replace(/^@/, '').toLowerCase()
    let profile: PhoenixProfile = {
      ...settings.profile,
      name: sameAccount ? settings.profile.name : '',
      followers: sameAccount ? settings.profile.followers : 0,
      verified: sameAccount ? settings.profile.verified : false,
      handle,
    }
    const direct = this.readProfileFromDocument(document, handle)
    if (direct) {
      profile = {
        ...profile,
        ...direct,
        followers: direct.followers || profile.followers,
        name: direct.name || profile.name,
        verified: direct.verified || profile.verified,
      }
    }

    const stored = await chrome.storage.local.get(PROFILE_DETECTED_AT_KEY)
    const stale = Date.now() - Number(stored[PROFILE_DETECTED_AT_KEY] || 0) > 6 * 60 * 60 * 1000
    if (allowProbe && handle && (!profile.followers || stale) && !direct?.followers) {
      const probed = await this.probeProfileInFrame(handle)
      if (probed) {
        profile = {
          ...profile,
          ...probed,
          followers: probed.followers || profile.followers,
          name: probed.name || profile.name,
          verified: probed.verified || profile.verified,
        }
      }
    }
    await savePhoenixSettings({ profile })
    if (profile.followers) await chrome.storage.local.set({ [PROFILE_DETECTED_AT_KEY]: Date.now() })
    return profile
  }

  private async renderProfile(allowProbe: boolean): Promise<void> {
    if (!this.panelShadow) return
    const title = this.panelShadow.querySelector<HTMLElement>('.profile-copy strong')
    const subtitle = this.panelShadow.querySelector<HTMLElement>('.profile-copy small')
    if (title) title.textContent = '正在识别当前账号'
    if (subtitle) subtitle.textContent = '读取账号数据'
    const profile = await this.detectProfile(allowProbe)
    this.renderProfileSummary(profile, Boolean(profile.followers))
  }

  private renderProfileSummary(profile: PhoenixProfile, detected: boolean): void {
    if (!this.panelShadow) return
    const title = this.panelShadow.querySelector<HTMLElement>('.profile-copy strong')
    const subtitle = this.panelShadow.querySelector<HTMLElement>('.profile-copy small')
    const rawHandle = profile.handle.replace(/^@/, '')
    const handle = rawHandle ? `@${rawHandle}` : '当前 X 账号'
    const sameAsHandle = profile.name.replace(/^@/, '').trim().toLowerCase() === rawHandle.trim().toLowerCase()
    if (title) title.textContent = profile.name && !sameAsHandle ? `${profile.name} · ${handle}` : handle
    if (subtitle) {
      subtitle.textContent = profile.followers
        ? `${this.formatNumber(profile.followers)} 粉丝${profile.verified ? ' · 已认证' : ''}`
        : detected ? '账号资料已同步' : '等待粉丝数据'
    }
  }

  private composeMedia(): { hasPhoto: boolean; hasVideo: boolean } {
    const hasVideo = Boolean(this.composeRoot?.querySelector('video'))
    const hasPhoto = Boolean(this.composeRoot?.querySelector('[data-testid="attachments"] img,[data-testid="tweetPhoto"]')) && !hasVideo
    return { hasPhoto, hasVideo }
  }

  private async score(): Promise<void> {
    if (!this.panelShadow || !this.activeEditor) return
    const text = this.editorText()
    if (!text) return
    const button = this.panelShadow.querySelector<HTMLButtonElement>('.score')
    if (button) {
      button.disabled = true
      button.classList.add('loading')
      button.textContent = '分析中…'
    }
    try {
      if (!this.healthReady) await this.refreshHealth()
      const settings = await loadPhoenixSettings()
      const profile = await this.detectProfile(true)
      this.renderProfileSummary(profile, Boolean(profile.followers))
      const media = this.composeMedia()
      const draft = { ...settings.draft, ...media, text, hasLink: /https?:\/\//i.test(text) }
      await savePhoenixSettings({ profile, draft })
      this.lastResult = await scorePhoenixDraft(profile, draft)
      this.renderResult(this.lastResult)
    } catch (error) {
      this.renderError(error instanceof Error ? error.message : '评分失败，请检查本地服务')
    } finally {
      if (button) {
        button.disabled = !this.editorText()
        button.classList.remove('loading')
        button.textContent = this.lastResult ? '重新分析' : '开始分析'
      }
    }
  }

  private renderResult(result: PhoenixScoreResult | null): void {
    if (!this.panelShadow) return
    const container = this.panelShadow.querySelector<HTMLElement>('.result')
    if (!container) return
    if (!result) {
      container.classList.remove('visible')
      return
    }
    container.classList.add('visible')
    container.classList.remove('error')
    container.querySelector('.insight.review')?.classList.remove('error')
    container.querySelector('.insight.improve')?.classList.remove('error')
    const qualityScore = result.display?.quality.score ?? Math.round(result.weighted_score || result.score || 0)
    const forecast = result.display?.forecast
    const set = (selector: string, value: string) => {
      const element = container.querySelector<HTMLElement>(selector)
      if (element) element.textContent = value
    }
    set('.quality strong', String(qualityScore))
    set('.quality small', result.display?.quality.level || '已分析')
    set('.forecast strong', this.formatNumber(forecast?.views))
    set('.forecast small', forecast ? `${this.formatNumber(forecast.views_low)}–${this.formatNumber(forecast.views_high)} · ${forecast.lane_label || forecast.spread_label}` : result.display?.summary || '分析完成')
    set('.likes', this.formatNumber(forecast?.likes))
    set('.replies', this.formatNumber(forecast?.replies))
    set('.retweets', this.formatNumber(forecast?.retweets))
    set('.quotes', this.formatNumber(forecast?.quotes))
    set('.insight.review strong', '内容判断')
    set('.insight.improve strong', '优化建议')
    set('.insight.review p', result.review || result.display?.summary || '内容判断已完成。')
    set('.insight.improve p', result.improve || result.display?.quality.label || '当前草稿可以进入发布判断。')
    this.animateResultIn()
  }

  private renderError(message: string): void {
    if (!this.panelShadow) return
    const container = this.panelShadow.querySelector<HTMLElement>('.result')
    const review = this.panelShadow.querySelector<HTMLElement>('.insight.review')
    const improve = this.panelShadow.querySelector<HTMLElement>('.insight.improve')
    container?.classList.add('visible', 'error')
    review?.classList.add('error')
    improve?.classList.add('error')
    const title = review?.querySelector<HTMLElement>('strong')
    const copy = review?.querySelector<HTMLElement>('p')
    const suggestion = improve?.querySelector<HTMLElement>('p')
    if (title) title.textContent = '分析未完成'
    if (copy) copy.textContent = message
    if (suggestion) suggestion.textContent = '确认本机服务运行后再试。'
  }

  private formatNumber(value?: number): string {
    return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
  }
}
