<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import {
  jsonFormat, jsonMinify, jsonValidate, base64Encode, base64Decode, hexEncode, hexDecode,
  jwtParse, regexTestAsync, timestampToDate, dateToTimestamp, uuidV4, randomPassword, passwordStrength, shaDigest,
} from '../lib/text.js'
import { consumePendingText } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const tab = ref('json')
const TOOLS = computed(() => [  { id: 'json', label: 'JSON', icon: 'bi-braces' },
  { id: 'codec', label: T('ui.text.tabCodec'), icon: 'bi-code-slash' },
  { id: 'jwt', label: 'JWT', icon: 'bi-key' },
  { id: 'regex', label: T('ui.text.tabRegex'), icon: 'bi-regex' },
  { id: 'time', label: T('ui.text.tabTime'), icon: 'bi-clock-history' },
  { id: 'gen', label: T('ui.text.tabGen'), icon: 'bi-shuffle' },
  { id: 'hash', label: T('ui.text.tabHash'), icon: 'bi-fingerprint' },
])

const message = ref(null)
function setMsg(t, text) { message.value = { type: t, text } }

// 安全执行：把异常变成可见的错误，而不是让页面崩
function safe(fn) {
  try { return { ok: true, value: fn() } } catch (e) { return { ok: false, error: e.message } }
}
async function copyText(t) {
  if (t == null || t === '') { setMsg('err', T('ui.text.errNothingToCopy')); return }
  try { await navigator.clipboard.writeText(String(t)); setMsg('ok', T('ui.text.okCopied')) }
  catch { setMsg('err', T('ui.text.errClipboard')) }
}

/* JSON */
const jsonIn = ref('{"name":"会师镇","tags":["红色","古镇"],"ok":true}')
const jsonIndent = ref(2)
const jsonOut = computed(() => safe(() => jsonFormat(jsonIn.value, jsonIndent.value)))
const jsonCheck = computed(() => {
  const r = jsonValidate(jsonIn.value)
  // 引擎返回的 type 在中文界面为「数组/对象」，映射为当前语言
  const typeMap = { '数组': 'ui.text.typeArray', '对象': 'ui.text.typeObject' }
  return { ...r, type: typeMap[r.type] ? T(typeMap[r.type]) : r.type }
})
function jsonDo(fn) {
  const r = safe(() => fn(jsonIn.value))
  if (r.ok) jsonIn.value = r.value
  else setMsg('err', r.error)
}

/* 编码转换 */
const codecMode = ref('b64e') // b64e | b64d | hexe | hexd | urle | urld
const codecIn = ref('会师镇 LocalForge')
const codecOut = computed(() =>
  safe(() => {
    const v = codecIn.value
    switch (codecMode.value) {
      case 'b64e': return base64Encode(v)
      case 'b64d': return base64Decode(v)
      case 'hexe': return hexEncode(v)
      case 'hexd': return hexDecode(v)
      case 'urle': return encodeURIComponent(v)
      case 'urld': return decodeURIComponent(v)
      default: return v
    }
  }),
)
const CODEC_OPTS = computed(() => [  ['b64e', T('ui.text.optB64Encode')], ['b64d', T('ui.text.optB64Decode')],
  ['hexe', T('ui.text.optHexEncode')], ['hexd', T('ui.text.optHexDecode')],
  ['urle', T('ui.text.optUrlEncode')], ['urld', T('ui.text.optUrlDecode')],
])

/* JWT */
const jwtIn = ref('')
const jwtOut = computed(() => (jwtIn.value.trim() ? safe(() => jwtParse(jwtIn.value)) : { ok: true, value: null }))
function fmtJson(v) { return JSON.stringify(v, null, 2) }

/* 正则：放进 Worker 异步执行，超时即中止，避免灾难性回溯卡死页面 */
const re = reactive({ pattern: '(\\d{4})-(\\d{2})-(\\d{2})', flags: 'g', text: '今天是 2026-10-13，明天是 2026-10-14' })
const reOut = ref({ ok: true, value: null })
let reSeq = 0
async function runRegex() {
  const seq = ++reSeq
  if (!re.pattern) { reOut.value = { ok: true, value: null }; return }
  try {
    const value = await regexTestAsync(re.pattern, re.flags, re.text)
    if (seq === reSeq) reOut.value = { ok: true, value }
  } catch (e) {
    if (seq === reSeq) reOut.value = { ok: false, error: e.message }
  }
}
watch(() => [re.pattern, re.flags, re.text], runRegex, { immediate: true })

/* 时间 */
const tsIn = ref(String(Math.floor(Date.now() / 1000)))
const tsOut = computed(() => safe(() => timestampToDate(tsIn.value)))
const dateIn = ref('')
const dateOut = computed(() => (dateIn.value.trim() ? safe(() => dateToTimestamp(dateIn.value)) : { ok: true, value: null }))
const nowTs = ref(Math.floor(Date.now() / 1000))
function refreshNow() { nowTs.value = Math.floor(Date.now() / 1000) }

/* UUID / 密码 */
const uuidList = ref([])
function genUuid(n = 5) { uuidList.value = Array.from({ length: n }, () => uuidV4()) }
const pwd = reactive({ length: 16, upper: true, lower: true, digits: true, symbols: true })
const pwdValue = ref('')
const pwdScore = computed(() => passwordStrength(pwdValue.value))
function genPwd() { pwdValue.value = randomPassword({ ...pwd }) }

/* 文本哈希 */
const hashIn = ref('')
const hashOut = ref(null)
async function runHash() {
  if (!hashIn.value) { hashOut.value = null; return }
  try {
    hashOut.value = await shaDigest(hashIn.value, ['SHA-1', 'SHA-256', 'SHA-512'])
  } catch (e) {
    hashOut.value = null
    setMsg('err', e.message)
  }
}

// 跨工具工作流：接收上一步（OCR / 二维码识别）传来的文本
onMounted(() => {
  const pending = consumePendingText()
  if (!pending) return
  jsonIn.value = pending.text
  codecIn.value = pending.text
  hashIn.value = pending.text
  // 若像 JSON 就停在 JSON 页，否则停在编码页
  try { JSON.parse(pending.text); tab.value = 'json' } catch { tab.value = 'codec' }
  pushToast('info', T('ui.text.toastLoaded', { from: pending.from, n: pending.text.length }))
})
</script>

<template>
  <h1 class="page-title">{{ T('ui.text.pageTitle') }}</h1>
  <p class="page-sub">
    {{ T('ui.text.sub1') }}
    <b>{{ T('ui.text.subOffline') }}</b>{{ T('ui.text.sub2') }}
  </p>

  <HelpTip :title="T('ui.text.helpTitle')" icon="bi-shield-lock" open>
    <p style="margin:0">
      {{ T('ui.text.help1') }}
      {{ T('ui.text.help2a') }}<b>{{ T('ui.text.help2b') }}</b>{{ T('ui.text.help2c') }}
      {{ T('ui.text.help3') }}
    </p>
  </HelpTip>

  <div class="tabs wrap-tabs">
    <button v-for="t in TOOLS" :key="t.id" :class="{ active: tab === t.id }" @click="tab = t.id">
      <i class="bi" :class="t.icon"></i> {{ t.label }}
    </button>
  </div>

  <!-- JSON -->
  <div v-if="tab === 'json'" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.text.labelIndent') }}</label>
        <select v-model.number="jsonIndent">
          <option :value="2">{{ T('ui.text.optIndent2') }}</option>
          <option :value="4">{{ T('ui.text.optIndent4') }}</option>
          <option :value="0">{{ T('ui.text.optMinify') }}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" @click="jsonDo((s) => jsonFormat(s, jsonIndent))"><i class="bi bi-braces"></i> {{ T('ui.text.btnFormat') }}</button>
        <button class="btn ghost" style="margin-left:8px" @click="jsonDo(jsonMinify)"><i class="bi bi-file-zip"></i> {{ T('ui.text.btnMinify') }}</button>
        <button class="btn ghost" style="margin-left:8px" @click="copyText(jsonOut.value)"><i class="bi bi-clipboard"></i> {{ T('ui.text.btnCopyResult') }}</button>
      </div>
      <div class="field">
        <label>{{ T('ui.text.labelCheck') }}</label>
        <span v-if="jsonCheck.ok" class="tag ok"><i class="bi bi-check-circle"></i> {{ T('ui.text.checkValid', { type: jsonCheck.type }) }}<template v-if="jsonCheck.count != null"> {{ T('ui.text.checkCount', { n: jsonCheck.count }) }}</template></span>
        <span v-else class="tag danger"><i class="bi bi-x-circle"></i> {{ T('ui.text.checkInvalid') }}<template v-if="jsonCheck.line"> {{ T('ui.text.checkLine', { n: jsonCheck.line }) }}</template></span>
      </div>
    </div>
    <div class="io">
      <div class="field">
        <label>{{ T('ui.text.labelInput') }}</label>
        <textarea v-model="jsonIn" rows="10" spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label>{{ T('ui.text.labelOutput') }}</label>
        <textarea rows="10" readonly spellcheck="false" :value="jsonOut.ok ? jsonOut.value : jsonOut.error"></textarea>
      </div>
    </div>
    <p v-if="!jsonCheck.ok" class="msg err">{{ jsonCheck.error }}</p>
  </div>

  <!-- 编码转换 -->
  <div v-else-if="tab === 'codec'" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.text.labelCodecMode') }}</label>
        <select v-model="codecMode">
          <option v-for="o in CODEC_OPTS" :key="o[0]" :value="o[0]">{{ o[1] }}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn ghost" @click="copyText(codecOut.ok ? codecOut.value : '')"><i class="bi bi-clipboard"></i> {{ T('ui.text.btnCopyResult') }}</button>
      </div>
    </div>
    <div class="io">
      <div class="field">
        <label>{{ T('ui.text.labelInput') }}</label>
        <textarea v-model="codecIn" rows="8" spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label>{{ T('ui.text.labelOutput') }}</label>
        <textarea rows="8" readonly spellcheck="false" :value="codecOut.ok ? codecOut.value : codecOut.error"></textarea>
      </div>
    </div>
    <p v-if="!codecOut.ok" class="msg err">{{ codecOut.error }}</p>
    <p class="hint">{{ T('ui.text.hintCodec') }}</p>
  </div>

  <!-- JWT -->
  <div v-else-if="tab === 'jwt'" class="panel">
    <div class="field">
      <label>{{ T('ui.text.labelJwtInput') }}</label>
      <textarea v-model="jwtIn" rows="4" spellcheck="false" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."></textarea>
    </div>
    <p v-if="!jwtOut.ok" class="msg err">{{ jwtOut.error }}</p>
    <template v-else-if="jwtOut.value">
      <div class="row wrap">
        <span v-if="jwtOut.value.expired" class="tag danger"><i class="bi bi-clock-history"></i> {{ T('ui.text.stExpired') }}</span>
        <span v-else class="tag ok"><i class="bi bi-check-circle"></i> {{ T('ui.text.stValid') }}</span>
        <span class="tag">{{ T('ui.text.jwtSignature', { sig: jwtOut.value.signature.slice(0, 16) }) }}</span>
      </div>
      <div v-if="jwtOut.value.flags.length" class="flags">
        <div v-for="f in jwtOut.value.flags" :key="f.k" class="row-tag" :class="f.state === 'warn' ? 'mid' : 'low'">
          <span class="k">{{ f.k }}</span><span class="v">{{ f.v }}</span>
        </div>
      </div>
      <div class="io">
        <div class="field">
          <label>{{ T('ui.text.labelHeader') }}</label>
          <textarea rows="8" readonly spellcheck="false" :value="fmtJson(jwtOut.value.header)"></textarea>
        </div>
        <div class="field">
          <label>{{ T('ui.text.labelPayload') }}</label>
          <textarea rows="8" readonly spellcheck="false" :value="fmtJson(jwtOut.value.payload)"></textarea>
        </div>
      </div>
      <p class="hint">{{ T('ui.text.hintJwt1') }}<b>{{ T('ui.text.hintJwtBold') }}</b>{{ T('ui.text.hintJwt2') }}</p>
    </template>
    <p v-else class="hint">{{ T('ui.text.hintJwtEmpty') }}</p>
  </div>

  <!-- 正则 -->
  <div v-else-if="tab === 'regex'" class="panel">
    <div class="row wrap">
      <div class="field" style="flex:2">
        <label>{{ T('ui.text.labelRegex') }}</label>
        <input v-model="re.pattern" spellcheck="false" placeholder="(\d{4})-(\d{2})" />
      </div>
      <div class="field">
        <label>{{ T('ui.text.labelFlags') }}</label>
        <input v-model="re.flags" spellcheck="false" style="width:90px" placeholder="g" />
      </div>
    </div>
    <div class="field">
      <label>{{ T('ui.text.labelTestText') }}</label>
      <textarea v-model="re.text" rows="5" spellcheck="false"></textarea>
    </div>
    <p v-if="!reOut.ok" class="msg err">{{ reOut.error }}</p>
    <template v-else-if="reOut.value">
      <div class="status">{{ T('ui.text.regexCount1') }} <b style="color:var(--txt)">{{ reOut.value.count }}</b>{{ T('ui.text.regexCount2') }}</div>
      <div class="hits">
        <div v-for="(m, i) in reOut.value.matches" :key="i" class="hit">
          <span class="idx">#{{ i + 1 }} @{{ m.index }}</span>
          <code>{{ m.match }}</code>
          <span v-if="m.groups.length" class="grp">{{ T('ui.text.regexGroups', { groups: m.groups.join(' | ') }) }}</span>
        </div>
      </div>
      <p v-if="!reOut.value.count" class="hint">{{ T('ui.text.hintNoMatch') }}</p>
    </template>
    <p class="hint">{{ T('ui.text.hintRegexLimit') }}</p>
  </div>

  <!-- 时间 -->
  <div v-else-if="tab === 'time'" class="panel">
    <div class="io">
      <div class="field">
        <label>{{ T('ui.text.labelTsToDate') }}</label>
        <div class="row wrap">
          <input v-model="tsIn" style="flex:1" />
          <button class="btn ghost" @click="tsIn = String(nowTs)"><i class="bi bi-arrow-repeat"></i> {{ T('ui.text.btnUseNow') }}</button>
        </div>
        <div v-if="tsOut.ok" class="out-box">
          <div><span>{{ T('ui.text.labelLocalTime') }}</span><b>{{ tsOut.value.local }}</b></div>
          <div><span>ISO 8601</span><b>{{ tsOut.value.iso }}</b></div>
          <div><span>UTC</span><b>{{ tsOut.value.utc }}</b></div>
          <div><span>{{ T('ui.text.labelMs') }}</span><b>{{ tsOut.value.ms }}</b></div>
        </div>
        <p v-else class="msg err">{{ tsOut.error }}</p>
      </div>
      <div class="field">
        <label>{{ T('ui.text.labelDateToTs') }}</label>
        <input v-model="dateIn" placeholder="2026-10-13 16:30:00" />
        <div v-if="dateOut.ok && dateOut.value" class="out-box">
          <div><span>{{ T('ui.text.labelSec') }}</span><b>{{ dateOut.value.seconds }}</b></div>
          <div><span>{{ T('ui.text.labelMs') }}</span><b>{{ dateOut.value.ms }}</b></div>
        </div>
        <p v-else-if="dateOut.error" class="msg err">{{ dateOut.error }}</p>
        <p v-else class="hint">{{ T('ui.text.hintDateInput') }}</p>
      </div>
    </div>
    <div class="status">
      {{ T('ui.text.labelCurrentTs') }}<b style="color:var(--txt)">{{ nowTs }}</b>
      <button class="btn ghost" style="margin-left:8px" @click="refreshNow"><i class="bi bi-arrow-clockwise"></i> {{ T('ui.text.btnRefresh') }}</button>
    </div>
  </div>

  <!-- UUID / 密码 -->
  <div v-else-if="tab === 'gen'" class="panel">
    <h3 class="sec-title"><i class="bi bi-123"></i> UUID v4</h3>
    <div class="row wrap">
      <button class="btn" @click="genUuid(5)"><i class="bi bi-shuffle"></i> {{ T('ui.text.btnGenN', { n: 5 }) }}</button>
      <button class="btn ghost" @click="genUuid(20)">{{ T('ui.text.btnGenN', { n: 20 }) }}</button>
      <button class="btn ghost" :disabled="!uuidList.length" @click="copyText(uuidList.join('\n'))"><i class="bi bi-clipboard"></i> {{ T('ui.text.btnCopyAll') }}</button>
    </div>
    <div v-if="uuidList.length" class="out-box scroll">
      <div v-for="u in uuidList" :key="u"><b>{{ u }}</b></div>
    </div>

    <h3 class="sec-title"><i class="bi bi-key"></i> {{ T('ui.text.secRandomPwd') }}</h3>
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.text.labelPwdLength', { n: pwd.length }) }}</label>
        <input type="range" min="8" max="64" v-model.number="pwd.length" style="width:160px" />
      </div>
      <label class="check"><input type="checkbox" v-model="pwd.lower" /> {{ T('ui.text.labelLower') }}</label>
      <label class="check"><input type="checkbox" v-model="pwd.upper" /> {{ T('ui.text.labelUpper') }}</label>
      <label class="check"><input type="checkbox" v-model="pwd.digits" /> {{ T('ui.text.labelDigits') }}</label>
      <label class="check"><input type="checkbox" v-model="pwd.symbols" /> {{ T('ui.text.labelSymbols') }}</label>
      <button class="btn green" @click="genPwd"><i class="bi bi-shuffle"></i> {{ T('ui.text.btnGenerate') }}</button>
      <button class="btn ghost" :disabled="!pwdValue" @click="copyText(pwdValue)"><i class="bi bi-clipboard"></i> {{ T('ui.text.btnCopy') }}</button>
    </div>
    <div v-if="pwdValue" class="pwd-box">
      <code>{{ pwdValue }}</code>
      <div class="bar"><span :class="pwdScore.level" :style="{ width: Math.max(6, pwdScore.score) + '%' }"></span></div>
      <div class="status">{{ T('ui.text.labelStrength') }}<b style="color:var(--txt)">{{ pwdScore.label }}</b>（{{ pwdScore.score }}/100）</div>
      <ul v-if="pwdScore.tips.length" class="tips">
        <li v-for="t in pwdScore.tips" :key="t">{{ t }}</li>
      </ul>
    </div>
    <p class="hint">{{ T('ui.text.hintPwd1') }}<code>crypto.getRandomValues</code>{{ T('ui.text.hintPwd2') }}</p>
  </div>

  <!-- 文本哈希 -->
  <div v-else class="panel">
    <div class="field">
      <label>{{ T('ui.text.labelInputText') }}</label>
      <textarea v-model="hashIn" rows="6" spellcheck="false" :placeholder="T('ui.text.phHashInput')"></textarea>
    </div>
    <button class="btn" :disabled="!hashIn" @click="runHash"><i class="bi bi-fingerprint"></i> {{ T('ui.text.btnHash') }}</button>
    <div v-if="hashOut" class="out-box">
      <div v-for="(v, k) in hashOut" :key="k">
        <span>{{ k }}</span><b class="mono">{{ v }}</b>
      </div>
    </div>
    <p class="hint">{{ T('ui.text.hintHash') }}</p>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.wrap-tabs { flex-wrap: wrap; }
.sec-title { margin: 16px 0 8px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.io { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 800px) { .io { grid-template-columns: 1fr; } }
textarea, input { width: 100%; box-sizing: border-box; }
textarea { font-family: var(--mono, monospace); font-size: 12.5px; }
.out-box {
  margin-top: 10px; padding: 10px 12px; border-radius: 10px;
  background: var(--panel-2, rgba(28,37,60,.55)); border: 1px solid var(--line, rgba(120,150,200,.16));
  font-size: 12.5px; display: grid; gap: 6px;
}
.out-box div { display: flex; gap: 10px; align-items: baseline; }
.out-box span { flex: none; width: 92px; color: var(--muted, #93a2bd); }
.out-box b { color: var(--txt, #e6ebf2); word-break: break-all; font-weight: 600; }
.out-box.scroll { max-height: 220px; overflow: auto; }
.out-box.scroll div { display: block; font-family: var(--mono, monospace); padding: 2px 0; }
.mono { font-family: var(--mono, monospace); }
.tag { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line-strong, rgba(120,150,200,.32)); color: var(--muted, #93a2bd); }
.tag.ok { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.1); }
.tag.danger { color: var(--danger, #fb7185); border-color: rgba(251,113,133,.45); background: rgba(251,113,133,.1); }
.flags { margin: 10px 0; display: grid; gap: 2px; }
.row-tag { display: flex; gap: 10px; font-size: 12.5px; padding: 4px 8px; border-radius: 8px; border-left: 3px solid var(--line, rgba(120,150,200,.2)); }
.row-tag .k { flex: none; width: 120px; color: var(--muted, #93a2bd); }
.row-tag .v { color: var(--txt, #e6ebf2); word-break: break-all; }
.row-tag.mid { border-left-color: var(--warn, #fbbf24); }
.hits { margin-top: 10px; display: grid; gap: 4px; }
.hit { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; padding: 4px 8px; border-radius: 8px; background: var(--panel-2, rgba(28,37,60,.5)); }
.hit .idx { color: var(--muted, #93a2bd); font-size: 11px; flex: none; }
.hit code { font-family: var(--mono, monospace); color: var(--accent, #38bdf8); }
.hit .grp { color: var(--muted, #93a2bd); font-size: 11.5px; }
.pwd-box { margin-top: 12px; }
.pwd-box code {
  display: block; padding: 10px 12px; border-radius: 10px; font-size: 14px; word-break: break-all;
  background: var(--panel-2, rgba(28,37,60,.55)); border: 1px solid var(--line, rgba(120,150,200,.16)); color: var(--txt, #e6ebf2);
}
.bar { height: 6px; border-radius: 999px; background: rgba(120,150,200,.18); overflow: hidden; margin: 8px 0 6px; }
.bar span { display: block; height: 100%; border-radius: 999px; transition: .2s; }
.bar span.weak { background: var(--danger, #fb7185); }
.bar span.medium { background: var(--warn, #fbbf24); }
.bar span.strong { background: var(--accent, #38bdf8); }
.bar span.verystrong { background: var(--accent-2, #34d399); }
.bar span.empty { background: rgba(120,150,200,.3); }
.tips { margin: 6px 0 0; padding-left: 18px; color: var(--muted, #93a2bd); font-size: 12.5px; }
</style>
