<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import { extract, createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

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
  message.value = { type: 'info', text: '正在尽力读取/修复归档…' }
  try {
    const list = await extract(file.value)
    entries.value = list
    if (list.length) {
      message.value = { type: 'ok', text: `成功读出 ${list.length} 个条目，可下载恢复。` }
      // 打包为修复后的 zip（getBlob 得到 Blob，需还原成 File 供 createZip 使用）
      const files = []
      for (const e of list) files.push(new File([await e.getBlob()], e.name))
      recovered.value = { blob: await createZip(files, {}), name: 'repaired.zip' }
    } else {
      message.value = { type: 'err', text: '未能读出任何条目，归档可能严重损坏。' }
    }
  } catch (e) {
    message.value = { type: 'err', text: '修复失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}
async function downloadOne(item) {
  downloadBlob(await item.getBlob(), basename(item.name))
}
</script>

<template>
  <h1 class="page-title">修复归档</h1>
  <p class="page-sub">尽力读取损坏的 ZIP / 7Z / RAR / TAR 等归档，提取可恢复的条目并重新打包为 ZIP。纯前端尽力而为。</p>

  <DropZone :multiple="false" hint="拖放损坏的归档文件" @files="onFiles" />

  <div v-if="file" class="panel">
    <button class="btn" :disabled="busy" @click="repair"><i class="bi bi-wrench"></i> 尝试修复</button>
    <ul v-if="entries.length" class="files">
      <li v-for="item in entries" :key="item.name">
        <i class="bi bi-file-earmark"></i><span class="name">{{ item.name }}</span><span class="size">{{ formatSize(item.size) }}</span>
        <button class="btn ghost" style="padding:4px 9px" @click="downloadOne(item)"><i class="bi bi-download"></i></button>
      </li>
    </ul>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="recovered" class="btn green" @click="downloadBlob(recovered.blob, recovered.name)"><i class="bi bi-download"></i> 下载修复包 repaired.zip</button>
  </div>
</template>
