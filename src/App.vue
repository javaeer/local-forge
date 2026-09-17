<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand">
        <i class="bi bi-box-seam"></i>
        <span>LocalForge</span>
      </RouterLink>
      <nav class="nav">
        <RouterLink to="/zip-compress"><i class="bi bi-file-earmark-zip"></i> 压缩</RouterLink>
        <RouterLink to="/zip-extract"><i class="bi bi-door-open"></i> 解压</RouterLink>
        <RouterLink to="/archive"><i class="bi bi-archive"></i> 归档</RouterLink>
        <RouterLink to="/media-convert"><i class="bi bi-arrow-left-right"></i> 媒体</RouterLink>
      </nav>
      <span class="badge"><i class="bi bi-shield-lock"></i> 本地处理</span>
    </header>

    <main class="content">
      <RouterView />
    </main>

    <footer class="footer">
      <nav class="foot-nav">
        <RouterLink to="/about">关于</RouterLink>
        <RouterLink to="/privacy">隐私协议</RouterLink>
        <a href="https://github.com/javaeer/local-forge" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <div>纯前端实现 · 文件不上传服务器 · 基于 zip.js · libarchive.js · ffmpeg.wasm</div>
    </footer>
  </div>
</template>

<style scoped>
.foot-nav {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.foot-nav a {
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}
.foot-nav a:hover {
  text-decoration: underline;
}
</style>
