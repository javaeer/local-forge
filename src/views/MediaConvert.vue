<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { T } from '../lib/i18n.dev.js'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { extract } from '../lib/archive.js'
import { convertMedia, onProgress, setCoreLoadHook } from '../lib/media.js'
import { toUint8, guardSize } from '../lib/fileio.js'
import { createProgress } from '../lib/progress.js'
import PhaseProgress from '../components/PhaseProgress.vue'
import { formatSize, downloadBlob, basename } from '../utils.js'

const route = useRoute()
const mode = ref(route.query.mode || 'convert') // convert | compress | zip

const presets = [
  { id: 'mp4-webm', label: 'MP4 → WebM', out: 'webm', mime: 'video/webm', args: ['-i', 'IN', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', 'OUT'] },
  { id: 'webm-mp4', label: 'WebM → MP4', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-c:a', 'aac', 'OUT'] },
  { id: 'mov-mp4', label: 'MOV → MP4', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-c:a', 'aac', 'OUT'] },
  { id: 'mp4-mp3', labelKey: 'ui.mediaconvert.presetMp4Mp3', out: 'mp3', mime: 'audio/mpeg', args: ['-i', 'IN', '-vn', '-c:a', 'libmp3lame', 'OUT'] },
  { id: 'wav-mp3', label: 'WAV → MP3', out: 'mp3', mime: 'audio/mpeg', args: ['-i', 'IN', '-c:a', 'libmp3lame', 'OUT'] },
  { id: 'mp3-wav', label: 'MP3 → WAV', out: 'wav', mime: 'audio/wav', args: ['-i', 'IN', '-c:a', 'pcm_s16le', 'OUT'] },
  { id: 'compress', labelKey: 'ui.mediaconvert.presetCompress', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', 'OUT'] },
]

const file = ref(null)
const presetId = ref('mp4-webm')
const busy = ref(false)
const progress = ref(0)
const readPct = ref(0)
const message = ref(null)
const result = ref(null)
const sizeWarn = ref(null)

// A-5 阶段进度：加载内核 → 读取文件 → 转码
const phase = createProgress([
  { id: 'core', label: T('ui.mediaconvert.phaseCore'), weight: 2 },
  { id: 'read', label: T('ui.mediaconvert.phaseRead'), weight: 1 },
  { id: 'run', label: T('ui.mediaconvert.phaseRun'), weight: 7 },
])
const showPhase = ref(false)

const preset = computed(() => presets.find((p) => p.id === presetId.value))

onMounted(() => {
  if (mode.value === 'compress') presetId.value = 'compress'
  onProgress((p) => { progress.value = p; phase.set('run', p / 100) })
  // 内核加载阶段无进度事件，用钩子切换阶段（首次约数秒）
  setCoreLoadHook((state) => {
    if (state === 'start') phase.set('core', 0.15)
    else if (state === 'end') phase.set('core', 1)
    else phase.set('core', 0)
  })
})

function onFiles(list) {
  file.value = list[0] || null
  result.value = null
  message.value = null
  progress.value = 0
  readPct.value = 0
  sizeWarn.value = file.value ? guardSize(file.value) : null
}
async function resolveInputData() {
  // 若从 ZIP 内提取媒体
  if (mode.value === 'zip' && file.value?.name?.toLowerCase().endsWith('.zip')) {
    const entries = await extract(file.value)
    const media = entries.find((e) => /\.(mp4|webm|mov|mp3|wav|m4a)$/i.test(e.name))
    if (!media) throw new Error(T('ui.mediaconvert.noMediaInZip'))
    return { data: new Uint8Array(await (await media.getBlob()).arrayBuffer()), name: 'input' }
  }
  // 大文件走分块流式读取（A-4），避免一次性大分配导致 OOM
  const data = await toUint8(file.value, (p) => {
    readPct.value = p.total ? Math.round((p.offset / p.total) * 100) : 0
    phase.set('read', p.total ? p.offset / p.total : 1)
  })
  return { data, name: 'input' }
}
async function convert() {
  if (!file.value) return
  if (sizeWarn.value && sizeWarn.value.level === 'block') {
    message.value = { type: 'err', text: sizeWarn.value.message }
    return
  }
  busy.value = true
  progress.value = 0
  readPct.value = 0
  phase.reset()
  showPhase.value = true
  message.value = { type: 'info', text: T('ui.mediaconvert.loading') }
  try {
    // 内核已加载时直接置满，避免阶段卡在"内核"
    phase.set('core', 1)
    const { data, name } = await resolveInputData()
    const outName = 'output.' + preset.value.out
    const args = preset.value.args.map((a) => (a === 'IN' ? name : a === 'OUT' ? outName : a))
    const blob = await convertMedia(data, name, args, outName, preset.value.mime)
    result.value = { blob, name: outName }
    progress.value = 100
    phase.finish()
    message.value = { type: 'ok', text: T('ui.mediaconvert.doneMsg', { size: formatSize(blob.size) }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.mediaconvert.failed', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.mediaconvert.title') }}</h1>
  <p class="page-sub">{{ T('ui.mediaconvert.sub') }}</p>

  <HelpTip :title="T('ui.common.helpTitle')" icon="bi-steps" open tone="tip">
    <div v-html="T('ui.mediaconvert.help')"></div>
  </HelpTip>

  <DropZone :multiple="false" accept="video/*,audio/*,.zip" :single="T('ui.mediaconvert.dropSingle')" :hint="T('ui.mediaconvert.dropHint')" formats="MP4 / WebM / MOV / MP3 / WAV / ZIP" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="progress ? T('ui.mediaconvert.converting', { p: progress }) : (readPct ? T('ui.mediaconvert.reading', { p: readPct }) : T('ui.mediaconvert.loading'))" />
      <StatusPill v-else-if="result" state="done" :label="T('ui.mediaconvert.doneLabel')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.mediaconvert.modeLabel') }}</label>
        <select v-model="mode">
          <option value="convert">{{ T('ui.mediaconvert.modeConvert') }}</option>
          <option value="compress">{{ T('ui.mediaconvert.modeCompress') }}</option>
          <option value="zip">{{ T('ui.mediaconvert.modeZip') }}</option>
        </select>
      </div>
      <div class="field" v-if="mode !== 'zip'">
        <label>{{ T('ui.mediaconvert.targetLabel') }}</label>
        <select v-model="presetId"><option v-for="p in presets" :key="p.id" :value="p.id">{{ p.labelKey ? T(p.labelKey) : p.label }}</option></select>
      </div>
      <button class="btn" :disabled="busy" @click="convert"><i class="bi bi-arrow-left-right"></i> {{ T('ui.mediaconvert.btnStart') }}</button>
    </div>
    <div class="status">{{ T('ui.mediaconvert.sourceFile') }}<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }}</div>
    <div v-if="sizeWarn && sizeWarn.level !== 'ok'" class="msg" :class="sizeWarn.level === 'block' ? 'err' : 'info'">
      <i class="bi" :class="sizeWarn.level === 'block' ? 'bi-x-octagon' : 'bi-exclamation-triangle'"></i>
      {{ sizeWarn.message }}
    </div>
    <PhaseProgress v-if="busy && showPhase" :progress="phase" />
    <div v-else-if="progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> {{ T('ui.common.download') }} {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
  </div>
</template>
