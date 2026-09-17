<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import { compressPdf } from '../lib/pdf.js'
import { formatSize, downloadBlob } from '../utils.js'

const route = useRoute()
const mode = ref(route.query.mode || 'compress') // compress | convert
const file = ref(null)
const quality = ref(0.7)
const busy = ref(false)
const message = ref(null)
const result = ref(null)

function onFiles(list) {
  file.value = list[0] || null
  result.value = null
  message.value = null
}
async function compress() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: '正在重压缩 PDF 内嵌图像…' }
  try {
    const { blob, name, inSize, outSize } = await compressPdf(file.value, { quality: quality.value })
    result.value = { blob, name }
    message.value = {
      type: 'ok',
      text: `完成：${formatSize(outSize)}（原 ${formatSize(inSize)}）${outSize >= inSize ? '（该 PDF 以文本/已压缩为主，降幅有限）' : ''}`,
    }
  } catch (e) {
    message.value = { type: 'err', text: '压缩失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
</script>

<template>
  <h1 class="page-title">PDF 工具</h1>
  <p class="page-sub">压缩 PDF（重压缩内嵌图像、对象流去重）。文档格式互转（PDF↔Office）依赖服务端，网页端仅做压缩与预览。</p>

  <DropZone :multiple="false" accept=".pdf" hint="拖放 PDF 文件" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>模式</label>
        <select v-model="mode"><option value="compress">压缩 PDF</option></select>
      </div>
      <div class="field" v-if="mode === 'compress'">
        <label>图像质量 {{ Math.round(quality * 100) }}%</label>
        <input type="range" min="0.3" max="1" step="0.05" v-model="quality" style="width:160px" />
      </div>
      <button class="btn" :disabled="busy" @click="compress"><i class="bi bi-file-earmark-pdf"></i> 开始压缩</button>
    </div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> 下载 {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
  </div>
</template>
