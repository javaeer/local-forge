<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import NextSteps from '../components/NextSteps.vue'
import { compressPdf, mergePdf, splitPdf } from '../lib/pdf.js'
import { formatSize, downloadBlob } from '../utils.js'
import { consumePending } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

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

// 跨工具工作流：接收上一步传来的文件（图片/PDF）
onMounted(() => {
  const pending = consumePending()
  if (pending && pending.files.length) {
    onFiles(pending.files)
    pushToast('info', T('ui.pdftools.msgLoaded', { name: pending.from, n: pending.files.length }))
  }
})

async function compress() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: T('ui.pdftools.compressing') }
  try {
    const { blob, name, inSize, outSize } = await compressPdf(file.value, { quality: quality.value })
    result.value = { blob, name }
    const warn = outSize >= inSize ? T('ui.pdftools.limited') : ''
    message.value = {
      type: 'ok',
      text: T('ui.pdftools.msgCompressed', { out: formatSize(outSize), orig: formatSize(inSize), warn }),
    }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.pdftools.errCompress') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

// PDF 预览：pdf.js 逐页渲染为图像（本地，不出户）
async function preview() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: T('ui.pdftools.parsing') }
  try {
    const pdfjs = await import('pdfjs-dist')
    const { ensurePdfWorker } = await import('../lib/pdfworker.js')
    await ensurePdfWorker()
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
      out.push({ url: canvas.toDataURL('image/png'), w: Math.round(viewport.width), h: Math.round(viewport.height), label: T('ui.pdftools.pageLabel', { n: i }) })
    }
    pages.value = out
    message.value = { type: 'ok', text: T('ui.pdftools.msgPages', { n: doc.numPages }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.pdftools.errPreview') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function merge() {
  if (files.value.length < 2) {
    message.value = { type: 'err', text: T('ui.pdftools.errMergeMin') }
    return
  }
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('ui.pdftools.merging') }
  try {
    const { blob, name, count, size } = await mergePdf(files.value, { onprogress: (p) => (progress.value = p) })
    result.value = { blob, name }
    message.value = { type: 'ok', text: T('ui.pdftools.msgMerged', { n: count, size: formatSize(size) }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.pdftools.errMerge') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function split() {
  if (!file.value) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('ui.pdftools.splitting') }
  try {
    splitParts.value = await splitPdf(file.value, { onprogress: (p) => (progress.value = p) })
    message.value = { type: 'ok', text: T('ui.pdftools.msgSplit', { n: splitParts.value.length }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.pdftools.errSplit') + (e.message || e) }
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
  <h1 class="page-title">{{ T('ui.pdftools.pageTitle') }}</h1>
  <p class="page-sub">{{ T('ui.pdftools.sub') }}</p>

  <HelpTip :title="T('ui.pdftools.helpTitle')" icon="bi-file-earmark-pdf" open>
    <ul>
      <li><b>{{ T('ui.pdftools.tabCompress') }}</b>：{{ T('ui.pdftools.helpCompress') }}</li>
      <li><b>{{ T('ui.pdftools.tabPreview') }}</b>：{{ T('ui.pdftools.helpPreview') }}</li>
      <li><b>{{ T('ui.pdftools.tabMerge') }}</b>：{{ T('ui.pdftools.helpMerge') }}</li>
      <li><b>{{ T('ui.pdftools.tabSplit') }}</b>：{{ T('ui.pdftools.helpSplit') }}</li>
    </ul>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: mode === 'compress' }" @click="mode = 'compress'">{{ T('ui.pdftools.tabCompress') }}</button>
    <button :class="{ active: mode === 'preview' }" @click="mode = 'preview'">{{ T('ui.pdftools.tabPreview') }}</button>
    <button :class="{ active: mode === 'merge' }" @click="mode = 'merge'">{{ T('ui.pdftools.tabMerge') }}</button>
    <button :class="{ active: mode === 'split' }" @click="mode = 'split'">{{ T('ui.pdftools.tabSplit') }}</button>
  </div>

  <!-- 压缩 -->
  <div v-if="mode === 'compress'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdftools.dropHint')" formats=".PDF" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <div class="field">
        <label>{{ T('ui.pdftools.quality', { n: Math.round(quality * 100) }) }}</label>
        <input type="range" min="0.3" max="1" step="0.05" v-model="quality" style="width:160px" />
      </div>
      <button class="btn" :disabled="busy" @click="compress"><i class="bi bi-file-earmark-pdf"></i> {{ T('ui.pdftools.btnCompress') }}</button>
    </div>
    <div v-if="result" class="msg ok">{{ T('ui.pdftools.generated', { name: result.name }) }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> {{ T('ui.pdftools.btnDownload', { name: result.name }) }}</button>
    <NextSteps v-if="result" from="/pdf-tools" :files="[result]" />
  </div>

  <!-- 预览 -->
  <div v-if="mode === 'preview'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdftools.dropHint')" formats=".PDF" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <button class="btn" :disabled="busy" @click="preview"><i class="bi bi-eye"></i> {{ T('ui.pdftools.btnPreview') }}</button>
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
    <DropZone multiple accept=".pdf" single="PDF" :hint="T('ui.pdftools.mergeDropHint')" formats=".PDF" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <button class="btn" :disabled="busy || files.length < 2" @click="merge"><i class="bi bi-intersect"></i> {{ T('ui.pdftools.btnMerge', { n: files.length }) }}</button>
    </div>
    <ul v-if="files.length" class="files">
      <li v-for="f in files" :key="f.name + f.size"><i class="bi bi-file-earmark-pdf"></i><span class="name">{{ f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
    <div v-if="result" class="msg ok">{{ T('ui.pdftools.generated', { name: result.name }) }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> {{ T('ui.pdftools.btnDownload', { name: result.name }) }}</button>
    <NextSteps v-if="result" from="/pdf-tools" :files="[result]" />
  </div>

  <!-- 拆分 -->
  <div v-if="mode === 'split'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdftools.dropHint')" formats=".PDF" @files="onFiles" />
    <div v-if="file" class="row wrap">
      <button class="btn" :disabled="busy" @click="split"><i class="bi bi-scissors"></i> {{ T('ui.pdftools.btnSplit') }}</button>
    </div>
    <ul v-if="splitParts.length" class="files">
      <li v-for="p in splitParts" :key="p.name"><i class="bi bi-file-earmark-pdf"></i><span class="name">{{ p.name }}</span><button class="btn ghost" style="padding:4px 9px" @click="downloadPart(p)"><i class="bi bi-download"></i></button></li>
    </ul>
  </div>

  <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
  <div class="row wrap" style="margin:10px 0 0">
    <StatusPill v-if="busy" state="working" :label="progress ? T('ui.pdftools.stWorking', { n: progress }) : T('ui.pdftools.stBusy')" />
    <StatusPill v-else-if="result" state="done" :label="T('ui.pdftools.resultReady')" />
    <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
  </div>
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
