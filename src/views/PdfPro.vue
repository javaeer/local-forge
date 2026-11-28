<script setup>
import { ref, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import {
  imagesToPdf, pdfToImages, watermarkPdf, addPageNumbers, organizePdf, extractPdfText, readPdfMeta, writePdfMeta,
} from '../lib/pdfpro.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const tab = ref(['img2pdf', 'pdf2img', 'stamp', 'organize'].includes(route.query.tab) ? route.query.tab : 'img2pdf')
watch(() => route.query.tab, (v) => { if (['img2pdf', 'pdf2img', 'stamp', 'organize'].includes(v)) tab.value = v })

const busy = ref(false)
const state = ref('idle')
const progress = ref(0)
const message = ref(null)
function setMsg(t, text) { message.value = { type: t, text } }
function run(promise, label) {
  busy.value = true
  state.value = 'working'
  progress.value = 0
  setMsg('info', label)
}

/* 图片 → PDF */
const imgFiles = ref([])
async function runImg2Pdf() {
  if (!imgFiles.value.length) { setMsg('err', T('ui.pdfpro.errSelectImage')); return }
  run(null, T('ui.pdfpro.runComposing', { n: imgFiles.value.length }))
  try {
    const r = await imagesToPdf(imgFiles.value, { pageSize: imgPage.value, onprogress: (p) => (progress.value = p) })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', T('ui.pdfpro.okCreated', { n: r.count, size: formatSize(r.blob.size) }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errGenerate', { msg: e.message }))
  } finally { busy.value = false }
}
const imgPage = ref('fit')

/* PDF → 图片 */
const pdfFile = ref(null)
const imgScale = ref(2)
const imgFmt = ref('image/png')
async function runPdf2Img() {
  if (!pdfFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  run(null, T('ui.pdfpro.runRendering'))
  try {
    const r = await pdfToImages(pdfFile.value, { scale: imgScale.value, format: imgFmt.value, onprogress: (p) => (progress.value = p) })
    const files = r.parts.map((p) => new File([p.blob], p.name, { type: p.blob.type }))
    const zip = await createZip(files, { level: 6 })
    downloadBlob(zip, `${basename(pdfFile.value.name).replace(/\.pdf$/i, '')}-${r.pages}pages.zip`)
    state.value = 'done'
    setMsg('ok', T('ui.pdfpro.okRendered', { n: r.pages, size: formatSize(zip.size) }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errConvert', { msg: e.message }))
  } finally { busy.value = false }
}

/* 水印 / 页码 */
const stampFile = ref(null)
const wm = reactive({ text: '机密', opacity: 0.16, rotate: 30, fontSize: 48, mode: 'center' })
const pn = reactive({ position: 'bottom-center', start: 1, fontSize: 10, prefix: '', suffix: T('ui.pdfpro.pageSuffix') })
async function runWatermark() {
  if (!stampFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  run(null, T('ui.pdfpro.runWatermarking'))
  try {
    const r = await watermarkPdf(stampFile.value, { ...wm })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', T('ui.pdfpro.okWatermarked', { n: r.pages }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errWatermark', { msg: e.message }))
  } finally { busy.value = false }
}
async function runPageNumber() {
  if (!stampFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  run(null, T('ui.pdfpro.runNumbering'))
  try {
    const r = await addPageNumbers(stampFile.value, { ...pn })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', T('ui.pdfpro.okNumbered', { n: r.pages }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errNumbering', { msg: e.message }))
  } finally { busy.value = false }
}

/* 整理 / 文本 / 元数据 */
const orgFile = ref(null)
const org = reactive({ remove: '', rotateAll: 0 })
const orgMeta = ref(null)
const orgText = ref(null)
async function onOrgFile(fs) {
  orgFile.value = (fs && fs[0]) || null
  orgMeta.value = null
  orgText.value = null
  if (!orgFile.value) return
  try {
    orgMeta.value = await readPdfMeta(orgFile.value)
    setMsg('info', T('ui.pdfpro.okMetaRead', { n: orgMeta.value.pages }))
  } catch (e) {
    setMsg('err', T('ui.pdfpro.errRead', { msg: e.message }))
  }
}
async function runOrganize() {
  if (!orgFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  const remove = org.remove.split(/[,，\s]+/).filter(Boolean).map((n) => Number(n) - 1).filter((n) => n >= 0)
  const rotations = {}
  if (org.rotateAll && orgMeta.value) {
    for (let i = 0; i < orgMeta.value.pages; i++) rotations[i] = Number(org.rotateAll)
  }
  run(null, T('ui.pdfpro.runOrganizing'))
  try {
    const r = await organizePdf(orgFile.value, { remove, rotations })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', T('ui.pdfpro.okOrganized', {
      from: r.from,
      to: r.pages,
      rotated: org.rotateAll ? T('ui.pdfpro.organizedRotated', { deg: org.rotateAll }) : '',
    }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errOrganize', { msg: e.message }))
  } finally { busy.value = false }
}
async function runExtract() {
  if (!orgFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  run(null, T('ui.pdfpro.runExtracting'))
  try {
    const r = await extractPdfText(orgFile.value, { onprogress: (p) => (progress.value = p) })
    orgText.value = r.text
    state.value = 'done'
    setMsg('ok', orgText.value.trim() ? T('ui.pdfpro.okExtracted') : T('ui.pdfpro.okExtractedScanned'))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.pdfpro.errExtract', { msg: e.message }))
  } finally { busy.value = false }
}
const metaForm = reactive({ title: '', author: '', subject: '', keywords: '' })
async function runWriteMeta() {
  if (!orgFile.value) { setMsg('err', T('ui.pdfpro.errSelectPdf')); return }
  try {
    const r = await writePdfMeta(orgFile.value, { ...metaForm })
    downloadBlob(r.blob, r.name)
    setMsg('ok', T('ui.pdfpro.okMetaWritten'))
  } catch (e) {
    setMsg('err', T('ui.pdfpro.errWrite', { msg: e.message }))
  }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); setMsg('ok', T('ui.pdfpro.okCopied')) }
  catch { setMsg('err', T('ui.pdfpro.errClipboard')) }
}
function downloadText(t, name) {
  downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), name)
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.pdfpro.pageTitle') }}</h1>
  <p class="page-sub">
    {{ T('ui.pdfpro.sub1') }} <b>pdf-lib</b> {{ T('ui.pdfpro.sub2') }} <b>pdf.js</b> {{ T('ui.pdfpro.sub3') }}<b>{{ T('ui.pdfpro.subNoUpload') }}</b>{{ T('ui.pdfpro.subEnd') }}
  </p>

  <HelpTip :title="T('ui.pdfpro.helpTitle')" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>{{ T('ui.pdfpro.helpImgTitle') }}</b>{{ T('ui.pdfpro.helpImgDesc') }}</li>
      <li><b>{{ T('ui.pdfpro.helpPdfTitle') }}</b>{{ T('ui.pdfpro.helpPdfDesc') }}</li>
      <li><b>{{ T('ui.pdfpro.helpStampTitle') }}</b>{{ T('ui.pdfpro.helpStampDesc') }}</li>
      <li><b>{{ T('ui.pdfpro.helpOrgTitle') }}</b>{{ T('ui.pdfpro.helpOrgDesc') }}</li>
    </ol>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'img2pdf' }" @click="tab = 'img2pdf'"><i class="bi bi-images"></i> {{ T('ui.pdfpro.tabImg2Pdf') }}</button>
    <button :class="{ active: tab === 'pdf2img' }" @click="tab = 'pdf2img'"><i class="bi bi-file-earmark-image"></i> {{ T('ui.pdfpro.tabPdf2Img') }}</button>
    <button :class="{ active: tab === 'stamp' }" @click="tab = 'stamp'"><i class="bi bi-droplet"></i> {{ T('ui.pdfpro.tabStamp') }}</button>
    <button :class="{ active: tab === 'organize' }" @click="tab = 'organize'"><i class="bi bi-sort-numeric-down"></i> {{ T('ui.pdfpro.tabOrg') }}</button>
  </div>

  <!-- 图片 → PDF -->
  <div v-if="tab === 'img2pdf'" class="panel">
    <DropZone multiple accept="image/*" :single="T('ui.pdfpro.dropImageSingle')" :hint="T('ui.pdfpro.dropImageHint')" :formats="T('ui.pdfpro.dropImageFormats')" @files="(fs) => (imgFiles = fs)" />
    <div class="row wrap" style="margin-top:12px">
      <div class="field">
        <label>{{ T('ui.pdfpro.labelPageSize') }}</label>
        <select v-model="imgPage">
          <option value="fit">{{ T('ui.pdfpro.optFit') }}</option>
          <option value="a4">{{ T('ui.pdfpro.optA4') }}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !imgFiles.length" @click="runImg2Pdf"><i class="bi bi-file-earmark-pdf"></i> {{ T('ui.pdfpro.btnMerge') }}</button>
      </div>
      <StatusPill :state="state" :label="state === 'working' ? T('ui.pdfpro.stWorking', { n: progress }) : state === 'done' ? T('ui.pdfpro.stDone') : T('ui.pdfpro.stIdle')" />
    </div>
    <div v-if="imgFiles.length" class="status">{{ T('ui.pdfpro.selectedImages', { n: imgFiles.length }) }}</div>
  </div>

  <!-- PDF → 图片 -->
  <div v-else-if="tab === 'pdf2img'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdfpro.dropPdfHint')" @files="(fs) => (pdfFile = fs && fs[0])" />
    <div class="row wrap" style="margin-top:12px">
      <div class="field">
        <label>{{ T('ui.pdfpro.labelScale', { n: imgScale }) }}</label>
        <input type="range" min="1" max="4" step="0.5" v-model.number="imgScale" style="width:150px" />
      </div>
      <div class="field">
        <label>{{ T('ui.pdfpro.labelOutputFormat') }}</label>
        <select v-model="imgFmt">
          <option value="image/png">{{ T('ui.pdfpro.optPng') }}</option>
          <option value="image/jpeg">{{ T('ui.pdfpro.optJpg') }}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !pdfFile" @click="runPdf2Img"><i class="bi bi-images"></i> {{ T('ui.pdfpro.btnConvertZip') }}</button>
      </div>
      <StatusPill :state="state" :label="state === 'working' ? T('ui.pdfpro.stWorking', { n: progress }) : state === 'done' ? T('ui.pdfpro.stDone') : T('ui.pdfpro.stIdle')" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <p class="hint">{{ T('ui.pdfpro.hintScale') }}</p>
  </div>

  <!-- 水印 / 页码 -->
  <div v-else-if="tab === 'stamp'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdfpro.dropPdfHint')" @files="(fs) => (stampFile = fs && fs[0])" />
    <h3 class="sec-title"><i class="bi bi-droplet"></i> {{ T('ui.pdfpro.secWatermark') }}</h3>
    <div class="row wrap">
      <div class="field"><label>{{ T('ui.pdfpro.labelWatermarkText') }}</label><input v-model="wm.text" :placeholder="T('ui.pdfpro.phWatermarkText')" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelOpacity', { n: wm.opacity }) }}</label><input type="range" min="0.05" max="0.6" step="0.01" v-model.number="wm.opacity" style="width:130px" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelRotate', { n: wm.rotate }) }}</label><input type="range" min="-90" max="90" step="5" v-model.number="wm.rotate" style="width:130px" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelFontSize', { n: wm.fontSize }) }}</label><input type="range" min="16" max="96" step="4" v-model.number="wm.fontSize" style="width:130px" /></div>
      <div class="field">
        <label>{{ T('ui.pdfpro.labelLayout') }}</label>
        <select v-model="wm.mode">
          <option value="center">{{ T('ui.pdfpro.optCenter') }}</option>
          <option value="tile">{{ T('ui.pdfpro.optTile') }}</option>
        </select>
      </div>
    </div>
    <button class="btn" :disabled="busy || !stampFile" @click="runWatermark"><i class="bi bi-droplet"></i> {{ T('ui.pdfpro.btnWatermark') }}</button>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-123"></i> {{ T('ui.pdfpro.secPageNumber') }}</h3>
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.pdfpro.labelPosition') }}</label>
        <select v-model="pn.position">
          <option value="bottom-center">{{ T('ui.pdfpro.optBottomCenter') }}</option>
          <option value="bottom-left">{{ T('ui.pdfpro.optBottomLeft') }}</option>
          <option value="bottom-right">{{ T('ui.pdfpro.optBottomRight') }}</option>
          <option value="top-center">{{ T('ui.pdfpro.optTopCenter') }}</option>
        </select>
      </div>
      <div class="field"><label>{{ T('ui.pdfpro.labelStartPage') }}</label><input type="number" min="1" v-model.number="pn.start" style="width:90px" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelFont') }}</label><input type="number" min="6" max="24" v-model.number="pn.fontSize" style="width:90px" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelSuffix') }}</label><input v-model="pn.suffix" style="width:120px" /></div>
    </div>
    <button class="btn" :disabled="busy || !stampFile" @click="runPageNumber"><i class="bi bi-123"></i> {{ T('ui.pdfpro.btnNumber') }}</button>
    <p class="hint">{{ T('ui.pdfpro.hintStamp1') }}<b>{{ T('ui.pdfpro.hintStampBold') }}</b>{{ T('ui.pdfpro.hintStamp2') }}</p>
  </div>

  <!-- 整理 / 文本 -->
  <div v-else class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" :hint="T('ui.pdfpro.dropPdfHint')" @files="onOrgFile" />
    <div v-if="orgMeta" class="status">
      {{ T('ui.pdfpro.metaTotal') }} <b style="color:var(--txt)">{{ orgMeta.pages }}</b> {{ T('ui.pdfpro.unitPage') }}<template v-if="orgMeta.title">{{ T('ui.pdfpro.metaTitle', { title: orgMeta.title }) }}</template><template v-if="orgMeta.author">{{ T('ui.pdfpro.metaAuthor', { author: orgMeta.author }) }}</template>
    </div>

    <h3 class="sec-title"><i class="bi bi-arrow-repeat"></i> {{ T('ui.pdfpro.secOrganize') }}</h3>
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.pdfpro.labelRotateAll') }}</label>
        <select v-model.number="org.rotateAll">
          <option :value="0">{{ T('ui.pdfpro.optNoRotate') }}</option>
          <option :value="90">{{ T('ui.pdfpro.optCw90') }}</option>
          <option :value="180">180°</option>
          <option :value="270">{{ T('ui.pdfpro.optCcw90') }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('ui.pdfpro.labelRemovePages') }}</label>
        <input v-model="org.remove" :placeholder="T('ui.pdfpro.phRemovePages')" style="width:180px" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !orgFile" @click="runOrganize"><i class="bi bi-sort-numeric-down"></i> {{ T('ui.pdfpro.btnApply') }}</button>
      </div>
    </div>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-fonts"></i> {{ T('ui.pdfpro.secExtract') }}</h3>
    <div class="row wrap">
      <button class="btn" :disabled="busy || !orgFile" @click="runExtract"><i class="bi bi-text-left"></i> {{ T('ui.pdfpro.btnExtractAll') }}</button>
      <button class="btn ghost" :disabled="!orgText" @click="copyText(orgText)"><i class="bi bi-clipboard"></i> {{ T('ui.pdfpro.btnCopy') }}</button>
      <button class="btn ghost" :disabled="!orgText" @click="downloadText(orgText, 'pdf-text.txt')"><i class="bi bi-download"></i> {{ T('ui.pdfpro.btnDownloadTxt') }}</button>
      <StatusPill :state="state" :label="state === 'working' ? T('ui.pdfpro.stExtracting', { n: progress }) : state === 'done' ? T('ui.pdfpro.stExtractDone') : T('ui.pdfpro.stIdle')" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <textarea v-if="orgText" rows="10" readonly :value="orgText"></textarea>
    <p v-if="orgText && !orgText.trim()" class="msg err">
      {{ T('ui.pdfpro.hintNoText1') }}<b>{{ T('ui.pdfpro.hintNoTextBold') }}</b>{{ T('ui.pdfpro.hintNoText2') }}
    </p>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-card-heading"></i> {{ T('ui.pdfpro.secMeta') }}</h3>
    <div class="row wrap">
      <div class="field"><label>{{ T('ui.pdfpro.labelTitle') }}</label><input v-model="metaForm.title" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelAuthor') }}</label><input v-model="metaForm.author" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelSubject') }}</label><input v-model="metaForm.subject" /></div>
      <div class="field"><label>{{ T('ui.pdfpro.labelKeywords') }}</label><input v-model="metaForm.keywords" /></div>
    </div>
    <button class="btn" :disabled="!orgFile" @click="runWriteMeta"><i class="bi bi-save"></i> {{ T('ui.pdfpro.btnWriteMeta') }}</button>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 16px 0 8px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.split { border: none; border-top: 1px solid var(--line, rgba(120,150,200,.16)); margin: 18px 0; }
textarea { width: 100%; box-sizing: border-box; font-family: var(--mono, monospace); font-size: 12.5px; margin-top: 10px; }
</style>
