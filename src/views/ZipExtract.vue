<script setup>
import { ref } from 'vue'
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js'
import DropZone from '../components/DropZone.vue'
import { isSplitZipSet, extractSplitZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

const archive = ref(null)
const splitSet = ref(null) // 分卷集合（若用户一次拖入多卷）
const entries = ref([])
const password = ref('')
const busy = ref(false)
const progress = ref(0)
const message = ref(null)

async function onFiles(list) {
  entries.value = []
  message.value = null
  // 多卷 ZIP：一次拖入全部分卷，自动识别并合并
  if (list.length > 1 && isSplitZipSet(list)) {
    splitSet.value = list
    archive.value = list[0]
    await readEntries()
    return
  }
  splitSet.value = null
  archive.value = list[0] || null
  if (archive.value) await readEntries()
}

async function readEntries() {
  if (!archive.value) return
  busy.value = true
  try {
    if (splitSet.value) {
      // 分卷：交给引擎按顺序拼接后解压
      const list = await extractSplitZip(splitSet.value, { password: password.value })
      entries.value = list.map((e) => ({ name: e.name, dir: false, size: e.size, _blob: e.getBlob }))
      if (!entries.value.length) message.value = { type: 'err', text: '该分卷 ZIP 为空或无法读取。' }
      else message.value = { type: 'ok', text: `已合并 ${splitSet.value.length} 个分卷并解压。` }
      return
    }
    const reader = new ZipReader(new BlobReader(archive.value), { password: password.value || undefined })
    const list2 = await reader.getEntries()
    entries.value = list2.map((e) => ({
      name: e.filename,
      dir: e.directory,
      size: e.uncompressedSize || 0,
      _entry: e,
      _reader: reader,
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
  let blob
  if (item._blob) {
    blob = await item._blob()
  } else {
    blob = await item._entry.getData(new BlobWriter(), {
      password: password.value || undefined,
      onprogress: (c, t) => { if (t) progress.value = Math.round((c / t) * 100) },
    })
  }
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
  <p class="page-sub">在浏览器内解压 ZIP 文件，文件不会离开你的设备。支持加密 ZIP（填写密码）与<b>分卷 ZIP</b>（一次拖入全部 .z01/.z02/…/.zip 分卷自动合并解压）。</p>

  <DropZone :multiple="true" accept=".zip,.z01,.z02,.z03,.z04,.z05" hint="拖放 ZIP 文件（分卷则一次拖入所有分卷）" @files="onFiles" />

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
