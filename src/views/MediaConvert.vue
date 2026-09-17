<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import { extract } from '../lib/archive.js'
import { convertMedia, onProgress } from '../lib/media.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

const route = useRoute()
const mode = ref(route.query.mode || 'convert') // convert | compress | zip

const presets = [
  { id: 'mp4-webm', label: 'MP4 → WebM', out: 'webm', mime: 'video/webm', args: ['-i', 'IN', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', 'OUT'] },
  { id: 'webm-mp4', label: 'WebM → MP4', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-c:a', 'aac', 'OUT'] },
  { id: 'mov-mp4', label: 'MOV → MP4', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-c:a', 'aac', 'OUT'] },
  { id: 'mp4-mp3', label: 'MP4 → MP3（提取音频）', out: 'mp3', mime: 'audio/mpeg', args: ['-i', 'IN', '-vn', '-c:a', 'libmp3lame', 'OUT'] },
  { id: 'wav-mp3', label: 'WAV → MP3', out: 'mp3', mime: 'audio/mpeg', args: ['-i', 'IN', '-c:a', 'libmp3lame', 'OUT'] },
  { id: 'mp3-wav', label: 'MP3 → WAV', out: 'wav', mime: 'audio/wav', args: ['-i', 'IN', '-c:a', 'pcm_s16le', 'OUT'] },
  { id: 'compress', label: '压缩（降码率）', out: 'mp4', mime: 'video/mp4', args: ['-i', 'IN', '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', 'OUT'] },
]

const file = ref(null)
const presetId = ref('mp4-webm')
const busy = ref(false)
const progress = ref(0)
const message = ref(null)
const result = ref(null)

const preset = computed(() => presets.find((p) => p.id === presetId.value))

onMounted(() => {
  if (mode.value === 'compress') presetId.value = 'compress'
  onProgress((p) => { progress.value = p })
})

function onFiles(list) {
  file.value = list[0] || null
  result.value = null
  message.value = null
  progress.value = 0
}
async function resolveInputData() {
  // 若从 ZIP 内提取媒体
  if (mode.value === 'zip' && file.value?.name?.toLowerCase().endsWith('.zip')) {
    const entries = await extract(file.value)
    const media = entries.find((e) => /\.(mp4|webm|mov|mp3|wav|m4a)$/i.test(e.name))
    if (!media) throw new Error('压缩包内未找到常见音视频文件。')
    return { data: new Uint8Array(await (await media.getBlob()).arrayBuffer()), name: 'input' }
  }
  const { fetchFile } = await import('@ffmpeg/util')
  return { data: await fetchFile(file.value), name: 'input' }
}
async function convert() {
  if (!file.value) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: '加载内核并转换中…' }
  try {
    const { data, name } = await resolveInputData()
    const outName = 'output.' + preset.value.out
    const args = preset.value.args.map((a) => (a === 'IN' ? name : a === 'OUT' ? outName : a))
    const blob = await convertMedia(data, name, args, outName, preset.value.mime)
    result.value = { blob, name: outName }
    progress.value = 100
    message.value = { type: 'ok', text: `转换完成：${formatSize(blob.size)}` }
  } catch (e) {
    message.value = { type: 'err', text: '转换失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
</script>

<template>
  <h1 class="page-title">媒体转换</h1>
  <p class="page-sub">基于 @ffmpeg/ffmpeg 在浏览器内转码音视频——弥补原版网页端媒体能力短板。多线程内核（SharedArrayBuffer）优先，自动回退单线程以保证兼容性；内核默认本地打包，离线可用。</p>

  <DropZone :multiple="false" accept="video/*,audio/*,.zip" hint="拖放音视频文件（或含媒体的 ZIP）" @files="onFiles" />

  <div v-if="file" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>模式</label>
        <select v-model="mode">
          <option value="convert">格式转换</option>
          <option value="compress">压缩（降码率）</option>
          <option value="zip">从 ZIP 提取</option>
        </select>
      </div>
      <div class="field" v-if="mode !== 'zip'">
        <label>目标格式 / 预设</label>
        <select v-model="presetId"><option v-for="p in presets" :key="p.id" :value="p.id">{{ p.label }}</option></select>
      </div>
      <button class="btn" :disabled="busy" @click="convert"><i class="bi bi-arrow-left-right"></i> 开始转换</button>
    </div>
    <div class="status">源文件：<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }}</div>
    <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <button v-if="result" class="btn green" @click="download"><i class="bi bi-download"></i> 下载 {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
  </div>
</template>
