<script setup>
import { ref, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { videoToGif, extractAudio, extractFrames, clipMedia, probeMedia } from '../lib/mediapro.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const tab = ref(['gif', 'audio', 'frames', 'clip'].includes(route.query.tab) ? route.query.tab : 'gif')
watch(() => route.query.tab, (v) => { if (['gif', 'audio', 'frames', 'clip'].includes(v)) tab.value = v })

const file = ref(null)
const info = ref(null)
const busy = ref(false)
const state = ref('idle')
const message = ref(null)
const lastCmd = ref('')
function setMsg(t, text) { message.value = { type: t, text } }

async function onFiles(fs) {
  file.value = (fs && fs[0]) || null
  info.value = null
  if (!file.value) return
  state.value = 'working'
  setMsg('info', T('ui.mediapro.reading'))
  try {
    info.value = await probeMedia(file.value)
    state.value = 'idle'
    const res = info.value.hasVideo ? ` · ${info.value.width}×${info.value.height}` : ''
    setMsg('ok', T('ui.mediapro.msgRead', { dur: fmtDur(info.value.duration), res, size: formatSize(info.value.fileSize) }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.mediapro.errRead') + e.message)
  }
}
function fmtDur(s) {
  if (!isFinite(s)) return T('ui.mediapro.unknownDur')
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}${T('ui.mediapro.durTail', { s: s.toFixed(1) })}`
}

const gif = reactive({ fps: 10, width: 480, start: 0, duration: 0 })
const audio = reactive({ mode: 'copy', bitrate: '192k' })
const frames = reactive({ fps: 1, max: 12, format: 'image/png' })
const clip = reactive({ start: 0, duration: 10, reencode: false })

async function guard() {
  if (!file.value) { setMsg('err', T('ui.mediapro.errNoFile')); return false }
  return true
}
async function doRun(fn) {
  busy.value = true
  state.value = 'working'
  setMsg('info', T('ui.mediapro.processingFirst'))
  try {
    const r = await fn()
    lastCmd.value = r.cmd || ''
    if (r.parts) {
      const files = r.parts.map((p) => new File([p.blob], p.name, { type: p.blob.type }))
      const zip = await createZip(files, { level: 6 })
      downloadBlob(zip, `${basename(file.value.name).replace(/\.[^.]+$/, '')}-frames-${files.length}.zip`)
      setMsg('ok', T('ui.mediapro.msgFrames', { n: files.length, size: formatSize(zip.size) }))
    } else {
      downloadBlob(r.blob, r.name)
      setMsg('ok', T('ui.mediapro.msgDone', { size: formatSize(r.blob.size) }))
    }
    state.value = 'done'
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.mediapro.errProcess') + e.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.mediapro.pageTitle') }}</h1>
  <p class="page-sub" v-html="T('ui.mediapro.sub')"></p>

  <HelpTip :title="T('ui.mediapro.helpTitle')" icon="bi-info-circle" open>
    <ol class="howto">
      <li v-html="T('ui.mediapro.helpGif')"></li>
      <li v-html="T('ui.mediapro.helpAudio')"></li>
      <li v-html="T('ui.mediapro.helpFrames')"></li>
      <li v-html="T('ui.mediapro.helpClip')"></li>
    </ol>
    <p style="margin:8px 0 0">{{ T('ui.mediapro.helpNote') }}</p>
  </HelpTip>

  <DropZone
    :multiple="false" accept="video/*,audio/*" :single="T('ui.mediapro.single')"
    :hint="T('ui.mediapro.dropHint')"
    :formats="T('ui.mediapro.formats')"
    @files="onFiles"
  />

  <div v-if="info" class="info-box">
    <div class="kpi"><span class="num">{{ info.hasVideo ? info.width + '×' + info.height : T('ui.mediapro.audioOnly') }}</span><span class="lbl">{{ T('ui.mediapro.resolution') }}</span></div>
    <div class="kpi"><span class="num">{{ fmtDur(info.duration) }}</span><span class="lbl">{{ T('ui.mediapro.duration') }}</span></div>
    <div class="kpi"><span class="num">{{ formatSize(info.fileSize) }}</span><span class="lbl">{{ T('ui.mediapro.size') }}</span></div>
    <div class="kpi"><span class="num">{{ info.type }}</span><span class="lbl">{{ T('ui.mediapro.type') }}</span></div>
  </div>

  <div class="tabs">
    <button :class="{ active: tab === 'gif' }" @click="tab = 'gif'"><i class="bi bi-film"></i> {{ T('ui.mediapro.tabGif') }}</button>
    <button :class="{ active: tab === 'audio' }" @click="tab = 'audio'"><i class="bi bi-music-note-beamed"></i> {{ T('ui.mediapro.tabAudio') }}</button>
    <button :class="{ active: tab === 'frames' }" @click="tab = 'frames'"><i class="bi bi-images"></i> {{ T('ui.mediapro.tabFrames') }}</button>
    <button :class="{ active: tab === 'clip' }" @click="tab = 'clip'"><i class="bi bi-scissors"></i> {{ T('ui.mediapro.tabClip') }}</button>
  </div>

  <div class="panel">
    <!-- GIF -->
    <div v-if="tab === 'gif'" class="row wrap">
      <div class="field"><label>{{ T('ui.mediapro.fps', { n: gif.fps }) }}</label><input type="range" min="4" max="20" v-model.number="gif.fps" style="width:130px" /></div>
      <div class="field"><label>{{ T('ui.mediapro.width', { n: gif.width }) }}</label><input type="range" min="160" max="800" step="20" v-model.number="gif.width" style="width:130px" /></div>
      <div class="field"><label>{{ T('ui.mediapro.startSec') }}</label><input type="number" min="0" step="0.5" v-model.number="gif.start" style="width:90px" /></div>
      <div class="field"><label>{{ T('ui.mediapro.durationSec') }}</label><input type="number" min="0" step="0.5" v-model.number="gif.duration" style="width:90px" /></div>
    </div>

    <!-- 音频 -->
    <div v-else-if="tab === 'audio'" class="row wrap">
      <div class="field">
        <label>{{ T('ui.mediapro.outputMode') }}</label>
        <select v-model="audio.mode">
          <option value="copy">{{ T('ui.mediapro.modeCopy') }}</option>
          <option value="wav">{{ T('ui.mediapro.modeWav') }}</option>
          <option value="mp3">{{ T('ui.mediapro.modeMp3') }}</option>
        </select>
      </div>
      <div class="field" v-if="audio.mode === 'mp3'">
        <label>{{ T('ui.mediapro.bitrate') }}</label>
        <select v-model="audio.bitrate"><option value="128k">128k</option><option value="192k">192k</option><option value="256k">256k</option><option value="320k">320k</option></select>
      </div>
    </div>

    <!-- 抽帧 -->
    <div v-else-if="tab === 'frames'" class="row wrap">
      <div class="field"><label>{{ T('ui.mediapro.framesPerSec', { n: frames.fps }) }}</label><input type="range" min="0.2" max="5" step="0.2" v-model.number="frames.fps" style="width:140px" /></div>
      <div class="field"><label>{{ T('ui.mediapro.framesMax', { n: frames.max }) }}</label><input type="range" min="1" max="60" v-model.number="frames.max" style="width:140px" /></div>
      <div class="field">
        <label>{{ T('ui.mediapro.format') }}</label>
        <select v-model="frames.format"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option></select>
      </div>
    </div>

    <!-- 裁剪 -->
    <div v-else class="row wrap">
      <div class="field"><label>{{ T('ui.mediapro.startSec') }}</label><input type="number" min="0" step="0.5" v-model.number="clip.start" style="width:100px" /></div>
      <div class="field"><label>{{ T('ui.mediapro.clipDuration') }}</label><input type="number" min="0.5" step="0.5" v-model.number="clip.duration" style="width:100px" /></div>
      <label class="check"><input type="checkbox" v-model="clip.reencode" /> {{ T('ui.mediapro.reencode') }}</label>
    </div>

    <div class="row wrap" style="margin-top:12px">
      <button class="btn green" :disabled="busy || !file" @click="
        tab === 'gif' ? (guard() && doRun(() => videoToGif(file, { ...gif }))) :
        tab === 'audio' ? (guard() && doRun(() => extractAudio(file, { ...audio }))) :
        tab === 'frames' ? (guard() && doRun(() => extractFrames(file, { ...frames }))) :
        (guard() && doRun(() => clipMedia(file, { ...clip })))
      ">
        <i class="bi bi-play-circle"></i> {{ busy ? T('ui.mediapro.btnBusy') : T('ui.mediapro.btnStart') }}
      </button>
      <StatusPill :state="state" :label="state === 'working' ? T('ui.mediapro.stWorking') : state === 'done' ? T('ui.mediapro.stDone') : T('ui.mediapro.stIdle')" />
    </div>

    <p v-if="busy" class="hint"><i class="bi bi-hourglass-split"></i> {{ T('ui.mediapro.busyHint') }}</p>
    <div v-if="busy" class="progress indeterminate"><span></span></div>
    <details v-if="lastCmd" class="cmd"><summary>{{ T('ui.mediapro.cmdSummary') }}</summary><code>{{ lastCmd }}</code></details>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.info-box { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
.kpi {
  flex: 1; min-width: 120px; padding: 10px 12px; border-radius: 12px; text-align: center;
  background: var(--panel-2, rgba(28,37,60,.55)); border: 1px solid var(--line, rgba(120,150,200,.16));
}
.kpi .num { display: block; font-size: 15px; font-weight: 700; color: var(--txt, #e6ebf2); }
.kpi .lbl { display: block; font-size: 11.5px; color: var(--muted, #93a2bd); margin-top: 2px; }
.cmd { margin-top: 12px; }
.cmd summary { cursor: pointer; font-size: 12.5px; color: var(--muted, #93a2bd); }
.cmd code {
  display: block; margin-top: 6px; padding: 8px 10px; border-radius: 8px; font-size: 11.5px;
  background: rgba(120,150,200,.1); color: var(--txt, #e6ebf2); word-break: break-all; white-space: pre-wrap;
}
</style>
