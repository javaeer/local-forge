<script setup>
import { ref, computed, onMounted } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import PhaseProgress from '../components/PhaseProgress.vue'
import {
  getBridgeUrl,
  setBridgeUrl,
  parseUrls,
  fetchMediaBlob,
  mergeParts,
  ensureCore,
} from '../lib/mediadl.js'
import { onProgress as mediaOnProgress, setCoreLoadHook as mediaSetCoreLoadHook } from '../lib/media.js'
import { createProgress } from '../lib/progress.js'
import { formatSize, downloadBlob } from '../utils.js'

const input = ref('')
const useBridge = ref(false)
const bridgeUrl = ref('')
const items = ref([]) // { url, name, blob, size, progress, status, error }
const busy = ref(false)
const message = ref(null)

const phase = createProgress([
  { id: 'core', label: '内核', weight: 2 },
  { id: 'fetch', label: '拉取', weight: 6 },
  { id: 'merge', label: '合并', weight: 4 },
])
const showPhase = ref(false)

const urlCount = computed(() => parseUrls(input.value).length)

onMounted(() => {
  bridgeUrl.value = getBridgeUrl()
  mediaOnProgress((p) => { if (busy.value) phase.set('fetch', p) })
  mediaSetCoreLoadHook((s) => {
    if (s === 'start') phase.set('core', 0.15)
    else if (s === 'end') phase.set('core', 1)
    else phase.set('core', 0)
  })
})

function onBridgeInput() {
  setBridgeUrl(useBridge.value ? bridgeUrl.value : '')
}

async function fetchOne(url, viaBridge) {
  const it = { url, name: url, blob: null, size: 0, progress: 0, status: 'working', error: null }
  items.value.push(it)
  try {
    const { blob, size, filename } = await fetchMediaBlob(url, {
      viaBridge,
      onProgress: (p) => { it.progress = p },
    })
    it.blob = blob
    it.size = size
    it.name = filename
    it.status = 'done'
    it.progress = 100
  } catch (e) {
    it.status = 'error'
    it.error = e.message || String(e)
  }
  return it
}

async function fetchAll() {
  const urls = parseUrls(input.value)
  if (!urls.length) {
    message.value = { type: 'err', text: '请先粘贴至少一个媒体直链（每行一个）。' }
    return
  }
  busy.value = true
  phase.reset()
  showPhase.value = true
  message.value = { type: 'info', text: '开始拉取媒体…' }
  let ok = 0
  try {
    for (const u of urls) {
      const it = await fetchOne(u, useBridge.value)
      if (it.status === 'done') ok++
    }
    message.value = ok
      ? { type: 'ok', text: `已获取 ${ok}/${urls.length} 个文件。` }
      : { type: 'err', text: '全部获取失败，请检查链接或桥接地址。' }
  } catch (e) {
    message.value = { type: 'err', text: '获取失败：' + (e.message || e) }
  } finally {
    busy.value = false
    phase.finish()
  }
}

async function merge() {
  const done = items.value.filter((i) => i.status === 'done' && i.blob)
  if (done.length < 2) {
    message.value = { type: 'err', text: '合并至少需要 2 个已获取的文件。' }
    return
  }
  busy.value = true
  phase.reset()
  showPhase.value = true
  message.value = { type: 'info', text: '加载内核并合并中…' }
  try {
    // 内核已就绪时直接置满，避免阶段卡在"内核"
    phase.set('core', 1)
    await ensureCore()
    const blob = await mergeParts(
      done.map((i) => i.blob),
      'merged.mp4',
      'video/mp4',
      { onProgress: (p) => phase.set('merge', p / 100) },
    )
    items.value.push({
      url: 'merged://local',
      name: 'merged.mp4',
      blob,
      size: blob.size,
      progress: 100,
      status: 'done',
      error: null,
    })
    progress.value = 100
    phase.finish()
    message.value = { type: 'ok', text: `合并完成：${formatSize(blob.size)}` }
  } catch (e) {
    message.value = { type: 'err', text: '合并失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}

function download(it) {
  if (it.blob) downloadBlob(it.blob, it.name)
}
</script>

<template>
  <h1 class="page-title">媒体获取</h1>
  <p class="page-sub">纯浏览器内拉取音视频到本地——零上传、不依赖任何第三方解析服务。支持直链模式（粘贴已解析的媒体 URL）与可选桥接模式（你自托管的反代 / CORS 代理，解决跨域）。多分片可本地合并，全部在设备内完成。</p>

  <HelpTip title="操作步骤" icon="bi-steps" open tone="tip">
    <ol class="howto">
      <li>粘贴媒体直链，每行一个（支持 .m3u8 分片清单里的多个 URL，或普通 mp4 / webm / m4a 直链）。</li>
      <li>若链接跨域无法直连，开启「桥接模式」并填入你自托管的代理地址（留空则走直链）。</li>
      <li>点「获取」，逐条拉取并显示进度；需要合并时，勾选多个已获取文件后点「合并为一个文件」。</li>
    </ol>
  </HelpTip>

  <div class="panel">
    <div class="row wrap">
      <StatusPill v-if="busy" state="working" label="处理中…" />
      <StatusPill v-else-if="message && message.type === 'ok'" state="done" :label="message.text" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>

    <div class="field col">
      <label>媒体直链（每行一个）</label>
      <textarea v-model="input" rows="4" placeholder="https://example.com/video/part1.ts&#10;https://example.com/video/part2.ts" :disabled="busy"></textarea>
      <div class="hint">共解析到 {{ urlCount }} 个链接。</div>
    </div>

    <div class="row wrap">
      <label class="check"><input type="checkbox" v-model="useBridge" @change="onBridgeInput" :disabled="busy" /> 桥接模式（自托管反代 / CORS 代理）</label>
    </div>
    <div class="field col" v-if="useBridge">
      <label>桥接地址</label>
      <input v-model="bridgeUrl" @input="onBridgeInput" placeholder="https://your-proxy.example/{url}  或  https://your-proxy.example?url=" :disabled="busy" />
      <div class="hint">支持 <code>{url}</code> 占位符或自动追加 <code>?url=</code>。地址仅保存在本机 localStorage，不会发给任何第三方。</div>
    </div>

    <div class="row wrap">
      <button class="btn" :disabled="busy || !urlCount" @click="fetchAll"><i class="bi bi-cloud-download"></i> 获取</button>
      <button class="btn" :disabled="busy || items.filter(i=>i.status==='done'&&i.blob).length < 2" @click="merge"><i class="bi bi-object-union"></i> 合并为一个文件</button>
    </div>

    <PhaseProgress v-if="busy && showPhase" :progress="phase" />

    <div v-if="message" class="msg" :class="message.type === 'err' ? 'err' : (message.type === 'ok' ? 'ok' : 'info')">
      {{ message.text }}
    </div>
  </div>

  <div v-if="items.length" class="panel">
    <h3 class="st-title">已获取（{{ items.filter(i=>i.status==='done').length }}）</h3>
    <div v-for="(it, idx) in items" :key="idx" class="item-row" :class="it.status === 'error' ? 'fail' : (it.status === 'done' ? 'pass' : '')">
      <span class="badge" :class="it.status === 'error' ? 'bad' : (it.status === 'done' ? 'ok' : 'skip')">
        {{ it.status === 'error' ? '✗ 失败' : (it.status === 'done' ? '✓ 完成' : '… 拉取中') }}
      </span>
      <span class="item-title">{{ it.name }}</span>
      <span v-if="it.size" class="item-detail">{{ formatSize(it.size) }}</span>
      <span v-if="it.status === 'working' && it.progress" class="item-detail">{{ it.progress }}%</span>
      <button v-if="it.status === 'done'" class="btn ghost" @click="download(it)"><i class="bi bi-download"></i> 下载</button>
      <pre v-if="it.error" class="err-stack">{{ it.error }}</pre>
    </div>
  </div>
</template>
