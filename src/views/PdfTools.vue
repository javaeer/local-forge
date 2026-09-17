<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import { compressPdf, mergePdf, splitPdf } from '../lib/pdf.js'
import { formatSize, downloadBlob } from '../utils.js'

const route = useRoute()
const mode = ref(route.query.mode || 'compress') // compress | preview | merge | split
const file = ref(null) // 单文件（压缩/预览/拆分）
const files = ref([]) // 多文件（合并）
const quality = ref(0.7)
const busy = ref(false)
const progress = ref(0)
const message = ref(null)
const result = ref(null) // 压缩/合并结果
const splitParts = ref([]) // 拆分输出
const pages = ref([]) // 预览：[{ url, w, h, label }]

function onFiles(list) {
  file.value = list[0] || null
  files.value = list
  result.value = null
  splitParts.value = []
  pages.value = []
  message.value = null
  progress.value = 0
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

// PDF 预览：pdf.js 逐页渲染为图像（本地，不出户）
async function preview() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: '解析 PDF 中…' }
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const data = new Uint8Array(await file.value.arrayBuffer())
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
    const out = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 1.2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      out.push({ url: canvas.toDataURL('image/png'), w: Math.round(viewport.width), h: Math.round(viewport.height), label: '第 ' + i + ' 页' })
    }
    pages.value = out
    message.value = { type: 'ok', text: `共 ${doc.numPages} 页` }
  } catch (e) {
    message.value = { type: 'err', text: '预览失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function merge() {
  if (files.value.length < 2) {
    message.value = { type: 'err', text: '请至少选择 2 个 PDF 进行合并。' }
    return
  }
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: '合并中…' }
  try {
    const { blob, name, count, size } = await mergePdf(files.value, { onprogress: (p) => (progress.value = p) })
    result.value = { blob, name }
    message.value = { type: 'ok', text: `已合并 ${count} 个 PDF（${formatSize(size)}）` }
  } catch (e) {
    message.value = { type: 'err', text: '合并失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function split() {
  if (!file.value) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: '拆分中…' }
  try {
    splitParts.value = await splitPdf(file.value, { onprogress: (p) => (progress.value = p) })
    message.value = { type: 'ok', text: `已拆分为 ${splitParts.value.length} 个单页 PDF` }
  } catch (e) {
    message.value = { type: 'err', text: '拆分失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}

function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
function downloadPart(p) {
  downloadBlob(p.blob, p.name)
}
</script>

<template>
  <h1 class="page-title">PDF 工具</h1>
  <p class="page-sub">压缩 / 预览 / 合并 / 拆分 PDF，全部在浏览器本地完成，文件不上传服务器。</p>

  <div class="tabs">
    <button :class="{ active: mode === 'compress' }" @click="mode = 'compress'">压缩</button>
    <button :class="{ active: mode === 'preview' }" @click="mode = 'preview'">预览</button>
    <button :class="{ active: mode === 'merge' }" @click="mode = 'merge'">合并</button>
    <button :class="{ active: mode === 'split' }" @click="mode = 'split'">拆分</button>
  </div>

  <!-- 压缩 -->
  <div v-if="mode === 'compress'" class="panel">
    <DropZone :multiple="false" accept=".pdf" hint="拖放 PDF 文件" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <div class="field">
        <label>图像质量 {{ Math.round(quality * 100) }}%</label>
        <input type="range" min="0.3" max="1" step="0.05" v-model="quality" style="width:160px" />
      </div>
      <button class="btn" :disabled="busy" @click="compress"><i class="bi bi-file-earmark-pdf"></i> 开始压缩</button>
    </div>
    <div v-if="result" class="msg ok">已生成：{{ result.name }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> 下载 {{ result.name }}</button>
  </div>

  <!-- 预览 -->
  <div v-if="mode === 'preview'" class="panel">
    <DropZone :multiple="false" accept=".pdf" hint="拖放 PDF 文件" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <button class="btn" :disabled="busy" @click="preview"><i class="bi bi-eye"></i> 预览</button>
    </div>
    <div v-if="pages.length" class="pdf-pages">
      <figure v-for="p in pages" :key="p.label">
        <img :src="p.url" :alt="p.label" :style="{ width: Math.min(p.w, 520) + 'px' }" />
        <figcaption>{{ p.label }} · {{ p.w }}×{{ p.h }}</figcaption>
      </figure>
    </div>
  </div>

  <!-- 合并 -->
  <div v-if="mode === 'merge'" class="panel">
    <DropZone multiple accept=".pdf" hint="拖放多个 PDF（将按顺序合并为一个）" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <button class="btn" :disabled="busy || files.length < 2" @click="merge"><i class="bi bi-intersect"></i> 合并 {{ files.length }} 个 PDF</button>
    </div>
    <ul v-if="files.length" class="files">
      <li v-for="f in files" :key="f.name + f.size"><i class="bi bi-file-earmark-pdf"></i><span class="name">{{ f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
    <div v-if="result" class="msg ok">已生成：{{ result.name }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> 下载 {{ result.name }}</button>
  </div>

  <!-- 拆分 -->
  <div v-if="mode === 'split'" class="panel">
    <DropZone :multiple="false" accept=".pdf" hint="拖放 PDF 文件" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <button class="btn" :disabled="busy" @click="split"><i class="bi bi-scissors"></i> 拆分为单页</button>
    </div>
    <ul v-if="splitParts.length" class="files">
      <li v-for="p in splitParts" :key="p.name"><i class="bi bi-file-earmark-pdf"></i><span class="name">{{ p.name }}</span><button class="btn ghost" style="padding:4px 9px" @click="downloadPart(p)"><i class="bi bi-download"></i></button></li>
    </ul>
  </div>

  <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.pdf-pages {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 14px;
}
.pdf-pages figure {
  margin: 0;
  border: 1px solid var(--line, #eee);
  border-radius: 8px;
  padding: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.pdf-pages figcaption {
  font-size: 12px;
  color: #888;
  text-align: center;
  margin-top: 6px;
}
</style>
