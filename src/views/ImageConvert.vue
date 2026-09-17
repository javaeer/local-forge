<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import { formatSize, downloadBlob, basename } from '../utils.js'

const route = useRoute()
const mode = ref(route.query.mode || 'convert') // convert | compress | view
const OUTS = [
  { id: 'image/png', label: 'PNG', ext: 'png' },
  { id: 'image/jpeg', label: 'JPG', ext: 'jpg' },
  { id: 'image/webp', label: 'WEBP', ext: 'webp' },
]
const file = ref(null)
const outMime = ref('image/png')
const quality = ref(0.8)
const busy = ref(false)
const message = ref(null)
const result = ref(null)
const previewUrl = ref(null)

onMounted(() => {
  if (route.query.mode === 'compress') quality.value = 0.6
})

function onFiles(list) {
  file.value = list[0] || null
  result.value = null
  message.value = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = file.value ? URL.createObjectURL(file.value) : null
}
function loadImage() {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('浏览器无法解码该图片（如 HEIC 需桌面端）'))
    img.src = previewUrl.value
  })
}
async function run() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: '处理中…' }
  try {
    const img = await loadImage()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    const q = outMime.value === 'image/png' ? undefined : quality.value
    const blob = await new Promise((res) => canvas.toBlob(res, outMime.value, q))
    if (!blob) throw new Error('当前浏览器不支持该输出格式（如 AVIF 输出）')
    const ext = OUTS.find((o) => o.id === outMime.value).ext
    result.value = { blob, name: (basename(file.value.name) || 'image') + '.' + ext }
    message.value = { type: 'ok', text: `完成：${formatSize(blob.size)}（原 ${formatSize(file.value.size)}）` }
  } catch (e) {
    message.value = { type: 'err', text: '失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
</script>

<template>
  <h1 class="page-title">图片工具</h1>
  <p class="page-sub">图片格式转换 / 压缩 / 预览，全部浏览器本地完成（基于 Canvas）。支持 PNG·JPG·WEBP·AVIF·GIF·BMP 输入。</p>

  <DropZone :multiple="false" accept="image/*" hint="拖放图片到此处" @files="onFiles" />

  <div v-if="file" class="panel">
    <div v-if="mode === 'view'" class="img-preview"><img :src="previewUrl" :alt="file.name" /></div>
    <template v-else>
      <div class="row wrap">
        <div class="field">
          <label>模式</label>
          <select v-model="mode"><option value="convert">格式转换</option><option value="compress">压缩</option></select>
        </div>
        <div class="field" v-if="mode === 'convert'">
          <label>输出格式</label>
          <select v-model="outMime"><option v-for="o in OUTS" :key="o.id" :value="o.id">{{ o.label }}</option></select>
        </div>
        <div class="field" v-if="mode === 'compress'">
          <label>质量 {{ Math.round(quality * 100) }}%</label>
          <input type="range" min="0.1" max="1" step="0.05" v-model="quality" style="width:160px" />
        </div>
        <button class="btn" :disabled="busy" @click="run"><i class="bi bi-image"></i> 开始</button>
      </div>
      <div v-if="result" class="img-preview"><img :src="URL.createObjectURL(result.blob)" :alt="result.name" /></div>
    </template>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> 下载 {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
  </div>
</template>
