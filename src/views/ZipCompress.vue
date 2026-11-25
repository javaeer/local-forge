<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { saveResume, getResume } from '../lib/resume.js'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import NextSteps from '../components/NextSteps.vue'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob } from '../utils.js'
import { consumePending } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const files = ref([])
const password = ref('')
const level = ref(6)
const splitSize = ref(0) // MB，0 = 不拆分
const folderMode = ref(false)
const progress = ref(0)
const busy = ref(false)
const result = ref(null)
const message = ref(null)

onMounted(() => {
  // 可恢复任务：query 显式指定优先；否则恢复上次设置（仅选项，不含文件）。
  const snap = getResume('/zip-compress')
  if (snap && snap.settings) {
    const s = snap.settings
    if (typeof s.level === 'number') level.value = s.level
    if (typeof s.splitSize === 'number') splitSize.value = s.splitSize
    if (typeof s.folderMode === 'boolean') folderMode.value = s.folderMode
    // 密码属敏感项，不写入可恢复快照（仅恢复非敏感选项）。
  }
  if (route.query.split) splitSize.value = 100
  if (route.query.password) password.value = '' // 聚焦密码
  // 跨工具工作流：接收上一步传来的文件
  const pending = consumePending()
  if (pending && pending.files.length) {
    onFiles(pending.files)
    pushToast('info', T('views.zipCompress.toastLoaded', { from: pending.from, n: pending.files.length }))
  }
})

// 设置快照：仅可序列化选项；不监听 files（绝不存文件字节/文件名以外的东西）。
watch([level, splitSize, folderMode], () => {
  saveResume({
    toolId: '/zip-compress', route: '/zip-compress',
    settings: { level: level.value, splitSize: splitSize.value, folderMode: folderMode.value },
  })
})

function onFiles(list) {
  files.value = list
  result.value = null
  message.value = null
}
async function compress() {
  if (!files.value.length) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('views.zipCompress.msgCompressing') }
  try {
    const blob = await createZip(files.value, {
      password: password.value,
      level: level.value,
      splitSize: splitSize.value ? splitSize.value * 1024 * 1024 : 0,
      onprogress: (p) => (progress.value = p),
    })
    result.value = blob
    const pwPart = password.value ? T('views.zipCompress.encNote') : ''
    const splitPart = splitSize.value ? T('views.zipCompress.splitNote', { n: splitSize.value }) : ''
    message.value = {
      type: 'ok',
      text: T('views.zipCompress.msgDone', { size: formatSize(blob.size), pw: pwPart, split: splitPart }),
    }
  } catch (e) {
    message.value = { type: 'err', text: T('views.zipCompress.msgFail', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value, 'archive.zip')
}
</script>

<template>
  <h1 class="page-title">{{ T('views.zipCompress.title') }}</h1>
  <p class="page-sub">{{ T('views.zipCompress.sub') }}</p>

  <HelpTip :title="T('views.zipCompress.helpTitle')" icon="bi-steps" open>
    <div v-html="T('views.zipCompress.help')"></div>
  </HelpTip>

  <DropZone :multiple="!folderMode" :directory="folderMode" :single="T('views.zipCompress.dropSingle')" :hint="T('views.zipCompress.dropHint')" :formats="T('views.zipCompress.dropFormats')" @files="onFiles" />

  <div v-if="files.length" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('views.zipCompress.statusWorking')" />
      <StatusPill v-else-if="result" state="done" :label="T('views.zipCompress.statusDone')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div class="row wrap">
      <div class="field">
        <label>{{ T('views.zipCompress.levelLabel') }}</label>
        <select v-model="level">
          <option :value="0">{{ T('views.zipCompress.levelStore') }}</option>
          <option :value="1">{{ T('views.zipCompress.levelFast') }}</option>
          <option :value="6">{{ T('views.zipCompress.levelStandard') }}</option>
          <option :value="9">{{ T('views.zipCompress.levelBest') }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('views.zipCompress.pwdLabel') }}</label>
        <input type="password" v-model="password" :placeholder="T('views.zipCompress.pwdPh')" style="width:200px" />
      </div>
      <div class="field">
        <label>{{ T('views.zipCompress.splitLabel') }}</label>
        <input type="number" min="0" v-model="splitSize" style="width:120px" />
      </div>
      <label class="check"><input type="checkbox" v-model="folderMode" /> {{ T('views.zipCompress.folderMode') }}</label>
      <button class="btn" :disabled="busy" @click="compress"><i class="bi bi-file-earmark-zip"></i> {{ T('views.zipCompress.btnCompress') }}</button>
    </div>

    <ul class="files">
      <li v-for="f in files" :key="f.name + f.size">
        <i class="bi bi-file-earmark"></i>
        <span class="name">{{ f.webkitRelativePath || f.name }}</span>
        <span class="size">{{ formatSize(f.size) }}</span>
      </li>
    </ul>

    <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>

    <button v-if="result" class="btn green" @click="download">
      <i class="bi bi-download"></i> {{ T('views.zipCompress.btnDownload') }} ({{ formatSize(result.size) }})
    </button>
    <NextSteps v-if="result" from="/zip-compress" :files="[{ blob: result, name: 'archive.zip' }]" :title="T('views.zipCompress.nextTitle')" />
  </div>
</template>
