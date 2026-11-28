<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { T } from '../lib/i18n.dev.js'
import { saveResume, getResume } from '../lib/resume.js'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import NextSteps from '../components/NextSteps.vue'
import { compressImage } from '../lib/image.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { consumePending } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'

const route = useRoute()
const mode = ref(route.query.mode || 'convert') // convert | compress | view
const OUTS = [
  { id: 'image/png', label: 'PNG', ext: 'png' },
  { id: 'image/jpeg', label: 'JPG', ext: 'jpg' },
  { id: 'image/webp', label: 'WEBP', ext: 'webp' },
  { id: 'image/avif', label: 'AVIF', ext: 'avif' },
]
const file = ref(null)
const outMime = ref('image/png')
const quality = ref(0.8)
const losslessPng = ref(false)
const busy = ref(false)
const message = ref(null)
const result = ref(null)
const resultUrl = ref(null)
const previewUrl = ref(null)
const savingPct = computed(() => {
  if (!result.value || !file.value) return null
  const r = 1 - result.value.blob.size / file.value.size
  return Math.round(r * 100)
})

onMounted(() => {
  // 可恢复任务：恢复上次的非敏感选项（输出格式/质量/无损 PNG）。
  const snap = getResume('/image-convert')
  if (snap && snap.settings) {
    const s = snap.settings
    if (typeof s.quality === 'number') quality.value = s.quality
    if (typeof s.losslessPng === 'boolean') losslessPng.value = s.losslessPng
    if (typeof s.outMime === 'string' && !route.query.mode) outMime.value = s.outMime
  }
  if (route.query.mode === 'compress') {
    quality.value = 0.6
    outMime.value = 'image/png'
  }
  // 跨工具工作流：若从上一步传来文件，自动载入
  const pending = consumePending()
  if (pending && pending.files.length) {
    onFiles([pending.files[0]])
    pushToast('info', T('ui.imageconvert.loadedFrom', { from: pending.from }))
  }
})

watch([outMime, quality, losslessPng], () => {
  saveResume({
    toolId: '/image-convert', route: '/image-convert',
    settings: { outMime: outMime.value, quality: quality.value, losslessPng: losslessPng.value },
  })
})

function onFiles(list) {
  file.value = list[0] || null
  result.value = null
  message.value = null
  if (resultUrl.value) { URL.revokeObjectURL(resultUrl.value); resultUrl.value = null }
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = file.value ? URL.createObjectURL(file.value) : null
}
async function run() {
  if (!file.value) return
  busy.value = true
  message.value = { type: 'info', text: T('ui.imageconvert.processing') }
  try {
    const blob = await compressImage(file.value, {
      outMime: outMime.value,
      quality: quality.value,
      losslessPng: losslessPng.value,
    })
    const ext = OUTS.find((o) => o.id === outMime.value).ext
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(blob)
    result.value = { blob, name: (basename(file.value.name) || 'image') + '.' + ext }
    const pct = Math.round((1 - blob.size / file.value.size) * 100)
    message.value = {
      type: 'ok',
      text: T('ui.imageconvert.doneMsg', { size: formatSize(blob.size), orig: formatSize(file.value.size), pct }),
    }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.imageconvert.failed', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.imageconvert.title') }}</h1>
  <p class="page-sub">{{ T('ui.imageconvert.sub') }}</p>

  <HelpTip :title="T('ui.common.helpTitle')" icon="bi-steps" open>
    <div v-html="T('ui.imageconvert.help')"></div>
  </HelpTip>

  <DropZone :multiple="false" accept="image/*" :single="T('ui.imageconvert.dropSingle')" :hint="T('ui.imageconvert.dropHint')" formats="PNG / JPG / WEBP / AVIF" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('ui.imageconvert.processing')" />
      <StatusPill v-else-if="result" state="done" :label="savingPct != null ? T('ui.imageconvert.savedPill', { pct: savingPct }) : T('ui.imageconvert.donePill')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div v-if="mode === 'view'" class="img-preview"><img :src="previewUrl" :alt="file.name" /></div>
    <template v-else>
      <div class="row wrap">
        <div class="field">
          <label>{{ T('ui.imageconvert.modeLabel') }}</label>
          <select v-model="mode"><option value="convert">{{ T('ui.imageconvert.modeConvert') }}</option><option value="compress">{{ T('ui.imageconvert.modeCompress') }}</option></select>
        </div>
        <div class="field" v-if="mode === 'convert' || mode === 'compress'">
          <label>{{ T('ui.imageconvert.outFormat') }}</label>
          <select v-model="outMime"><option v-for="o in OUTS" :key="o.id" :value="o.id">{{ o.label }}</option></select>
        </div>
        <div class="field" v-if="mode === 'compress'">
          <label>{{ T('ui.imageconvert.quality', { p: Math.round(quality * 100) }) }}</label>
          <input type="range" min="0.1" max="1" step="0.05" v-model="quality" style="width:160px" />
        </div>
        <div class="field" v-if="outMime === 'image/png' && mode !== 'view'">
          <label class="chk"><input type="checkbox" v-model="losslessPng" /> {{ T('ui.imageconvert.lossless') }}</label>
        </div>
        <button class="btn" :disabled="busy" @click="run"><i class="bi bi-image"></i> {{ T('ui.imageconvert.start') }}</button>
      </div>
      <p v-if="outMime === 'image/png' && !losslessPng && mode !== 'view'" class="hint">
        {{ T('ui.imageconvert.losslessHint') }}
      </p>
      <div v-if="result" class="img-preview"><img :src="resultUrl" :alt="result.name" /></div>
    </template>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> {{ T('ui.common.download') }} {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
    <NextSteps v-if="result" from="/image-convert" :files="[result]" />
  </div>
</template>
