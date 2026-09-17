<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import { extract, createArchive, convert, merge } from '../lib/archive.js'
import { CREATE_FORMATS, COMPRESSIONS } from '../lib/formats.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

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
  message.value = { type: 'info', text: `正在创建 .${outFmt.value} …` }
  try {
    const outName = `archive.${outFmt.value}`
    const blob = await createArchive(files.value, {
      outputFileName: outName,
      compression: compression.value,
      password: password.value || null,
      onprogress: (p) => (progress.value = p),
    })
    result.value = { blob, name: outName }
    message.value = { type: 'ok', text: `已创建 ${outFmt.value.toUpperCase()}（${formatSize(blob.size)}）` }
  } catch (e) {
    message.value = { type: 'err', text: '创建失败：' + (e.message || e) }
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
    if (!list.length) message.value = { type: 'err', text: '该归档为空或无法读取。' }
  } catch (e) {
    message.value = { type: 'err', text: '解压失败：' + (e.message || e) + (password.value ? '（密码可能错误）' : '') }
  } finally {
    busy.value = false
  }
}

async function doConvert() {
  if (!files.value.length) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: `正在转换为 .${outFmt.value} …` }
  try {
    const blob = await convert(files.value[0], outFmt.value, {
      password: password.value,
      compression: compression.value,
      onprogress: (p) => (progress.value = p),
    })
    result.value = { blob, name: `converted.${outFmt.value}` }
    message.value = { type: 'ok', text: `转换完成（${formatSize(blob.size)}）` }
  } catch (e) {
    message.value = { type: 'err', text: '转换失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}

async function doMerge() {
  if (archives.value.length < 2) {
    message.value = { type: 'err', text: '请至少选择 2 个归档进行合并。' }
    return
  }
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: '正在合并归档…' }
  try {
    const blob = await merge(archives.value, { outExt: outFmt.value, compression: compression.value, onprogress: (p) => (progress.value = p) })
    result.value = { blob, name: `merged.${outFmt.value}` }
    message.value = { type: 'ok', text: `合并完成（${formatSize(blob.size)}，含 ${archives.value.length} 个源）` }
  } catch (e) {
    message.value = { type: 'err', text: '合并失败：' + (e.message || e) }
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
      message.value = { type: 'err', text: '部分文件失败：' + (e.message || e) }
    }
  }
}
</script>

<template>
  <h1 class="page-title">归档工具箱</h1>
  <p class="page-sub">创建 / 解压 / 转换 / 合并任意归档格式（ZIP·7Z·TAR·ISO·RAR·APK·DMG…），全部浏览器本地完成。</p>

  <div class="tabs">
    <button :class="{ active: tab === 'create' }" @click="tab = 'create'">创建归档</button>
    <button :class="{ active: tab === 'extract' }" @click="tab = 'extract'">解压 / 提取</button>
    <button :class="{ active: tab === 'convert' }" @click="tab = 'convert'">格式转换</button>
    <button :class="{ active: tab === 'merge' }" @click="tab = 'merge'">合并归档</button>
  </div>

  <!-- 创建 -->
  <div v-if="tab === 'create'" class="panel">
    <DropZone multiple hint="拖放要打包的文件/文件夹" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>输出格式</label>
        <select v-model="outFmt">
          <option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }} — {{ f.note }}</option>
        </select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>压缩方式</label>
        <select v-model="compression">
          <option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>
      <div class="field">
        <label>加密密码（可选）</label>
        <input type="password" v-model="password" placeholder="留空不加密" style="width:180px" />
      </div>
      <button class="btn" :disabled="busy" @click="doCreate"><i class="bi bi-plus-lg"></i> 创建 {{ fmtLabel }}</button>
    </div>
    <ul v-if="files.length" class="files">
      <li v-for="f in files" :key="f.name + f.size"><i class="bi bi-file-earmark"></i><span class="name">{{ f.webkitRelativePath || f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
  </div>

  <!-- 解压 -->
  <div v-if="tab === 'extract'" class="panel">
    <DropZone :multiple="false" hint="拖放归档文件（ZIP/RAR/7Z/TAR/ISO/APK/DMG…）" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>密码（如加密）</label>
        <input type="password" v-model="password" placeholder="留空" style="width:180px" />
      </div>
      <button class="btn" :disabled="busy" @click="doExtract"><i class="bi bi-door-open"></i> 解压</button>
      <button class="btn ghost" :disabled="!entries.length" @click="downloadAll"><i class="bi bi-download"></i> 下载全部</button>
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
    <DropZone :multiple="false" hint="拖放源归档文件" @files="onFiles" />
    <div v-if="files.length" class="row wrap">
      <div class="field">
        <label>目标格式</label>
        <select v-model="outFmt">
          <option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }}</option>
        </select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>压缩方式</label>
        <select v-model="compression"><option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option></select>
      </div>
      <div class="field">
        <label>源密码（如加密）</label>
        <input type="password" v-model="password" placeholder="留空" style="width:160px" />
      </div>
      <button class="btn" :disabled="busy" @click="doConvert"><i class="bi bi-arrow-down-up"></i> 转换为 {{ fmtLabel }}</button>
    </div>
  </div>

  <!-- 合并 -->
  <div v-if="tab === 'merge'" class="panel">
    <DropZone multiple hint="拖放多个归档文件（将合并为一个）" @files="onArchives" />
    <div v-if="archives.length" class="row wrap">
      <div class="field">
        <label>输出格式</label>
        <select v-model="outFmt"><option v-for="f in CREATE_FORMATS" :key="f.ext" :value="f.ext">{{ f.label }}</option></select>
      </div>
      <div class="field" v-if="outFmt === 'tar.gz'">
        <label>压缩方式</label>
        <select v-model="compression"><option v-for="c in COMPRESSIONS" :key="c.id" :value="c.id">{{ c.label }}</option></select>
      </div>
      <button class="btn" :disabled="busy || archives.length < 2" @click="doMerge"><i class="bi bi-intersect"></i> 合并为 {{ fmtLabel }}</button>
    </div>
    <ul v-if="archives.length" class="files">
      <li v-for="f in archives" :key="f.name + f.size"><i class="bi bi-file-earmark"></i><span class="name">{{ f.name }}</span><span class="size">{{ formatSize(f.size) }}</span></li>
    </ul>
  </div>

  <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
  <button v-if="result" class="btn green" @click="downloadResult"><i class="bi bi-download"></i> 下载 {{ result.name }} ({{ formatSize(result.blob.size) }})</button>
</template>
