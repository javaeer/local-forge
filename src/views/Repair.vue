<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { extract, createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const file = ref(null)
const entries = ref([])
const busy = ref(false)
const message = ref(null)
const recovered = ref(null)

function onFiles(list) {
  file.value = list[0] || null
  entries.value = []
  recovered.value = null
  message.value = null
}
async function repair() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: T('views.repair.msgWorking') }
  try {
    const list = await extract(file.value)
    entries.value = list
    if (list.length) {
      message.value = { type: 'ok', text: T('views.repair.msgOk', { n: list.length }) }
      // 打包为修复后的 zip（getBlob 得到 Blob，需还原成 File 供 createZip 使用）
      const files = []
      for (const e of list) files.push(new File([await e.getBlob()], e.name))
      recovered.value = { blob: await createZip(files, {}), name: 'repaired.zip' }
    } else {
      message.value = { type: 'err', text: T('views.repair.msgEmpty') }
    }
  } catch (e) {
    message.value = { type: 'err', text: T('views.repair.msgFail', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}
async function downloadOne(item) {
  downloadBlob(await item.getBlob(), basename(item.name))
}
</script>

<template>
  <h1 class="page-title">{{ T('views.repair.title') }}</h1>
  <p class="page-sub">{{ T('views.repair.sub') }}</p>

  <HelpTip :title="T('views.repair.helpTitle')" icon="bi-wrench" open tone="warn">
    <div v-html="T('views.repair.help')"></div>
  </HelpTip>

  <DropZone :multiple="false" :single="T('views.repair.dropSingle')" :hint="T('views.repair.dropHint')" :formats="T('views.repair.dropFormats')" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('views.repair.statusWorking')" />
      <StatusPill v-else-if="recovered" state="done" :label="T('views.repair.statusDone')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <button class="btn" :disabled="busy" @click="repair"><i class="bi bi-wrench"></i> {{ T('views.repair.btnRepair') }}</button>
    <ul v-if="entries.length" class="files">
      <li v-for="item in entries" :key="item.name">
        <i class="bi bi-file-earmark"></i><span class="name">{{ item.name }}</span><span class="size">{{ formatSize(item.size) }}</span>
        <button class="btn ghost" style="padding:4px 9px" @click="downloadOne(item)"><i class="bi bi-download"></i></button>
      </li>
    </ul>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="recovered" class="btn green" @click="downloadBlob(recovered.blob, recovered.name)"><i class="bi bi-download"></i> {{ T('views.repair.btnDownloadRepaired') }}</button>
  </div>
</template>
