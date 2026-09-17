<script setup>
import { TOOLS } from '../lib/formats.js'
</script>

<template>
  <h1 class="page-title">本地工坊 · Local Forge</h1>
  <p class="page-sub">纯前端文件处理能力。所有压缩 / 解压 / 转换 / 分享都在浏览器本地完成，文件不上传服务器。</p>

  <div v-for="g in TOOLS" :key="g.group" class="cat">
    <h2 class="cat-title"><i class="bi bi-collection"></i> {{ g.group }}</h2>
    <div class="tools">
      <RouterLink v-for="t in g.items" :key="t.to" :to="t.to" class="tool-card">
        <i class="bi" :class="t.icon"></i>
        <h3>{{ t.title }}</h3>
        <p>{{ t.desc }}</p>
      </RouterLink>
    </div>
  </div>

  <div class="panel">
    <h3 style="margin-top:0"><i class="bi bi-info-circle"></i> 技术选型</h3>
    <ul style="color:var(--muted);font-size:13px;line-height:1.9;margin:6px 0 0">
      <li><b style="color:var(--txt)">zip.js 2.15</b> + 多线程 + AES-256</li>
      <li><b style="color:var(--txt)">libarchive.js</b> 开源 WASM 写/读引擎，覆盖 ZIP/7Z/TAR/ISO/RAR/APK/DMG… 200+ 格式</li>
      <li><b style="color:var(--txt)">@ffmpeg/ffmpeg 多线程内核</b>（SharedArrayBuffer）网页端音视频转换</li>
      <li><b style="color:var(--txt)">Canvas + WebCodecs</b> 图片格式转换 / 压缩 / 预览</li>
      <li><b style="color:var(--txt)">WebRTC</b> 点对点文件直传（P2P 分享，手动信令，无需服务器）</li>
      <li><b style="color:var(--txt)">COOP/COEP 跨源隔离头</b>真正启用，发挥多线程与 WASM 性能</li>
    </ul>
  </div>
</template>
