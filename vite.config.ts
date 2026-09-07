import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config.ts'
import { name, version } from './package.json'

export default defineConfig({
  resolve: {
    alias: {
      '@': `${path.resolve(__dirname, 'src')}`,
    },
  },
  plugins: [
    vue(),
    UnoCSS(),
    crx({ manifest }),
    zip({ outDir: 'dist', outFileName: `${name}-v${version}.zip` }),
  ],
  server: {
    cors: {
      origin: [
        /chrome-extension:\/\//,
      ],
    },
  },
})
