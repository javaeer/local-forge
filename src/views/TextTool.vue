<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import {
  jsonFormat, jsonMinify, jsonValidate, base64Encode, base64Decode, hexEncode, hexDecode,
  jwtParse, regexTestAsync, timestampToDate, dateToTimestamp, uuidV4, randomPassword, passwordStrength, shaDigest,
} from '../lib/text.js'
import { consumePendingText } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'

const tab = ref('json')
const TOOLS = [
  { id: 'json', label: 'JSON', icon: 'bi-braces' },
  { id: 'codec', label: '编码转换', icon: 'bi-code-slash' },
  { id: 'jwt', label: 'JWT', icon: 'bi-key' },
  { id: 'regex', label: '正则测试', icon: 'bi-regex' },
  { id: 'time', label: '时间戳', icon: 'bi-clock-history' },
  { id: 'gen', label: 'UUID / 密码', icon: 'bi-shuffle' },
  { id: 'hash', label: '文本哈希', icon: 'bi-fingerprint' },
]

const message = ref(null)
function setMsg(t, text) { message.value = { type: t, text } }

// 安全执行：把异常变成可见的错误，而不是让页面崩
function safe(fn) {
  try { return { ok: true, value: fn() } } catch (e) { return { ok: false, error: e.message } }
}
async function copyText(t) {
  if (t == null || t === '') { setMsg('err', '没有可复制的内容'); return }
  try { await navigator.clipboard.writeText(String(t)); setMsg('ok', '已复制到剪贴板。') }
  catch { setMsg('err', '浏览器拒绝了剪贴板权限，请手动选中复制。') }
}

/* JSON */
const jsonIn = ref('{"name":"会师镇","tags":["红色","古镇"],"ok":true}')
const jsonIndent = ref(2)
const jsonOut = computed(() => safe(() => jsonFormat(jsonIn.value, jsonIndent.value)))
const jsonCheck = computed(() => jsonValidate(jsonIn.value))
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
const CODEC_OPTS = [
  ['b64e', 'Base64 编码'], ['b64d', 'Base64 解码'],
  ['hexe', 'Hex 编码'], ['hexd', 'Hex 解码'],
  ['urle', 'URL 编码'], ['urld', 'URL 解码'],
]

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
  pushToast('info', `已从「${pending.from}」载入文本（${pending.text.length} 字）`)
})
</script>

<template>
  <h1 class="page-title">文本 / 编码工具箱</h1>
  <p class="page-sub">
    JSON、Base64、Hex、JWT、正则、时间戳、UUID 与密码、文本哈希——全部用浏览器原生能力本地计算，
    <b>不联网、不上传</b>。密钥、令牌、客户数据可以放心贴进来。
  </p>

  <HelpTip title="安全提示：为什么不该用在线工具？" icon="bi-shield-lock" open>
    <p style="margin:0">
      你在网上随手搜到的"在线 JSON 格式化 / JWT 解析 / Base64 解码"，会把你粘贴的内容发到对方服务器——
      里面往往就是 <b>API Key、登录令牌、数据库连接串</b>。这里所有转换都在你的浏览器里完成，
      按 F12 看网络面板也不会有一条外发请求。
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
        <label>缩进</label>
        <select v-model.number="jsonIndent">
          <option :value="2">2 空格</option>
          <option :value="4">4 空格</option>
          <option :value="0">压缩（无空格）</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" @click="jsonDo((s) => jsonFormat(s, jsonIndent))"><i class="bi bi-braces"></i> 格式化</button>
        <button class="btn ghost" style="margin-left:8px" @click="jsonDo(jsonMinify)"><i class="bi bi-file-zip"></i> 压缩</button>
        <button class="btn ghost" style="margin-left:8px" @click="copyText(jsonOut.value)"><i class="bi bi-clipboard"></i> 复制结果</button>
      </div>
      <div class="field">
        <label>校验结果</label>
        <span v-if="jsonCheck.ok" class="tag ok"><i class="bi bi-check-circle"></i> JSON 合法 · {{ jsonCheck.type }}<template v-if="jsonCheck.count != null"> · {{ jsonCheck.count }} 项</template></span>
        <span v-else class="tag danger"><i class="bi bi-x-circle"></i> 不合法<template v-if="jsonCheck.line"> · 约第 {{ jsonCheck.line }} 行</template></span>
      </div>
    </div>
    <div class="io">
      <div class="field">
        <label>输入</label>
        <textarea v-model="jsonIn" rows="10" spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label>输出</label>
        <textarea rows="10" readonly spellcheck="false" :value="jsonOut.ok ? jsonOut.value : jsonOut.error"></textarea>
      </div>
    </div>
    <p v-if="!jsonCheck.ok" class="msg err">{{ jsonCheck.error }}</p>
  </div>

  <!-- 编码转换 -->
  <div v-else-if="tab === 'codec'" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>转换方式</label>
        <select v-model="codecMode">
          <option v-for="o in CODEC_OPTS" :key="o[0]" :value="o[0]">{{ o[1] }}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn ghost" @click="copyText(codecOut.ok ? codecOut.value : '')"><i class="bi bi-clipboard"></i> 复制结果</button>
      </div>
    </div>
    <div class="io">
      <div class="field">
        <label>输入</label>
        <textarea v-model="codecIn" rows="8" spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label>输出</label>
        <textarea rows="8" readonly spellcheck="false" :value="codecOut.ok ? codecOut.value : codecOut.error"></textarea>
      </div>
    </div>
    <p v-if="!codecOut.ok" class="msg err">{{ codecOut.error }}</p>
    <p class="hint">Base64 / Hex 均按 UTF-8 处理，中文不会乱码（原生 btoa 直接吃中文会报错，这里已做桥接）。</p>
  </div>

  <!-- JWT -->
  <div v-else-if="tab === 'jwt'" class="panel">
    <div class="field">
      <label>粘贴 JWT（会自动去掉开头的 Bearer）</label>
      <textarea v-model="jwtIn" rows="4" spellcheck="false" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."></textarea>
    </div>
    <p v-if="!jwtOut.ok" class="msg err">{{ jwtOut.error }}</p>
    <template v-else-if="jwtOut.value">
      <div class="row wrap">
        <span v-if="jwtOut.value.expired" class="tag danger"><i class="bi bi-clock-history"></i> 已过期</span>
        <span v-else class="tag ok"><i class="bi bi-check-circle"></i> 未过期</span>
        <span class="tag">签名：{{ jwtOut.value.signature.slice(0, 16) }}…（本工具不校验签名真伪）</span>
      </div>
      <div v-if="jwtOut.value.flags.length" class="flags">
        <div v-for="f in jwtOut.value.flags" :key="f.k" class="row-tag" :class="f.state === 'warn' ? 'mid' : 'low'">
          <span class="k">{{ f.k }}</span><span class="v">{{ f.v }}</span>
        </div>
      </div>
      <div class="io">
        <div class="field">
          <label>Header（算法 / 类型）</label>
          <textarea rows="8" readonly spellcheck="false" :value="fmtJson(jwtOut.value.header)"></textarea>
        </div>
        <div class="field">
          <label>Payload（载荷）</label>
          <textarea rows="8" readonly spellcheck="false" :value="fmtJson(jwtOut.value.payload)"></textarea>
        </div>
      </div>
      <p class="hint">只做<b>本地解码查看</b>，不验证签名（验证需要密钥）；因此它不能用来判断 token 是否被伪造。</p>
    </template>
    <p v-else class="hint">粘贴一个 JWT 后，这里会显示它的算法、载荷字段与过期状态。</p>
  </div>

  <!-- 正则 -->
  <div v-else-if="tab === 'regex'" class="panel">
    <div class="row wrap">
      <div class="field" style="flex:2">
        <label>正则表达式</label>
        <input v-model="re.pattern" spellcheck="false" placeholder="(\d{4})-(\d{2})" />
      </div>
      <div class="field">
        <label>标志 flags</label>
        <input v-model="re.flags" spellcheck="false" style="width:90px" placeholder="g" />
      </div>
    </div>
    <div class="field">
      <label>测试文本</label>
      <textarea v-model="re.text" rows="5" spellcheck="false"></textarea>
    </div>
    <p v-if="!reOut.ok" class="msg err">{{ reOut.error }}</p>
    <template v-else-if="reOut.value">
      <div class="status">匹配到 <b style="color:var(--txt)">{{ reOut.value.count }}</b> 处（最多显示 200 条）</div>
      <div class="hits">
        <div v-for="(m, i) in reOut.value.matches" :key="i" class="hit">
          <span class="idx">#{{ i + 1 }} @{{ m.index }}</span>
          <code>{{ m.match }}</code>
          <span v-if="m.groups.length" class="grp">分组：{{ m.groups.join(' | ') }}</span>
        </div>
      </div>
      <p v-if="!reOut.value.count" class="hint">没有匹配。检查表达式，或给 flags 加上 g 以查找全部。</p>
    </template>
    <p class="hint">测试文本上限 20000 字符，并设有循环保护，避免灾难性回溯把页面卡住。</p>
  </div>

  <!-- 时间 -->
  <div v-else-if="tab === 'time'" class="panel">
    <div class="io">
      <div class="field">
        <label>时间戳 → 日期（秒 / 毫秒自动识别）</label>
        <div class="row wrap">
          <input v-model="tsIn" style="flex:1" />
          <button class="btn ghost" @click="tsIn = String(nowTs)"><i class="bi bi-arrow-repeat"></i> 用当前时间</button>
        </div>
        <div v-if="tsOut.ok" class="out-box">
          <div><span>本地时间</span><b>{{ tsOut.value.local }}</b></div>
          <div><span>ISO 8601</span><b>{{ tsOut.value.iso }}</b></div>
          <div><span>UTC</span><b>{{ tsOut.value.utc }}</b></div>
          <div><span>毫秒</span><b>{{ tsOut.value.ms }}</b></div>
        </div>
        <p v-else class="msg err">{{ tsOut.error }}</p>
      </div>
      <div class="field">
        <label>日期 → 时间戳</label>
        <input v-model="dateIn" placeholder="2026-10-13 16:30:00" />
        <div v-if="dateOut.ok && dateOut.value" class="out-box">
          <div><span>秒</span><b>{{ dateOut.value.seconds }}</b></div>
          <div><span>毫秒</span><b>{{ dateOut.value.ms }}</b></div>
        </div>
        <p v-else-if="dateOut.error" class="msg err">{{ dateOut.error }}</p>
        <p v-else class="hint">输入日期后这里显示对应的 Unix 时间戳。</p>
      </div>
    </div>
    <div class="status">
      当前时间戳：<b style="color:var(--txt)">{{ nowTs }}</b>
      <button class="btn ghost" style="margin-left:8px" @click="refreshNow"><i class="bi bi-arrow-clockwise"></i> 刷新</button>
    </div>
  </div>

  <!-- UUID / 密码 -->
  <div v-else-if="tab === 'gen'" class="panel">
    <h3 class="sec-title"><i class="bi bi-123"></i> UUID v4</h3>
    <div class="row wrap">
      <button class="btn" @click="genUuid(5)"><i class="bi bi-shuffle"></i> 生成 5 个</button>
      <button class="btn ghost" @click="genUuid(20)">生成 20 个</button>
      <button class="btn ghost" :disabled="!uuidList.length" @click="copyText(uuidList.join('\n'))"><i class="bi bi-clipboard"></i> 复制全部</button>
    </div>
    <div v-if="uuidList.length" class="out-box scroll">
      <div v-for="u in uuidList" :key="u"><b>{{ u }}</b></div>
    </div>

    <h3 class="sec-title"><i class="bi bi-key"></i> 随机密码</h3>
    <div class="row wrap">
      <div class="field">
        <label>长度 {{ pwd.length }}</label>
        <input type="range" min="8" max="64" v-model.number="pwd.length" style="width:160px" />
      </div>
      <label class="check"><input type="checkbox" v-model="pwd.lower" /> 小写</label>
      <label class="check"><input type="checkbox" v-model="pwd.upper" /> 大写</label>
      <label class="check"><input type="checkbox" v-model="pwd.digits" /> 数字</label>
      <label class="check"><input type="checkbox" v-model="pwd.symbols" /> 符号</label>
      <button class="btn green" @click="genPwd"><i class="bi bi-shuffle"></i> 生成</button>
      <button class="btn ghost" :disabled="!pwdValue" @click="copyText(pwdValue)"><i class="bi bi-clipboard"></i> 复制</button>
    </div>
    <div v-if="pwdValue" class="pwd-box">
      <code>{{ pwdValue }}</code>
      <div class="bar"><span :class="pwdScore.level" :style="{ width: Math.max(6, pwdScore.score) + '%' }"></span></div>
      <div class="status">强度：<b style="color:var(--txt)">{{ pwdScore.label }}</b>（{{ pwdScore.score }}/100）</div>
      <ul v-if="pwdScore.tips.length" class="tips">
        <li v-for="t in pwdScore.tips" :key="t">{{ t }}</li>
      </ul>
    </div>
    <p class="hint">密码由浏览器 <code>crypto.getRandomValues</code> 生成（密码学安全随机源），且不会被记录或上传。</p>
  </div>

  <!-- 文本哈希 -->
  <div v-else class="panel">
    <div class="field">
      <label>输入文本</label>
      <textarea v-model="hashIn" rows="6" spellcheck="false" placeholder="可粘贴需要计算摘要的文本"></textarea>
    </div>
    <button class="btn" :disabled="!hashIn" @click="runHash"><i class="bi bi-fingerprint"></i> 计算摘要</button>
    <div v-if="hashOut" class="out-box">
      <div v-for="(v, k) in hashOut" :key="k">
        <span>{{ k }}</span><b class="mono">{{ v }}</b>
      </div>
    </div>
    <p class="hint">使用浏览器 Web Crypto（SHA-1 / SHA-256 / SHA-512）。需要 MD5 / CRC32 / BLAKE3 请用「文件哈希」工具。</p>
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
