<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand">
        <i class="bi bi-box-seam"></i>
        <span>Local Forge <b>Lite</b></span>
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
      纯前端实现 · 文件不上传服务器 · 基于 zip.js · libarchive.js · ffmpeg.wasm
    </footer>
  </div>
</template>
