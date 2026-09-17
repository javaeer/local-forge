import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 跨源隔离头：ffmpeg.wasm 多线程内核（SharedArrayBuffer）与 libarchive.js WASM 的前提。
// 用 Vite 内置 headers 配置，dev / preview 均可靠生效。
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  plugins: [vue()],
  worker: { format: 'es' },
  // libarchive.js 自带 .wasm，避免被预打包破坏相对路径
  optimizeDeps: { exclude: ['libarchive.js'] },
  build: { target: 'esnext' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders }
})
