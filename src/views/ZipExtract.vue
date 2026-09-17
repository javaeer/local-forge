<script setup>
import { ref } from 'vue'
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js'
import DropZone from '../components/DropZone.vue'
import { formatSize, downloadBlob, basename } from '../utils.js'

const archive = ref(null)
const entries = ref([])
const password = ref('')
const busy = ref(false)
const progress = ref(0)
const message = ref(null)

async function onFiles(list) {
  const file = list[0]
  if (!file) return
  entries.value = []
  message.value = null
  archive.value = file
  await readEntries()
}
async function readEntries() {
  if (!archive.value) return
  busy.value = true
  try {
    const reader = new ZipReader(new BlobReader(archive.value), { password: password.value || undefined })
    const list2 = await reader.getEntries()
    entries.value = list2.map((e) => ({
      name: e.filename,
      dir: e.directory,
      size: e.uncompressedSize || 0,
      _entry: e
    }))
    await reader.close()
    if (!entries.value.length) message.value = { type: 'err', text: '该 ZIP 为空或无法读取。' }
  } catch (e) {
    message.value = { type: 'err', text: '读取失败：' + (e.message || e) + '（若为加密 ZIP，请填写密码后点「重新读取」）' }
  } finally {
    busy.value = false
  }
}

async function downloadOne(item) {
  if (item.dir) return
  const blob = await item._entry.getData(new BlobWriter(), {
    password: password.value || undefined,
    onprogress: (c, t) => { if (t) progress.value = Math.round((c / t) * 100) }
  })
  progress.value = 0
  downloadBlob(blob, basename(item.name))
}

async function downloadAll() {
  for (const item of entries.value) {
    if (item.dir) continue
    await downloadOne(item)
  }
}
</script>

<template>
  <h1 class="page-title">解压 ZIP</h1>
  <p class="page-sub">在浏览器内解压 ZIP 文件，文件不会离开你的设备。支持加密 ZIP（填写密码）。</p>

  <DropZone :multiple="false" accept=".zip" hint="拖放 ZIP 文件到此处" @files="onFiles" />

  <div v-if="archive" class="panel">
    <div class="row">
      <div class="field">
        <label>密码（如加密）</label>
        <input type="password" v-model="password" placeholder="留空" style="width:180px" />
      </div>
      <button class="btn ghost" :disabled="busy || !entries.length" @click="downloadAll">
        <i class="bi bi-download"></i> 下载全部
      </button>
      <button class="btn ghost" :disabled="busy || !archive" @click="readEntries">
        <i class="bi bi-arrow-clockwise"></i> 重新读取
      </button>
    </div>

    <ul class="files">
      <li v-for="item in entries" :key="item.name">
        <i class="bi" :class="item.dir ? 'bi-folder2' : 'bi-file-earmark'"></i>
        <span class="name">{{ item.name }}</span>
        <span class="size">{{ item.dir ? '' : formatSize(item.size) }}</span>
        <button v-if="!item.dir" class="btn ghost" style="padding:4px 9px" @click="downloadOne(item)">
          <i class="bi bi-download"></i>
        </button>
      </li>
    </ul>

    <div v-if="busy" class="status">读取中…</div>
    <div v-if="progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  </div>
</template>
