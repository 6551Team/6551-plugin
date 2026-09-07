import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'NewsLiquid',
  version: pkg.version,
  description: 'NewsLiquid X 网页插件：自动过滤时间线和评论区垃圾内容，并通过可拖拽浮窗提供发布前评分与建议',
  icons: {
    48: 'public/newsliquid-mark.png',
  },
  action: {
    default_title: 'NewsLiquid',
    default_icon: {
      48: 'public/newsliquid-mark.png',
    },
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [{
    js: ['src/content/main.ts'],
    matches: ['https://twitter.com/*', 'https://x.com/*'],
  }],
  permissions: [
    'storage',
    'alarms',
  ],
  host_permissions: [
    'https://phoenix-score.6551.io/*',
    'https://6551.tos-cn-hongkong.volces.com/*',
    'https://ai.6551.io/*',
    'http://127.0.0.1:8080/*',
    'http://localhost:8080/*',
  ],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  web_accessible_resources: [
    {
      resources: [
        'newsliquid-mark.png',
        'newsliquid-wordmark-dark.png',
        'newsliquid-wordmark-light.png',
        'filter-data/yap.wasm.v2',
        'filter-data/infofi.v2.json',
        'filter-data/handle.v2.json',
      ],
      matches: ['https://twitter.com/*', 'https://x.com/*'],
    },
  ],
})
