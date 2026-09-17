<script setup>
import { RouterLink } from 'vue-router'
import AdSlot from '../components/AdSlot.vue'
</script>

<template>
  <h1 class="page-title">关于 LocalForge</h1>
  <p class="page-sub">一个 100% 运行在你浏览器里的本地文件工具箱。</p>

  <AdSlot label="About 顶部广告位" />

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-info-circle"></i> 我们做什么</h3>
    <p style="color: var(--muted)">
      LocalForge 把压缩、解压、格式转换、媒体转码、PDF 处理、点对点文件分享等能力，
      全部在浏览器本地完成。你的文件不会离开设备，也不会经过任何服务器。
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-stack"></i> 技术栈</h3>
    <ul style="color: var(--muted); font-size: 14px; line-height: 1.9; margin: 6px 0 0">
      <li><b style="color: var(--txt)">zip.js 2.15</b> — ZIP 压缩 / 解压、AES-256 加密、分卷拆分</li>
      <li><b style="color: var(--txt)">libarchive.js</b> — 200+ 格式解压（7Z / RAR / ISO / APK / DMG…）</li>
      <li><b style="color: var(--txt)">@ffmpeg/ffmpeg</b> — 音视频转码（多线程优先 → 单线程回退 → CDN）</li>
      <li><b style="color: var(--txt)">pdf-lib</b> — PDF 重压缩</li>
      <li><b style="color: var(--txt)">WebRTC</b> — P2P 文件直传</li>
      <li><b style="color: var(--txt)">Vue 3 + Vite</b> — 纯前端单页应用</li>
    </ul>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-heart"></i> 开源与许可</h3>
    <p style="color: var(--muted)">
      本项目以 <b style="color: var(--txt)">MIT 许可证</b> 开源，欢迎在
      <a href="https://github.com/javaeer/local-forge" target="_blank" rel="noopener">GitHub 仓库</a>
      提交 Issue 与 PR。原始能力灵感来自 ezyzip.pro，LocalForge 在其基础上扩展并完全本地化。
    </p>
  </div>

  <div class="row">
    <RouterLink to="/" class="btn"><i class="bi bi-arrow-left"></i> 返回工具箱</RouterLink>
    <RouterLink to="/privacy" class="btn">隐私协议</RouterLink>
  </div>
</template>
