import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { bootstrapTheme } from './lib/theme.js'
import { initCorePreference } from './lib/media.js'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles/main.css'

// 在挂载前设置主题，避免浅色主题下的白屏闪烁
bootstrapTheme()

// 内核策略（URL 参数 ?lf-core=cdn|local|st 或 localStorage 持久化）。
// 用免费主机（单文件上限）部署时可设 cdn，让多线程内核走 CDN，不占主机空间。
initCorePreference()

createApp(App).use(router).mount('#app')
