<script setup>
import { ref } from 'vue'
import { Archive } from 'libarchive.js'
import DropZone from '../components/DropZone.vue'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

let initialized = false
async function ensureInit() {
  if (!initialized) {
    // worker-bundle.js / libarchive.wasm 已置于 public/libarchive/（不会被打包）
    await Archive.init({ workerUrl: '/libarchive/worker-bundle.js' })
    initialized = true
  }
}

const entries = ref([])
const sourceName = ref('')
const busy = ref(false)
const message = ref(null)

async function onFiles(list) {
  const file = list[0]
  if (!file) return
  entries.value = []
  message.value = null
  busy.value = true
  try {
    await ensureInit()
    // 开源 libarchive.js (WASM)：覆盖 ZIP/RAR/7Z/TAR/ISO 等 200+ 格式
    const archive = await Archive.open(file)
    const obj = await archive.getFilesObject() // { path: CompressedFile }
    entries.value = Object.entries(obj)
      .filter(([path]) => !path.endsWith('/'))
      .map(([path, cf]) => ({ name: path, size: cf?.size || 0, _cf: cf }))
    sourceName.value = file.name
    if (!entries.value.length) message.value = { type: 'err', text: T('views.archiveExtract.msgNoFiles') }
  } catch (e) {
    message.value = { type: 'err', text: T('views.archiveExtract.msgFail', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}

async function downloadOne(item) {
  const blob = await item._cf.extract()
  downloadBlob(blob, basename(item.name))
}

async function downloadAll() {
  for (const item of entries.value) {
    try {
      await downloadOne(item)
    } catch (e) {
      message.value = { type: 'err', text: T('views.archiveExtract.msgFail', { msg: e.message || e }) }
    }
  }
}
</script>

<template>
  <h1 class="page-title">{{ T('views.archiveExtract.title') }}</h1>
  <p class="page-sub">
    {{ T('views.archiveExtract.sub') }}
  </p>

  <DropZone :multiple="false" :hint="T('views.archiveExtract.dropHint')" @files="onFiles" />

  <div v-if="sourceName" class="panel">
    <div class="row">
      <span class="status">{{ T('views.archiveExtract.sourceLabel') }}：<b style="color:var(--txt)">{{ sourceName }}</b> · {{ T('views.archiveExtract.fileCount', { n: entries.length }) }}</span>
      <button class="btn green" :disabled="!entries.length" @click="downloadAll">
        <i class="bi bi-download"></i> {{ T('views.archiveExtract.btnDownloadAll') }}
      </button>
    </div>

    <ul class="files">
      <li v-for="item in entries" :key="item.name">
        <i class="bi bi-file-earmark"></i>
        <span class="name">{{ item.name }}</span>
        <span class="size">{{ formatSize(item.size) }}</span>
        <button class="btn ghost" style="padding:4px 9px" @click="downloadOne(item)">
          <i class="bi bi-download"></i>
        </button>
      </li>
    </ul>

    <div v-if="busy" class="status">{{ T('views.archiveExtract.statusWorking') }}</div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  </div>
</template>
