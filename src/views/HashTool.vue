<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { ALGOS, hashFile, findDuplicates } from '../lib/hash.js'
import { formatSize, downloadBlob } from '../utils.js'
import { consumePending } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const tab = ref('hash')
// 支持首页深链接 /hash?tab=dup（同一路由切换 query 时组件会被复用，故需监听）
watch(() => route.query.tab, (v) => { if (v === 'hash' || v === 'dup') tab.value = v })
const files = ref([])
const selected = reactive({ sha256: true, md5: true, crc32: false, sha1: false, sha512: false, xxhash128: false, blake3: false })
const algos = computed(() => Object.keys(selected).filter((k) => selected[k]))
const progress = ref(0)
const state = ref('idle')
const results = ref([]) // [{name,size,hashes:{}}]
const message = ref(null)
const expectValue = ref('')

const dupFiles = ref([])
const dupState = ref('idle')
const dupResult = ref(null)
const dupProgress = ref(0)

function setMsg(t, text) { message.value = { type: t, text } }

function onFiles(fs) {
  files.value = fs || []
  results.value = []
  state.value = 'idle'
  if (files.value.length) setMsg('info', T('ui.hash.msgSelected', { n: files.value.length }))
}

// 跨工具工作流：接收上一步传来的文件用于哈希校验
onMounted(() => {
  const pending = consumePending()
  if (pending && pending.files.length) {
    onFiles(pending.files)
    pushToast('info', T('ui.hash.msgLoaded', { name: pending.from, n: pending.files.length }))
  }
})

async function runHash() {
  if (!files.value.length) { setMsg('err', T('ui.hash.errNoFile')); return }
  if (!algos.value.length) { setMsg('err', T('ui.hash.errNoAlgo')); return }
  state.value = 'working'
  progress.value = 0
  results.value = []
  try {
    const out = []
    for (let i = 0; i < files.value.length; i++) {
      const f = files.value[i]
      const h = await hashFile(f, algos.value, (p) => {
        progress.value = Math.round(((i + p / 100) / files.value.length) * 100)
      })
      out.push({ name: f.name, size: f.size, hashes: h })
    }
    results.value = out
    state.value = 'done'
    setMsg('ok', T('ui.hash.msgDone', { n: out.length, m: algos.value.length }))
  } catch (e) {
    state.value = 'error'
    setMsg('err', T('ui.hash.errCalc') + e.message)
  }
}

async function copyText(t, label) {
  try {
    await navigator.clipboard.writeText(t)
    setMsg('ok', T('ui.hash.msgCopied', { label: label || T('ui.hash.content') }))
  } catch {
    setMsg('err', T('ui.hash.errClipboard'))
  }
}

const compared = computed(() => {
  const want = expectValue.value.trim().toLowerCase()
  if (!want || !results.value.length) return null
  const hits = []
  for (const r of results.value) {
    for (const [k, v] of Object.entries(r.hashes)) {
      if (String(v).toLowerCase() === want) hits.push({ name: r.name, algo: k, value: v })
    }
  }
  return { want, hits, checked: results.value.reduce((s, r) => s + Object.keys(r.hashes).length, 0) }
})

function exportCsv() {
  if (!results.value.length) return
  const algosOut = algos.value
  const rows = [[T('ui.hash.thName'), T('ui.hash.thSizeBytes'), ...algosOut]]
  for (const r of results.value) rows.push([r.name, r.size, ...algosOut.map((a) => r.hashes[a])])
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `hashes-${Date.now()}.csv`)
  setMsg('ok', T('ui.hash.msgExported'))
}

/* ---------------- 重复文件查找 ---------------- */
function onDupFiles(fs) {
  dupFiles.value = fs || []
  dupResult.value = null
  dupState.value = 'idle'
  if (dupFiles.value.length) setMsg('info', T('ui.hash.msgDupSelected', { n: dupFiles.value.length }))
}
async function runDup() {
  if (dupFiles.value.length < 2) { setMsg('err', T('ui.hash.errDupMin')); return }
  dupState.value = 'working'
  dupProgress.value = 0
  try {
    const res = await findDuplicates(dupFiles.value, { algo: 'sha256', onprogress: (p) => (dupProgress.value = p) })
    dupResult.value = res
    dupState.value = 'done'
    const wasted = res.groups.reduce((s, g) => s + g.wasted, 0)
    setMsg(
      'ok',
      res.groups.length
        ? T('ui.hash.msgDupFound', { scanned: res.scanned, groups: res.groups.length, size: formatSize(wasted) })
        : T('ui.hash.msgDupNone', { scanned: res.scanned }),
    )
  } catch (e) {
    dupState.value = 'error'
    setMsg('err', T('ui.hash.errDup') + e.message)
  }
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.hash.pageTitle') }}</h1>
  <p class="page-sub" v-html="T('ui.hash.sub')"></p>

  <HelpTip :title="T('ui.hash.helpTitle')" icon="bi-info-circle" open>
    <ol class="howto">
      <li v-html="T('ui.hash.help1')"></li>
      <li v-html="T('ui.hash.help2')"></li>
      <li v-html="T('ui.hash.help3')"></li>
    </ol>
    <p style="margin:8px 0 0" v-html="T('ui.hash.helpNote')"></p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'hash' }" @click="tab = 'hash'"><i class="bi bi-shield-check"></i> {{ T('ui.hash.tabHash') }}</button>
    <button :class="{ active: tab === 'dup' }" @click="tab = 'dup'"><i class="bi bi-copy"></i> {{ T('ui.hash.tabDup') }}</button>
  </div>

  <!-- 哈希 -->
  <div v-if="tab === 'hash'" class="panel">
    <DropZone multiple :hint="T('ui.hash.dropHint')" @files="onFiles" />

    <h3 class="sec-title"><i class="bi bi-cpu"></i> {{ T('ui.hash.algoTitle') }}</h3>
    <div class="algo-grid">
      <label v-for="a in ALGOS" :key="a.id" class="check">
        <input type="checkbox" v-model="selected[a.id]" />
        <span><b>{{ a.label }}</b><em>{{ T('ui.hash.algoNote.' + a.id) }}</em></span>
      </label>
    </div>

    <div class="row wrap" style="margin-top:12px">
      <button class="btn" :disabled="!files.length || !algos.length" @click="runHash">
        <i class="bi bi-play-circle"></i> {{ T('ui.hash.btnCalc') }}
      </button>
      <button class="btn ghost" :disabled="!results.length" @click="exportCsv">
        <i class="bi bi-file-earmark-spreadsheet"></i> {{ T('ui.hash.btnCsv') }}
      </button>
      <StatusPill :state="state" :label="state === 'working' ? T('ui.hash.stWorking', { n: progress }) : state === 'done' ? T('ui.hash.stDone', { n: results.length }) : T('ui.hash.stIdle')" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>

    <div v-if="results.length" class="field" style="margin-top:14px">
      <label>{{ T('ui.hash.expectLabel') }}</label>
      <input v-model="expectValue" :placeholder="T('ui.hash.expectPh')" />
    </div>
    <div v-if="compared" class="msg" :class="compared.hits.length ? 'ok' : 'err'">
      <template v-if="compared.hits.length">
        <b>{{ T('ui.hash.cmpSame') }}</b>：{{ compared.hits.map((h) => `${h.name}（${h.algo}）`).join('、') }} —— {{ T('ui.hash.cmpSameTail') }}
      </template>
      <template v-else>
        <b>{{ T('ui.hash.cmpDiff') }}</b>：{{ T('ui.hash.cmpDiffBody', { n: compared.checked }) }}<b>{{ T('ui.hash.cmpRedownload') }}</b>{{ T('ui.hash.cmpFile') }}
      </template>
    </div>

    <div v-if="results.length" class="table-wrap">
      <table class="kv">
        <thead>
          <tr><th>{{ T('ui.hash.thName') }}</th><th>{{ T('ui.hash.thSize') }}</th><th v-for="a in algos" :key="a">{{ a }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.name">
            <td class="fname">{{ r.name }}</td>
            <td>{{ formatSize(r.size) }}</td>
            <td v-for="a in algos" :key="a" class="mono">
              <button class="cp" :title="T('ui.hash.copyTitle', { a })" @click="copyText(r.hashes[a], a)">{{ r.hashes[a] }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="hint">{{ T('ui.hash.copyHint') }}</p>
    </div>
  </div>

  <!-- 查重 -->
  <div v-else class="panel">
    <DropZone multiple directory :hint="T('ui.hash.dupDropHint')" @files="onDupFiles" />
    <div class="row wrap" style="margin-top:12px">
      <button class="btn" :disabled="dupFiles.length < 2" @click="runDup">
        <i class="bi bi-search"></i> {{ T('ui.hash.btnFind') }}
      </button>
      <StatusPill :state="dupState" :label="dupState === 'working' ? T('ui.hash.dupWorking', { n: dupProgress }) : dupState === 'done' ? T('ui.hash.dupDone', { n: dupResult.groups.length }) : T('ui.hash.dupIdle')" />
    </div>
    <div v-if="dupState === 'working'" class="progress"><span :style="{ width: dupProgress + '%' }"></span></div>

    <div v-if="dupResult && dupResult.groups.length" class="dup-list">
      <div v-for="(g, i) in dupResult.groups" :key="i" class="dup">
        <div class="dup-head">
          <span class="tag"><i class="bi bi-files"></i> {{ g.count }} {{ T('ui.hash.sameCount') }}</span>
          <span class="tag warn"><i class="bi bi-hdd"></i> {{ T('ui.hash.releasable') }} {{ formatSize(g.wasted) }}</span>
          <code class="mono">{{ g.hash.slice(0, 24) }}…</code>
        </div>
        <ul class="files">
          <li v-for="f in g.files" :key="f.name + f.size">
            <i class="bi bi-file-earmark"></i>
            <span class="name">{{ f.name }}</span>
            <span class="size">{{ formatSize(f.size) }}</span>
          </li>
        </ul>
      </div>
    </div>
    <p v-else-if="dupResult" class="hint">{{ T('ui.hash.noDup', { n: dupResult.scanned }) }}</p>
    <p class="hint" v-html="T('ui.hash.dupHint')"></p>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 16px 0 8px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.algo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 6px; }
.algo-grid em { display: block; font-style: normal; font-size: 11.5px; color: var(--muted, #93a2bd); margin-top: 2px; }
.table-wrap { margin-top: 16px; overflow-x: auto; }
table.kv { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.kv th, table.kv td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line, rgba(120,150,200,.16)); }
table.kv th { color: var(--muted, #93a2bd); font-weight: 600; white-space: nowrap; }
.fname { color: var(--txt, #e6ebf2); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: var(--mono, monospace); }
.cp {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--accent, #38bdf8); font-family: var(--mono, monospace); font-size: 12px; text-align: left;
}
.cp:hover { text-decoration: underline; }
.dup-list { margin-top: 16px; display: grid; gap: 12px; }
.dup { border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 12px; padding: 12px; background: var(--panel-2, rgba(28,37,60,.5)); }
.dup-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.tag.warn { color: var(--warn, #fbbf24); border-color: rgba(251,191,36,.4); }
.dup-head code { font-size: 11.5px; color: var(--muted, #93a2bd); }
</style>
