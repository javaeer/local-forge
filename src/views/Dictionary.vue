<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
// 内核不进主线程：装载 / 建索引 / 检索都在后台线程，见 dictclient.js
import { loadDict, dictSearch, MODES } from '../lib/dictclient.js'
import { saveLexicon, listLexicons, deleteLexicon } from '../lib/dictstore.js'
import { precacheCores, coreStatus, swSupported } from '../lib/offline.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

/* ---------------- 状态 ---------------- */
const loading = ref(false)
const error = ref('')
const info = ref({ entries: 0, words: 0, ipaWords: 0 })
const thread = ref('') // worker=后台线程 / main=降级主线程
const sourceName = ref('')
const buildMs = ref(0)
const ipaTexts = ref(null) // { us, uk } 原始音标文本（装载后保留，换词库时复用）
const query = ref('')
const mode = ref('auto')
const res = ref(null)
const suggest = ref([]) // 空结果时的"你是不是想找"候选（自动跑一次模糊纠错）
const suggestBusy = ref(false)
const openIdx = ref(-1)
const saved = ref([]) // 本机持久化的自定义词库
const savedPersisted = ref(true)

const MODE_LABEL = computed(() => ({  auto: T('ui.dict.modeAuto'),
  exact: T('ui.dict.modeExact'),
  prefix: T('ui.dict.modePrefix'),
  pinyin: T('ui.dict.modePinyin'),
  gloss: T('ui.dict.modeGloss'),
  fuzzy: T('ui.dict.modeFuzzy'),
}))
const HIT_LABEL = computed(() => ({  exact: T('ui.dict.hitExact'), prefix: T('ui.dict.hitPrefix'), pinyin: T('ui.dict.hitPinyin'), initials: T('ui.dict.hitInitials'), gloss: T('ui.dict.hitGloss'), fuzzy: T('ui.dict.hitFuzzy'),
}))

/* 内置词库源：同一套索引/检索管道，按需切换 */
const BUILTIN_SOURCES = computed(() => ({  cedict: { id: 'cedict', file: 'dict/cc-cedict.txt.gz', name: T('ui.dict.srcCedictName'), label: T('ui.dict.srcCedictLabel') },
  ecdict: { id: 'ecdict', file: 'dict/ecdict.csv.gz', name: T('ui.dict.srcEcdictName'), label: T('ui.dict.srcEcdictLabel') },
}))
const builtinId = ref('cedict')

/* ---------------- 解压（原生优先，fflate 兜底） ---------------- */
async function maybeGunzip(buf) {
  const u8 = new Uint8Array(buf)
  const gz = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b
  if (!gz) return new TextDecoder('utf-8').decode(u8)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).text()
    } catch { /* 老浏览器 / 损坏文件 → 走 fflate */ }
  }
  const { gunzipSync } = await import('fflate')
  return new TextDecoder('utf-8').decode(gunzipSync(u8))
}

/* ---------------- 装载词库 ---------------- */
async function applyEntries(text, name) {
  // 让浏览器先把 loading 画出来，再做重活
  await new Promise((r) => setTimeout(r, 16))
  // ref 会把对象深层包成 reactive Proxy，而 Proxy 无法 structured-clone，
  // postMessage 会抛 DataCloneError —— 传给 Worker 前必须展开成纯对象
  const v = ipaTexts.value
  const ipa = v ? { us: v.us || '', uk: v.uk || '' } : null
  const r = await loadDict(text, name, ipa)
  info.value = { entries: r.entries, words: r.words, ipaWords: r.ipaWords || 0 }
  buildMs.value = r.ms
  thread.value = r.thread
  sourceName.value = name
  run()
}

/* 空态里的「换词库」入口：切库后把当前查询重放一遍，避免用户还要再敲一次 */
function switchBuiltin(id) {
  if (builtinId.value === id || loading.value) return
  loadBuiltin(id).then(() => run())
}

// 模糊纠错是拿「词表」做编辑距离：英汉词库（ECDICT）的词表全是英文，
// 拿中文去纠错必然 0 条。此时不该在空态里推荐它，否则等于把用户往死胡同引。
const fuzzyUsable = computed(() => {
  const q = String(res.value?.query || '')
  const cjk = /[\u3400-\u9fff]/.test(q)
  if (!cjk) return true
  return builtinId.value !== 'ecdict'
})

async function loadBuiltin(id) {
  const src = BUILTIN_SOURCES.value[id || builtinId.value] || BUILTIN_SOURCES.value.cedict
  if (id) builtinId.value = src.id
  loading.value = true
  error.value = ''
  try {
    const base = import.meta.env.BASE_URL
    // 主词库 + 两份 IPA 音标库并行拉取；音标库失败不阻塞主流程（音标是增强，不是依赖）
    const [main, us, uk] = await Promise.all([
      fetch(`${base}${src.file}`),
      fetch(`${base}dict/en-ipa-us.txt.gz`).catch(() => null),
      fetch(`${base}dict/en-ipa-uk.txt.gz`).catch(() => null),
    ])
    if (!main.ok) {
      const hint = src.id === 'ecdict' ? T('ui.dict.loadHintEcdict') : ''
      throw new Error(T('ui.dict.builtinFail', { status: main.status, base, file: src.file, hint }))
    }
    const text = await maybeGunzip(await main.arrayBuffer())
    ipaTexts.value = {
      us: us && us.ok ? await maybeGunzip(await us.arrayBuffer()) : '',
      uk: uk && uk.ok ? await maybeGunzip(await uk.arrayBuffer()) : '',
    }
    await applyEntries(text, src.name)
    precacheDict(src.id === 'ecdict' ? 'dict-en' : 'dict') // 后台静默预缓存（SW 管辖，访一次即可永久离线）
  } catch (e) {
    error.value = T('ui.dict.loadFailSuffix', { msg: e.message })
  } finally {
    loading.value = false
  }
}

/* ---------------- 词库预缓存（与 ffmpeg / tesseract 内核同一机制） ---------------- */
async function precacheDict(group = 'dict') {
  try {
    if (!swSupported()) return
    const st = await coreStatus()
    if (st && st.groups && st.groups[group] && st.groups[group].ready) return
    await precacheCores([group])
  } catch { /* SW 不可用就当没这回事，HTTP 缓存仍会兜底 */ }
}

/* ---------------- 检索（防抖 + 过期响应丢弃） ---------------- */
let timer = 0
let runSeq = 0
async function run() {
  const q = query.value.trim()
  if (!q) { res.value = null; suggest.value = []; return }
  const my = ++runSeq
  const r = await dictSearch(q, mode.value, 60)
  // 防抖间隔内又敲了字 / 切了模式：这份响应已过期，丢弃
  if (my !== runSeq || !r) return
  res.value = r
  // 空结果不能让用户对着空白页发懵：后台补跑一次模糊纠错，给出"你是不是想找"
  suggest.value = []
  if (!r.items.length) {
    suggestBusy.value = true
    const s = await dictSearch(q, 'fuzzy', 8).catch(() => null)
    if (my === runSeq && s) suggest.value = s.items
    suggestBusy.value = false
  }
}
watch([query, mode], () => {
  clearTimeout(timer)
  timer = setTimeout(run, 140)
})

function pickSample(s) {
  query.value = s
  run()
}

/* ---------------- 导入（成功后自动存入本机，可随时重载） ---------------- */
async function onFiles(files) {
  if (!files || !files.length) return
  loading.value = true
  error.value = ''
  try {
    const texts = []
    const names = []
    for (const f of files) {
      texts.push(await maybeGunzip(await f.arrayBuffer()))
      names.push(f.name)
    }
    const text = texts.join('\n')
    const name = names.join(' + ')
    await applyEntries(text, name)
    const rec = await saveLexicon({ name, text, count: info.value.entries })
    await refreshSaved()
    pushToast('ok', T('ui.dict.imported', {
      n: info.value.entries.toLocaleString(),
      state: rec.persisted ? T('ui.dict.importedPersisted') : T('ui.dict.importedSession'),
    }))
  } catch (e) {
    error.value = T('ui.dict.errImport', { msg: e.message || e })
    pushToast('err', T('ui.dict.importFail'))
  } finally {
    loading.value = false
  }
}

/* ---------------- 我的词库（IndexedDB / 会话内存） ---------------- */
async function refreshSaved() {
  const list = await listLexicons()
  saved.value = list
  savedPersisted.value = !list.length || !!list[0].persisted
}

async function loadSaved(rec) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await applyEntries(rec.text, rec.name)
    pushToast('ok', T('ui.dict.loadedSaved', { name: rec.name }))
  } catch (e) {
    error.value = T('ui.dict.errLoad', { msg: e.message || e })
  } finally {
    loading.value = false
  }
}

async function removeSaved(id) {
  await deleteLexicon(id)
  await refreshSaved()
}

/* ---------------- 交互 ---------------- */
function toggle(i) { openIdx.value = openIdx.value === i ? -1 : i }

// 系统本地语音朗读（Web Speech API，零依赖、零外发请求；无语音包时静默失败）
function speak(variant) {
  if (!('speechSynthesis' in window)) { pushToast('err', T('ui.dict.noSpeech')); return }
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(res.value.query)
    u.lang = variant === 'us' ? 'en-US' : 'en-GB'
    u.rate = 0.9
    speechSynthesis.speak(u)
  } catch { pushToast('err', T('ui.dict.speakFail')) }
}

async function copyEntry(it) {
  const lines = [`${it.s}${it.t && it.t !== it.s ? `（${it.t}）` : ''}  [${it.pm || it.p}]`, ...it.d.map((x, i) => `${i + 1}. ${x}`)]
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    pushToast('ok', T('ui.dict.entryCopied'))
  } catch {
    pushToast('err', T('ui.dict.clipboardDenied'))
  }
}
function onKey(e) {
  if (e.key === 'Enter') { clearTimeout(timer); run() }
  if (e.key === 'Escape') { query.value = ''; res.value = null }
}

onMounted(() => {
  loadBuiltin()
  refreshSaved()
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <h1 class="page-title">{{ T('ui.dict.pageTitle') }}</h1>
  <p class="page-sub">
    {{ T('ui.dict.sub1') }}<b>{{ T('ui.dict.sub2') }}</b>
    {{ T('ui.dict.sub3') }}
  </p>

  <HelpTip :title="T('ui.dict.helpTitle')" icon="bi-shield-lock" open>
    <p style="margin:0">
      {{ T('ui.dict.helpLead') }}<strong>{{ T('ui.dict.helpUnauth') }}</strong>{{ T('ui.dict.helpNoWeb') }}
      {{ T('ui.dict.helpRest') }}
    </p>
  </HelpTip>

  <!-- 搜索区 -->
  <div class="panel">
    <div class="search-row">
      <i class="bi bi-search search-icon"></i>
      <input
        v-model="query"
        type="text"
        class="search-input"
        :placeholder="T('ui.dict.phSearch')"
        autocomplete="off"
        spellcheck="false"
        @keydown="onKey"
      />
      <button v-if="query" class="btn ghost clear-btn" :title="T('ui.dict.clearTitle')" @click="query = ''; res = null">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>

    <div class="row">
      <div class="field" style="min-width:240px;flex:1">
        <label>{{ T('ui.dict.modeLabel') }}</label>
        <select v-model="mode">
          <option v-for="m in MODES" :key="m" :value="m">{{ MODE_LABEL[m] }}</option>
        </select>
      </div>
      <div class="field" style="min-width:220px;flex:0 0 auto">
        <label>{{ T('ui.dict.builtinLabel') }}</label>
        <select v-model="builtinId" :disabled="loading" @change="loadBuiltin()">
          <option v-for="s in BUILTIN_SOURCES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>
      <div class="field" style="flex:0 0 auto">
        <label>{{ T('ui.dict.sampleLabel') }}</label>
        <div class="samples">
          <button v-for="s in ['绿色', 'lvse', 'nǐ hǎo', 'nh', 'bicycle']" :key="s" class="chip" @click="pickSample(s)">{{ s }}</button>
        </div>
      </div>
    </div>

    <p v-if="builtinId === 'ecdict'" class="hint" style="margin:6px 0 0">
      {{ T('ui.dict.ecdictHint1') }}<b>21.7 MB</b>{{ T('ui.dict.ecdictHint2') }}<b>{{ T('ui.dict.ecdictIndexSec') }}</b>{{ T('ui.dict.ecdictHint3') }}<b>500 MB</b>{{ T('ui.dict.ecdictHint4') }}
    </p>

    <div class="status">
      <template v-if="info.entries">
        <i class="bi bi-database-check"></i>
        {{ T('ui.dict.statusLexicon') }}<b>{{ sourceName }}</b> · <b>{{ info.entries.toLocaleString() }}</b>{{ T('ui.dict.statusEntries') }}
        {{ T('ui.dict.statusBuild') }} <b>{{ buildMs }} ms</b>（<span class="thread-badge">{{ thread === 'worker' ? T('ui.dict.threadWorker') : T('ui.dict.threadMain') }}</span>）
        <template v-if="info.ipaWords">{{ T('ui.dict.statusIpa') }}<b>{{ info.ipaWords.toLocaleString() }}</b>{{ T('ui.dict.statusWords') }}</template>{{ T('ui.dict.statusAllLocal') }}
      </template>
      <template v-else-if="loading">{{ T('ui.dict.statusLoading') }}</template>
      <template v-else>{{ T('ui.dict.statusNotReady') }}</template>
    </div>

    <div v-if="loading" class="progress indeterminate"><span></span></div>
    <div v-if="error" class="msg err">{{ error }}</div>
  </div>

  <!-- 结果 -->
  <!-- 空结果：绝不能只留一片白 —— 说明为什么没查到、给出下一步动作与相近词 -->
  <div v-if="res && res.query && !res.items.length" class="empty-state">
    <div class="es-title"><i class="bi bi-search"></i> {{ T('ui.dict.notFound', { q: res.query }) }}</div>

    <div v-if="suggest.length" class="es-block">
      <div class="es-label">{{ T('ui.dict.suggestLabel') }}</div>
      <div class="es-chips">
        <button v-for="it in suggest" :key="it.i" class="chip" @click="pickSample(it.s)">
          {{ it.s }}<span v-if="it.t && it.t !== it.s" class="es-trad">{{ it.t }}</span>
        </button>
      </div>
    </div>
    <div v-else-if="suggestBusy" class="es-block es-muted">{{ T('ui.dict.suggestBusy') }}</div>

    <ul class="es-tips">
      <li v-if="builtinId === 'cedict'">
        {{ T('ui.dict.emptyCedict1') }} <b>{{ T('ui.dict.emptyCedictName') }}</b>{{ T('ui.dict.emptyCedict2') }}
        <a href="#" @click.prevent="switchBuiltin('ecdict')">{{ T('ui.dict.switchEcdict') }}</a> {{ T('ui.dict.emptyReverse') }}
      </li>
      <li v-else>
        {{ T('ui.dict.emptyCedict1') }} <b>{{ T('ui.dict.switchEcdict') }}</b>{{ T('ui.dict.emptyEcdict2') }}
        <a href="#" @click.prevent="switchBuiltin('cedict')">{{ T('ui.dict.switchCedict') }}</a> {{ T('ui.dict.emptyQuery') }}
      </li>
      <li v-if="mode !== 'fuzzy' && fuzzyUsable">
        {{ T('ui.dict.emptyFuzzy1') }} <a href="#" @click.prevent="mode = 'fuzzy'">{{ T('ui.dict.emptyFuzzyLink') }}</a>{{ T('ui.dict.emptyFuzzy2') }}
      </li>
      <li>
        {{ T('ui.dict.emptyImport1') }} <b>{{ T('ui.dict.emptyImportBold') }}</b>{{ T('ui.dict.emptyImport2') }}
      </li>
    </ul>
    <p class="es-muted" style="margin:8px 0 0">
      {{ T('ui.dict.tried1') }}<template v-if="builtinId === 'ecdict'">{{ T('ui.dict.triedEcdict') }}</template>{{ T('ui.dict.period') }}
    </p>
  </div>

  <div v-if="res && res.total" class="result-bar">
    <span><b>{{ res.total.toLocaleString() }}</b>{{ T('ui.dict.resultCount') }}{{ res.took }} ms</span>
    <span class="mono-note">{{ T('ui.dict.queryLabel', { q: res.query }) }}</span>
  </div>

  <!-- 英语音标卡：查询单个英文词时由音标库给出（美式 / 英式） -->
  <div v-if="res && res.ipa" class="ipa-card">
    <div v-for="(ipas, v) in res.ipa" :key="v" class="ipa-row">
      <span class="ipa-tag">{{ v === 'us' ? T('ui.dict.ipaUs') : T('ui.dict.ipaUk') }}</span>
      <span class="ipa-val">/{{ ipas[0] }}/</span>
      <span v-if="ipas.length > 1" class="ipa-alt" :title="ipas.map((x) => '/' + x + '/').join('  ')">
        {{ T('ui.dict.ipaMore', { n: ipas.length - 1 }) }}
      </span>
      <button class="ipa-play" :title="T('ui.dict.readWordTitle')" @click="speak(v)">
        <i class="bi bi-volume-up-fill"></i>
      </button>
    </div>
    <span class="ipa-src">{{ T('ui.dict.ipaSrc') }}</span>
  </div>

  <div v-if="res && res.items.length" class="dict-list">
    <div v-for="it in res.items" :key="it.i" class="dict-item" :class="{ open: openIdx === it.i }">
      <div class="di-head" @click="toggle(it.i)">
        <span class="di-word">{{ it.s }}</span>
        <span v-if="it.t && it.t !== it.s" class="di-trad">{{ it.t }}</span>
        <span v-if="it.pm" class="di-py">{{ it.pm }}</span>
        <span class="di-hit" :data-hit="it.hit">{{ HIT_LABEL[it.hit] || it.hit }}</span>
        <i class="bi di-caret" :class="openIdx === it.i ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
      </div>
      <div class="di-def" v-if="it.d.length">{{ it.d[0] }}</div>
      <div v-if="openIdx === it.i" class="di-more">
        <ol>
          <li v-for="(d, k) in it.d" :key="k">{{ d }}</li>
        </ol>
        <p v-if="!it.d.length" class="hint" style="margin:8px 0 0">{{ T('ui.dict.noDef') }}</p>
        <div class="row" style="margin:10px 0 0">
          <span class="hint" style="margin:0;flex:1">
            {{ T('ui.dict.rawPinyin') }}<code>{{ it.p || '—' }}</code>{{ T('ui.dict.entryNo', { n: it.i }) }}
          </span>
          <button class="btn ghost" @click="copyEntry(it)"><i class="bi bi-clipboard"></i> {{ T('ui.dict.copyEntry') }}</button>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="res && !res.items.length" class="msg info">
    {{ T('ui.dict.noHit1') }} <b>{{ T('ui.dict.noHitBold1') }}</b>{{ T('ui.dict.noHit2') }}<b>{{ T('ui.dict.noHitBold2') }}</b>{{ T('ui.dict.noHit3') }}
  </div>

  <!-- 空态 -->
  <div v-if="!res && info.entries" class="panel empty-hint">
    <i class="bi bi-journal-text"></i>
    <p>{{ T('ui.dict.emptyHint') }}</p>
  </div>

  <!-- 导入 -->
  <details class="panel">
    <summary class="import-summary"><i class="bi bi-box-arrow-in-down"></i> {{ T('ui.dict.importSummary') }}</summary>
    <p class="hint" style="margin-top:12px">
      {{ T('ui.dict.importHint1') }}<b>CC-CEDICT</b>{{ T('ui.dict.importHint2') }}<b>Kaikki / Wiktextract</b>{{ T('ui.dict.importHint3') }}<b>TSV</b>{{ T('ui.dict.importHint4') }}
      {{ T('ui.dict.importHint5') }}
    </p>
    <DropZone
      :multiple="true"
      accept=".txt,.gz,.jsonl,.json,.tsv,.csv"
      :hint="T('ui.dict.dropHint')"
      formats="CC-CEDICT .txt / .gz · JSONL · TSV"
      :single="T('ui.dict.dropSingle')"
      @files="onFiles"
    />
    <div v-if="saved.length" class="saved-row">
      <span class="hint" style="margin:0">{{ T('ui.dict.myLexicons', { state: savedPersisted ? T('ui.dict.persisted') : T('ui.dict.sessionOnly') }) }}</span>
      <span class="saved-chips">
        <span v-for="s in saved" :key="s.id" class="saved-item">
          <button class="chip" :title="T('ui.dict.savedTitle', { n: s.count.toLocaleString(), date: new Date(s.addedAt).toLocaleString() })" @click="loadSaved(s)">
            {{ s.name }} · {{ s.count.toLocaleString() }}
          </button>
          <button class="saved-del" :title="T('ui.dict.deleteTitle')" @click="removeSaved(s.id)"><i class="bi bi-x"></i></button>
        </span>
      </span>
    </div>
    <div class="row">
      <button class="btn ghost" @click="loadBuiltin"><i class="bi bi-arrow-counterclockwise"></i> {{ T('ui.dict.restoreBuiltin') }}</button>
    </div>
  </details>

  <!-- 数据来源 -->
  <div class="panel">
    <h3 style="margin-top:0;font-size:15px"><i class="bi bi-info-circle"></i> {{ T('ui.dict.sourcesTitle') }}</h3>
    <ul class="src-list">
      <li>
        <b>CC-CEDICT</b> —— {{ T('ui.dict.srcCedict1') }}<b>CC BY-SA 4.0</b>{{ T('ui.dict.srcCedict2') }}
        {{ T('ui.dict.srcCedict3') }}<code>public/dict/cc-cedict.txt.gz</code>{{ T('ui.dict.srcCedict4') }}
      </li>
      <li>
        <b>ECDICT</b> —— {{ T('ui.dict.srcEcdict1') }}<b>MIT</b>{{ T('ui.dict.srcEcdict2') }}
        {{ T('ui.dict.srcEcdict3') }}<code>public/dict/ecdict.csv.gz</code>{{ T('ui.dict.srcEcdict4') }}<code>fetch-dict</code>{{ T('ui.dict.srcEcdict5') }}
      </li>
      <li>
        <b>Kaikki / Wiktextract</b> —— {{ T('ui.dict.srcKaikki1') }}
      </li>
      <li>
        <b>{{ T('ui.dict.methodTitle') }}</b>{{ T('ui.dict.method1') }}
        {{ T('ui.dict.method2') }}<b>IndexedDB</b>{{ T('ui.dict.method3') }}
      </li>
    </ul>
    <p class="hint" style="margin-bottom:0">
      {{ T('ui.dict.needPro') }}
      {{ T('ui.dict.position1') }}<b>{{ T('ui.dict.positionBold') }}</b>{{ T('ui.dict.position2') }}
    </p>
  </div>
</template>

<style scoped>
.search-row { display: flex; align-items: center; gap: 10px; position: relative; }
.search-icon { position: absolute; left: 14px; color: var(--accent); font-size: 17px; pointer-events: none; }
.search-input {
  flex: 1; width: 100%; padding: 13px 14px 13px 42px !important;
  font-size: 16px !important; border-radius: 12px !important;
}
.clear-btn { padding: 8px 10px; }

.samples { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex; align-items: center; padding: 4px 11px; border-radius: 999px;
  font-size: 12.5px; cursor: pointer; color: var(--muted);
  border: 1px solid var(--line-strong); background: var(--panel-2); transition: .15s;
}
.chip:hover { color: var(--accent); border-color: var(--accent); background: rgba(232,149,74,.08); }

.thread-badge {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line-strong); color: var(--muted);
}

.ipa-card {
  display: flex; flex-direction: column; gap: 6px;
  margin: 0 0 12px; padding: 12px 16px;
  border: 1px solid rgba(52, 211, 153, .35); border-radius: var(--radius-sm);
  background: rgba(52, 211, 153, .06);
}
.ipa-row { display: flex; align-items: center; gap: 10px; }
.ipa-tag {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid rgba(52, 211, 153, .5); color: var(--accent-2, #34d399);
}
.ipa-val { font-family: var(--mono); font-size: 15px; color: var(--txt); letter-spacing: .3px; }
.ipa-alt { font-size: 11.5px; color: var(--faint); cursor: help; }
.ipa-play {
  margin-left: auto; border: none; background: none; cursor: pointer;
  color: var(--accent); font-size: 15px; padding: 2px 6px;
}
.ipa-play:hover { transform: scale(1.15); }
.ipa-src { font-size: 11px; color: var(--faint); }

.saved-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.saved-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.saved-item { display: inline-flex; align-items: center; gap: 2px; }
.saved-del {
  border: none; background: none; cursor: pointer; padding: 2px 4px;
  color: var(--faint); font-size: 13px; line-height: 1;
}
.saved-del:hover { color: #f87171; }

.result-bar {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  margin: 16px 2px 8px; font-size: 12.5px; color: var(--muted);
}
.result-bar b { color: var(--accent); }
.mono-note { font-family: var(--mono); color: var(--faint); }

/* 空结果面板：说明 + 相近词 + 下一步动作 */
.empty-state {
  margin: 16px 0 8px; padding: 16px 18px; border-radius: 12px;
  border: 1px dashed var(--line-strong); background: var(--panel-2);
}
.es-title { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 600; color: var(--txt); }
.es-title i { color: var(--warn, #f59e0b); }
.es-block { margin-top: 12px; }
.es-label { font-size: 12px; color: var(--faint); margin-bottom: 6px; }
.es-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.es-trad { color: var(--faint); margin-left: 4px; font-size: 11.5px; }
.es-tips { margin: 12px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.85; color: var(--muted); }
.es-tips a { color: var(--accent); text-decoration: none; border-bottom: 1px dashed currentColor; }
.es-tips a:hover { border-bottom-style: solid; }
.es-muted { font-size: 12px; color: var(--faint); }

.dict-list { display: flex; flex-direction: column; gap: 8px; }
.dict-item {
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--panel-2); overflow: hidden; transition: border-color .15s;
}
.dict-item.open, .dict-item:hover { border-color: rgba(232,149,74,.45); }
.di-head {
  display: flex; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer;
}
.di-word { font-size: 18px; font-weight: 700; color: var(--txt); letter-spacing: .5px; }
.di-trad { font-size: 13px; color: var(--faint); }
.di-py { font-family: var(--mono); font-size: 13px; color: var(--accent-2, #34d399); margin-left: 2px; }
.di-hit {
  margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line-strong); color: var(--faint);
}
.di-hit[data-hit="exact"] { color: var(--accent); border-color: rgba(232,149,74,.5); }
.di-hit[data-hit="fuzzy"] { color: #fbbf24; border-color: rgba(251,191,36,.45); }
.di-caret { color: var(--faint); font-size: 12px; }
.di-def { padding: 0 14px 11px; color: var(--muted); font-size: 13.5px; line-height: 1.6; }
.di-more { padding: 0 14px 12px; border-top: 1px dashed var(--line); }
.di-more ol { margin: 10px 0 0; padding-left: 22px; color: var(--muted); font-size: 13px; line-height: 1.8; }
.di-more code { font-family: var(--mono); color: var(--accent); }

.empty-hint { text-align: center; color: var(--faint); }
.empty-hint i { font-size: 32px; display: block; margin-bottom: 8px; color: var(--accent); opacity: .7; }
.empty-hint p { margin: 0; font-size: 13px; }

.import-summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--txt); list-style: none; }
.import-summary::-webkit-details-marker { display: none; }
.import-summary i { color: var(--accent); margin-right: 6px; }

.src-list { color: var(--muted); font-size: 13px; line-height: 1.9; margin: 8px 0 12px; padding-left: 20px; }
.src-list code { font-family: var(--mono); color: var(--accent); font-size: 12px; }
</style>
