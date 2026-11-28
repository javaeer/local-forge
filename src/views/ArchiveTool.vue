<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { extract, createArchive, convert, merge } from '../lib/archive.js'
import { CREATE_FORMATS, COMPRESSIONS } from '../lib/formats.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const tab = ref(route.query.mode || 'extract')

const files = ref([]) // 创建/转换的源文件
const archives = ref([]) // 合并的多归档
const entries = ref([])
const password = ref('')
const outFmt = ref('zip')
const compression = ref('NONE')
const progress = ref(0)
const busy = ref(false)
const message = ref(null)
const result = ref(null)

onMounted(() => {
  if (route.query.fmt) outFmt.value = route.query.fmt
  if (route.query.to) outFmt.value = route.query.to
})

const fmtLabel = computed(() => CREATE_FORMATS.find((f) => f.ext === outFmt.value)?.label || outFmt.value.toUpperCase())

function onFiles(list) {
  files.value = list
  entries.value = []
  result.value = null
  message.value = null
}
function onArchives(list) {
  archives.value = list
  result.value = null
  message.value = null
}

async function doCreate() {
  if (!files.value.length) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('ui.archive.creating', { fmt: outFmt.value }) }
  try {
    const outName = `archive.${outFmt.value}`
    const blob = await createArchive(files.value, {
      outputFileName: outName,
      compression: compression.value,
      password: password.value || null,
      onprogress: (p) => (progress.value = p),
    })
    result.value = { blob, name: outName }
    message.value = { type: 'ok', text: T('ui.archive.msgCreated', { fmt: outFmt.value.toUpperCase(), size: formatSize(blob.size) }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.archive.errCreate') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function doExtract() {
  if (!files.value.length) return
  busy.value = true
  message.value = null
  try {
    const list = await extract(files.value[0], { password: password.value })
    entries.value = list
    if (!list.length) message.value = { type: 'err', text: T('ui.archive.errEmpty') }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.archive.errExtract') + (e.message || e) + (password.value ? T('ui.archive.pwdMaybeWrong') : '') }
  } finally {
    busy.value = false
  }
}

async function doConvert() {
  if (!files.value.length) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('ui.archive.converting', { fmt: outFmt.value }) }
  try {
    const blob = await convert(files.value[0], outFmt.value, {
      password: password.value,
      compression: compression.value,
      onprogress: (p) => (progress.value = p),
    })
    result.value = { blob, name: `converted.${outFmt.value}` }
    message.value = { type: 'ok', text: T('ui.archive.msgConverted', { size: formatSize(blob.size) }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.archive.errConvert') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function doMerge() {
  if (archives.value.length < 2) {
    message.value = { type: 'err', text: T('ui.archive.errMergeMin') }
    return
  }
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: T('ui.archive.merging') }
  try {
    const blob = await merge(archives.value, { outExt: outFmt.value, compression: compression.value, onprogress: (p) => (progress.value = p) })
    result.value = { blob, name: `merged.${outFmt.value}` }
    message.value = { type: 'ok', text: T('ui.archive.msgMerged', { size: formatSize(blob.size), n: archives.value.length }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.archive.errMerge') + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function downloadOne(item) {
  const blob = await item.getBlob()
  downloadBlob(blob, basename(item.name))
}
async function downloadResult() {
  if (result.value) downloadBlob(result.value.blob, result.value.name)
}
async function downloadAll() {
  for (const item of entries.value) {
    try {
      await downloadOne(item)
    } catch (e) {
      message.value = { type: 'err', text: T('ui.archive.errPartial') + (e.message || e) }
    }
  }
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.archive.pageTitle') }}</h1>
  <p class="page-sub">{{ T('ui.archive.sub') }}</p>

  <HelpTip :title="T('ui.archive.helpTitle')" icon="bi-collection" open>
    <ul>
      <li><b>{{ T('ui.archive.tabCreate') }}</b>：{{ T('ui.archive.helpCreate') }}</li>
      <li><b>{{ T('ui.archive.tabExtract') }}</b>：{{ T('ui.archive.helpExtract') }}</li>
      <li><b>{{ T('ui.archive.tabConvert') }}</b>：{{ T('ui.archive.helpConvert') }}</li>
      <li><b>{{ T('ui.archive.tabMerge') }}</b>：{{ T('ui.archive.helpMerge') }}</li>
    </ul>
    <p style="margin:8px 0 0">{{ T('ui.archive.helpNote') }}</p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'create' }" @click="tab = 'create'">{{ T('ui.archive.tabCreate') }}</button>
    <button :class="{ active: tab === 'extract' }" @click="tab = 'extract'">{{ T('ui.archive.tabExtract') }}</button>
    <button :class="{ active: tab === 'convert' }" @click="tab = 'convert'">{{ T('ui.archive.tabConvert') }}</button>
    <button :class="{ active: tab === 'merge' }" @click="tab = 'merge'">{{ T('ui.archive.tabMerge') }}</button>
  </div>

  <!-- 创建 -->
  <div v-if="tab === 'create'" class="panel">
    <DropZone multiple :single="T('ui.archive.singleFile')" :hint="T('ui.archive.createHint')" :formats="T('ui.archive.anyFileFmt')" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>{{ T('ui.archive.outFmt') }}</label>
        <select v-model="outFmt">
          <option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }} — {{ f.note }}</option>
        </select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>{{ T('ui.archive.compression') }}</label>
        <select v-model="compression">
          <option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('ui.archive.pwdOptional') }}</label>
        <input type="password" v-model="password" :placeholder="T('ui.archive.pwdPh1')" style="width:180px" />
      </div>
      <button class="btn" :disabled="busy" @click="doCreate"><i class="bi bi-plus-lg"></i> {{ T('ui.archive.btnCreate', { fmt: fmtLabel }) }}</button>
    </div>
    <ul v-if="files.length" class="files">
      <li v-for="f in files" :key="f.name + f.size"><i class="bi bi-file-earmark"></i><span class="name">{{ f.webkitRelativePath || f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
  </div>

  <!-- 解压 -->
  <div v-if="tab === 'extract'" class="panel">
    <DropZone :multiple="false" :single="T('ui.archive.singleArchive')" :hint="T('ui.archive.extractHint')" formats="ZIP / RAR / 7Z / TAR / ISO / APK / DMG …" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>{{ T('ui.archive.pwdIfEncrypted') }}</label>
        <input type="password" v-model="password" :placeholder="T('ui.archive.blankPh')" style="width:180px" />
      </div>
      <button class="btn" :disabled="busy" @click="doExtract"><i class="bi bi-door-open"></i> {{ T('ui.archive.btnExtract') }}</button>
      <button class="btn ghost" :disabled="!entries.length" @click="downloadAll"><i class="bi bi-download"></i> {{ T('ui.archive.btnDownloadAll') }}</button>
    </div>
    <ul v-if="entries.length" class="files">
      <li v-for="item in entries" :key="item.name">
        <i class="bi bi-file-earmark"></i><span class="name">{{ item.name }}</span><span class="size">{{ formatSize(item.size) }}</span>
        <button class="btn ghost" style="padding:4px 9px" @click="downloadOne(item)"><i class="bi bi-download"></i></button>
      </li>
    </ul>
  </div>

  <!-- 转换 -->
  <div v-if="tab === 'convert'" class="panel">
    <DropZone :multiple="false" :single="T('ui.archive.singleArchive')" :hint="T('ui.archive.convertHint')" formats="ZIP / RAR / 7Z / TAR …" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>{{ T('ui.archive.targetFmt') }}</label>
        <select v-model="outFmt">
          <option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }}</option>
        </select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>{{ T('ui.archive.compression') }}</label>
        <select v-model="compression"><option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option></select>
      </div>
      <div class="field">
        <label>{{ T('ui.archive.srcPwd') }}</label>
        <input type="password" v-model="password" :placeholder="T('ui.archive.blankPh')" style="width:160px" />
      </div>
      <button class="btn" :disabled="busy" @click="doConvert"><i class="bi bi-arrow-down-up"></i> {{ T('ui.archive.btnConvert', { fmt: fmtLabel }) }}</button>
    </div>
  </div>

  <!-- 合并 -->
  <div v-if="tab === 'merge'" class="panel">
    <DropZone multiple :single="T('ui.archive.singleArchive')" :hint="T('ui.archive.mergeHint')" formats="ZIP / TAR / 7Z …" @files="onArchives" />
    <div v-if="archives.length" class="row wrap">
      <div class="field">
        <label>{{ T('ui.archive.outFmt') }}</label>
        <select v-model="outFmt"><option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }}</option></select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>{{ T('ui.archive.compression') }}</label>
        <select v-model="compression"><option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option></select>
      </div>
      <button class="btn" :disabled="busy || archives.length < 2" @click="doMerge"><i class="bi bi-intersect"></i> {{ T('ui.archive.btnMerge', { fmt: fmtLabel }) }}</button>
    </div>
    <ul v-if="archives.length" class="files">
      <li v-for="f in archives" :key="f.name + f.size"><i class="bi bi-file-earmark"></i><span class="name">{{ f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
  </div>

  <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
  <div class="row wrap" style="margin:10px 0 0">
    <StatusPill v-if="busy" state="working" :label="T('ui.archive.stWorking')" />
    <StatusPill v-else-if="result" state="done" :label="T('ui.archive.resultReady')" />
    <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
  </div>
  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  <button v-if="result" class="btn green" @click="downloadResult"><i class="bi bi-download"></i> {{ T('ui.archive.btnDownload', { name: result.name, size: formatSize(result.blob.size) }) }}</button>
</template>
