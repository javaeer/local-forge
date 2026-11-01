<script setup>
import { ref, computed } from 'vue'
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import NextSteps from '../components/NextSteps.vue'
import { isSplitZipSet, extractSplitZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const archive = ref(null)
const splitSet = ref(null) // 分卷集合（若用户一次拖入多卷）
const entries = ref([])
const password = ref('')
const busy = ref(false)
const progress = ref(0)
const message = ref(null)

// "下一步"要传递的文件：取所有非目录条目（惰性取出）——仅在用户点击下一步时惰性生成
const nonDirEntries = computed(() => entries.value.filter((e) => !e.dir))

async function collectEntries() {
  const out = []
  for (const item of nonDirEntries.value) {
    let blob
    if (item._blob) blob = await item._blob()
    else blob = await item._entry.getData(new BlobWriter(), { password: password.value || undefined })
    out.push({ blob, name: basename(item.name) })
  }
  return out
}

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
      if (!entries.value.length) message.value = { type: 'err', text: T('views.zipExtract.msgEmpty') }
      else message.value = { type: 'ok', text: T('views.zipExtract.msgSplitDone', { n: splitSet.value.length }) }
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
    if (!entries.value.length) message.value = { type: 'err', text: T('views.zipExtract.msgEmpty') }
  } catch (e) {
    message.value = { type: 'err', text: T('views.zipExtract.msgReadFail', { msg: e.message || e }) }
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
  <h1 class="page-title">{{ T('views.zipExtract.title') }}</h1>
  <p class="page-sub">{{ T('views.zipExtract.sub') }}</p>

  <HelpTip :title="T('views.zipExtract.helpTitle')" icon="bi-steps" open>
    <div v-html="T('views.zipExtract.help')"></div>
  </HelpTip>

  <DropZone :multiple="true" accept=".zip,.z01,.z02,.z03,.z04,.z05" :single="T('views.zipExtract.dropSingle')" :hint="T('views.zipExtract.dropHint')" :formats="T('views.zipExtract.dropFormats')" @files="onFiles" />

  <div v-if="archive" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('views.zipExtract.statusWorking')" />
      <StatusPill v-else-if="message && message.type === 'ok'" state="done" :label="T('views.zipExtract.statusDone')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div class="row">
      <div class="field">
        <label>{{ T('views.zipExtract.pwdLabel') }}</label>
        <input type="password" v-model="password" :placeholder="T('views.zipExtract.pwdPh')" style="width:180px" />
      </div>
      <button class="btn ghost" :disabled="busy || !entries.length" @click="downloadAll">
        <i class="bi bi-download"></i> {{ T('views.zipExtract.btnDownloadAll') }}
      </button>
      <button class="btn ghost" :disabled="busy || !archive" @click="readEntries">
        <i class="bi bi-arrow-clockwise"></i> {{ T('views.zipExtract.btnReread') }}
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

    <div v-if="busy" class="status">{{ T('views.zipExtract.statusWorking') }}</div>
    <div v-if="progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>

    <NextSteps v-if="nonDirEntries.length" from="/zip-extract" :get-files="collectEntries"
      :title="T('views.zipExtract.nextTitle', { n: nonDirEntries.length })" />
  </div>
</template>
