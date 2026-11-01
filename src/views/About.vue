<script setup>
import { RouterLink } from 'vue-router'
import AdSlot from '../components/AdSlot.vue'
import { T } from '../lib/i18n.dev.js'
</script>

<template>
  <h1 class="page-title">{{ T('views.about.title') }}</h1>
  <p class="page-sub">{{ T('views.about.sub') }}</p>

  <AdSlot :label="T('views.about.adTop')" />

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-info-circle"></i> {{ T('views.about.whatTitle') }}</h3>
    <p style="color: var(--muted)">
      {{ T('views.about.whatBody') }}
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-stack"></i> {{ T('views.about.techTitle') }}</h3>
    <ul style="color: var(--muted); font-size: 14px; line-height: 1.9; margin: 6px 0 0">
      <li><b style="color: var(--txt)">zip.js 2.15</b> — {{ T('views.about.techZip') }}</li>
      <li><b style="color: var(--txt)">libarchive.js</b> — {{ T('views.about.techLibarchive') }}</li>
      <li><b style="color: var(--txt)">@ffmpeg/ffmpeg</b> — {{ T('views.about.techFfmpeg') }}</li>
      <li><b style="color: var(--txt)">pdf-lib</b> — {{ T('views.about.techPdflib') }}</li>
      <li><b style="color: var(--txt)">WebRTC</b> — {{ T('views.about.techWebrtc') }}</li>
      <li><b style="color: var(--txt)">Vue 3 + Vite</b> — {{ T('views.about.techVue') }}</li>
    </ul>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-heart"></i> {{ T('views.about.ossTitle') }}</h3>
    <p style="color: var(--muted)">
      {{ T('views.about.ossBody') }}
    </p>
    <p style="margin-top:8px">
      <a href="https://github.com/javaeer/local-forge" target="_blank" rel="noopener">{{ T('views.about.ossLink') }}</a>
    </p>
  </div>

  <div class="row">
    <RouterLink to="/" class="btn"><i class="bi bi-arrow-left"></i> {{ T('views.about.backBtn') }}</RouterLink>
    <RouterLink to="/privacy" class="btn">{{ T('views.about.privacyBtn') }}</RouterLink>
  </div>
</template>
