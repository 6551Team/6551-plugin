import { gsap } from 'gsap'
import weuiCss from 'weui/dist/style/weui.min.css?inline'

export type PageNoticeTone = 'success' | 'warning' | 'error' | 'neutral'

let noticeTimer: number | undefined

function paletteForPage(): Record<string, string> {
  const scheme = window.getComputedStyle(document.documentElement).colorScheme
  const isDark = scheme.includes('dark') && !scheme.startsWith('light')
  return isDark
    ? {
        surface: '#17171d',
        border: 'rgba(241,238,248,.14)',
        text: '#f4f2f8',
        muted: '#948e9e',
        success: '#65d6ad',
        warning: '#f1bd6d',
        error: '#ff9b9e',
      }
    : {
        surface: '#fdfcfe',
        border: 'rgba(31,27,43,.14)',
        text: '#1d1925',
        muted: '#7b7485',
        success: '#177a5a',
        warning: '#946200',
        error: '#b3424b',
      }
}

export function showPageNotice(message: string, tone: PageNoticeTone = 'neutral'): void {
  let host = document.getElementById('nl-page-notice-host') as HTMLElement | null
  if (!host) {
    host = document.createElement('div')
    host.id = 'nl-page-notice-host'
    host.style.cssText = 'position:fixed;right:22px;bottom:24px;z-index:2147483647;pointer-events:none;'
    host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)
  }

  const root = host.shadowRoot
  if (!root) return
  const palette = paletteForPage()
  const toneColor = tone === 'success'
    ? palette.success
    : tone === 'warning'
      ? palette.warning
      : tone === 'error'
        ? palette.error
        : palette.muted

  root.innerHTML = `
    <style>
      ${weuiCss}
      :host { all: initial; }
      .notice {
        position:static;
        display:flex;
        width:min(340px,calc(100vw - 32px));
        align-items:center;
        gap:10px;
        border:1px solid ${palette.border};
        border-radius:13px;
        padding:11px 13px;
        color:${palette.text};
        background:${palette.surface};
        box-shadow:0 18px 55px rgba(0,0,0,.22);
        font:650 12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
      }
      .marker { width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:${toneColor};box-shadow:0 0 0 4px color-mix(in srgb,${toneColor} 15%,transparent); }
      @media (forced-colors:active) { .notice { border:1px solid CanvasText;box-shadow:none; } .marker { background:Highlight; } }
    </style>
    <div class="weui-toptips notice" role="status"><span class="marker"></span><span class="copy"></span></div>
  `
  const copy = root.querySelector('.copy')
  if (copy) copy.textContent = message
  const notice = root.querySelector<HTMLElement>('.notice')
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (notice && !reduceMotion) {
    gsap.fromTo(notice, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' })
  }

  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    if (notice && !reduceMotion) {
      gsap.to(notice, {
        autoAlpha: 0,
        y: 5,
        duration: 0.16,
        ease: 'power1.in',
        onComplete: () => host?.remove(),
      })
    } else host?.remove()
    noticeTimer = undefined
  }, 2600)
}
