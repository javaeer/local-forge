<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StepBar from '../components/StepBar.vue'
import StatusPill from '../components/StatusPill.vue'
import {
  QR_TYPES, QR_MAX_CHARS, buildPayload, renderQrCanvas, renderQrSvg, canvasToBlob,
  loadLogoImage, detectFromFile, grabFrame, detectFromCanvas, describeText, supportsNativeDetector,
  buildBatch,
} from '../lib/qrcode.js'
import { createZip } from '../lib/archive.js'
import { downloadBlob, formatSize, basename } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import { consumePending, consumePendingText, stashText } from '../lib/workflow.js'

const route = useRoute()
const router = useRouter()

/* ---------------- 生成 ---------------- */
const TYPE_SCHEMA = {
  text: [{ key: 'text', label: '内容', type: 'textarea', ph: '输入任意文字，或粘贴一个网址' }],
  url: [{ key: 'url', label: '网址', type: 'text', ph: 'example.com' }],
  wifi: [
    { key: 'ssid', label: '网络名称（SSID）', type: 'text', ph: 'My-WiFi' },
    { key: 'password', label: '密码', type: 'password', ph: '若无密码请选「开放网络」' },
    { key: 'encryption', label: '加密方式', type: 'select', options: [['WPA', 'WPA / WPA2 / WPA3（最常见）'], ['WEP', 'WEP（老旧）'], ['nopass', '开放网络（无密码）']] },
    { key: 'hidden', label: '这是隐藏网络', type: 'checkbox' },
  ],
  vcard: [
    { key: 'name', label: '姓名', type: 'text', ph: '张三' },
    { key: 'tel', label: '手机', type: 'text', ph: '13800000000' },
    { key: 'org', label: '公司', type: 'text', ph: '选填' },
    { key: 'title', label: '职位', type: 'text', ph: '选填' },
    { key: 'email', label: '邮箱', type: 'text', ph: '选填' },
    { key: 'url', label: '网址', type: 'text', ph: '选填' },
    { key: 'addr', label: '地址', type: 'text', ph: '选填' },
  ],
  email: [
    { key: 'to', label: '收件人', type: 'text', ph: 'someone@example.com' },
    { key: 'subject', label: '主题', type: 'text', ph: '选填' },
    { key: 'body', label: '正文', type: 'textarea', ph: '选填' },
  ],
  phone: [{ key: 'tel', label: '电话号码', type: 'text', ph: '13800000000' }],
  sms: [
    { key: 'tel', label: '接收号码', type: 'text', ph: '13800000000' },
    { key: 'body', label: '短信内容', type: 'textarea', ph: '选填' },
  ],
  geo: [
    { key: 'lat', label: '纬度', type: 'text', ph: '39.9042' },
    { key: 'lng', label: '经度', type: 'text', ph: '116.4074' },
  ],
}

const tab = ref(route.query.tab === 'decode' ? 'decode' : route.query.tab === 'batch' ? 'batch' : 'make')
const type = ref('text')
const form = reactive({
  text: '', url: '', ssid: '', password: '', encryption: 'WPA', hidden: false,
  name: '', tel: '', org: '', title: '', email: '', addr: '', to: '', subject: '', body: '', lat: '', lng: '',
})
const opt = reactive({ ec: 'M', size: 512, margin: 4, dark: '#0b1220', light: '#ffffff' })
const logoFile = ref(null)
const logoData = ref(null) // { image, dataUrl }
const previewEl = ref(null)
const lastCanvas = ref(null)
const state = ref('idle')
const message = ref(null)
const busy = ref(false)

// Logo / 批量文件选择器：用显式 ref（不依赖模板里的 $refs，行为更可预期）
const logoInput = ref(null)
const batchInput = ref(null)
function pickLogo() { logoInput.value && logoInput.value.click() }
function pickBatch() { batchInput.value && batchInput.value.click() }

// 支持首页深链接 /qr-code?tab=decode|batch：同一路由切换 query 时组件会被复用，故需监听
watch(() => route.query.tab, (v) => {
  if (v === 'make' || v === 'decode' || v === 'batch') tab.value = v
})

const fields = computed(() => TYPE_SCHEMA[type.value] || [])
const maxChars = computed(() => QR_MAX_CHARS[opt.ec] || QR_MAX_CHARS.M)
const payload = computed(() => {
  try { return buildPayload(type.value, form) } catch (e) { return '' }
})
const payloadLen = computed(() => payload.value.length)
const tooLong = computed(() => payloadLen.value > maxChars.value)
const disabledPwd = computed(() => type.value === 'wifi' && form.encryption === 'nopass')

function setMessage(type_, text) { message.value = { type: type_, text } }

async function onLogo(files) {
  const f = files && files[0]
  if (!f) return
  try {
    logoData.value = await loadLogoImage(f)
    logoFile.value = f.name
    setMessage('info', 'Logo 已加载；为保证能扫，纠错级别会自动提到 H')
  } catch (e) {
    logoData.value = null
    logoFile.value = null
    setMessage('err', 'Logo 读取失败：' + e.message)
  }
}
function clearLogo() {
  logoData.value = null
  logoFile.value = null
}

async function render() {
  const text = payload.value
  if (!text) {
    lastCanvas.value = null
    if (previewEl.value) previewEl.value.innerHTML = ''
    state.value = 'idle'
    return
  }
  if (tooLong.value) {
    state.value = 'error'
    lastCanvas.value = null
    if (previewEl.value) previewEl.value.innerHTML = ''
    return
  }
  const opts = {
    ec: opt.ec, size: opt.size, margin: opt.margin, dark: opt.dark, light: opt.light,
    logo: logoData.value ? { image: logoData.value.image, ratio: 0.2 } : null,
  }
  try {
    const { canvas } = await renderQrCanvas(text, opts)
    canvas.style.width = '100%'
    canvas.style.height = 'auto'
    canvas.style.borderRadius = '12px'
    lastCanvas.value = canvas
    await nextTick()
    if (previewEl.value) {
      previewEl.value.innerHTML = ''
      previewEl.value.appendChild(canvas)
    }
    state.value = 'done'
  } catch (e) {
    state.value = 'error'
    setMessage('err', '生成失败：' + e.message)
  }
}

let timer = null
watch([type, form, opt, logoData], () => {
  clearTimeout(timer)
  timer = setTimeout(render, 180)
}, { deep: true, immediate: true })

async function downloadPng() {
  if (!lastCanvas.value) return
  try {
    const blob = await canvasToBlob(lastCanvas.value, 'image/png')
    downloadBlob(blob, `qrcode-${Date.now()}.png`)
    pushToast('ok', 'PNG 已下载')
  } catch (e) {
    setMessage('err', '导出 PNG 失败：' + e.message)
  }
}
async function downloadSvg() {
  if (!payload.value) return
  try {
    const svg = await renderQrSvg(payload.value, {
      ec: opt.ec, margin: opt.margin, dark: opt.dark, light: opt.light,
      logo: logoData.value ? { image: logoData.value.image, dataUrl: logoData.value.dataUrl, ratio: 0.2 } : null,
    })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `qrcode-${Date.now()}.svg`)
    pushToast('ok', 'SVG 已下载（矢量）')
  } catch (e) {
    setMessage('err', '导出 SVG 失败：' + e.message)
  }
}
async function copyPayload() {
  if (!payload.value) return
  try {
    await navigator.clipboard.writeText(payload.value)
    setMessage('ok', '二维码内容已复制到剪贴板。')
  } catch {
    setMessage('err', '浏览器拒绝了剪贴板权限，请手动复制上方内容。')
  }
}

/* ---------------- 识别：图片 ---------------- */
const decState = ref('idle')
const decResult = ref(null) // { hits:[{text,format}], engine, file, size }
const decBusy = ref(false)

async function onDecodeFiles(files) {
  const file = files && files[0]
  if (!file) return
  decBusy.value = true
  decState.value = 'working'
  decResult.value = null
  try {
    const res = await detectFromFile(file)
    if (!res.hits.length) {
      decState.value = 'idle'
      decResult.value = { hits: [], engine: res.engine, file, width: res.width, height: res.height }
      setMessage('err', '没识别到二维码。试试把图片放大摆正、提高亮度再传一次。')
      return
    }
    decState.value = 'done'
    decResult.value = { ...res, file }
    setMessage('ok', `识别成功（${res.hits.length} 个）· 引擎：${res.engine}。内容未上传任何服务器。`)
  } catch (e) {
    decState.value = 'error'
    setMessage('err', '识别失败：' + e.message)
  } finally {
    decBusy.value = false
  }
}

function describe(hit) {
  return describeText(hit.text)
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); setMessage('ok', '内容已复制。') }
  catch { setMessage('err', '复制失败，请手动选择复制。') }
}
function openLink(hit) {
  const d = describe(hit)
  if (d.kind === 'url') { window.open(hit.text, '_blank', 'noopener'); return }
  if (d.kind === 'geo') { window.open('https://www.openstreetmap.org/?mlat=PLACE'.replace('PLACE', hit.text.slice(4)), '_blank', 'noopener'); return }
  window.open(hit.text, '_blank', 'noopener')
}
function downloadVcf(hit) {
  downloadBlob(new Blob([hit.text], { type: 'text/vcard;charset=utf-8' }), 'contact.vcf')
  setMessage('ok', '名片已下载（.vcf，双击可导入通讯录）。')
}
function toGenerate(hit) {
  tab.value = 'make'
  type.value = 'text'
  form.text = hit.text
  setMessage('info', '已带入到「生成」标签页，可重新排版后导出。')
}

// 跨工具工作流：把识别出的文本送到文本工具箱
function sendTextTo(hit) {
  stashText(hit.text, '/qr-code')
  router.push('/text')
}

/* ---------------- 识别：摄像头 ---------------- */
const videoEl = ref(null)
const camOn = ref(false)
const camShadow = ref(false)
const camState = ref('idle')
const camResult = ref(null)
const camError = ref(null)
let stream = null
let loopTimer = null
let lastHit = ''

async function startCamera() {
  camError.value = null
  camResult.value = null
  camState.value = 'working'
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头调用；请改用「图片识别」，并确保是 https 或 localhost 访问')
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    camOn.value = true
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
    }
    lastHit = ''
    loopTimer = setInterval(scanTick, 250)
  } catch (e) {
    camState.value = 'error'
    camError.value =
      e && e.name === 'NotAllowedError'
        ? '摄像头权限被拒绝。请点击地址栏的摄像头图标允许授权后重试。'
        : '无法打开摄像头：' + (e && e.message ? e.message : e)
  }
}
async function scanTick() {
  if (!camOn.value || camState.value !== 'working' || !videoEl.value) return
  if (!videoEl.value.videoWidth) return
  try {
    const frame = grabFrame(videoEl.value, 1024)
    const res = await detectFromCanvas(frame)
    if (res.hits.length) {
      const text = res.hits[0].text
      camResult.value = { text, format: res.hits[0].format, engine: res.engine }
      camState.value = 'done'
      stopCamera()
      // 去重：重复出现在短时间内直接略过（同一张码往往会连续命中多帧）
      if (text === lastHit) return
      lastHit = text
      setMessage('ok', '扫码成功！内容已显示在下方。')
    }
  } catch {
    // 单帧失败不影响扫码循环（常见：帧未就绪）
  }
}
function stopCamera() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null }
  camOn.value = false
  if (camState.value === 'working') camState.value = 'idle'
}
onUnmounted(stopCamera)

/* ---------------- 批量 ---------------- */
const batchText = ref('')
const batchBusy = ref(false)
const batchState = ref('idle')
const batchCount = ref(0)

async function onBatchFiles(fs) {
  const f = fs && fs[0]
  if (!f) return
  batchText.value = await f.text()
  setMessage('info', `已导入 ${basename(f.name)}，每行生成一个二维码。`)
}
async function runBatch() {
  const lines = batchText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (!lines.length) { setMessage('err', '请先输入内容（每行一个二维码）。'); return }
  batchBusy.value = true
  batchState.value = 'working'
  batchCount.value = 0
  try {
    const items = await buildBatch(lines, {
      ec: opt.ec, size: opt.size, margin: opt.margin, dark: opt.dark, light: opt.light,
      logo: logoData.value ? { image: logoData.value.image, ratio: 0.2 } : null,
    })
    if (!items.length) throw new Error('没有有效行可生成')
    const files = items.map((it) => new File([it.blob], it.name, { type: 'image/png' }))
    const zip = await createZip(files, { level: 6 })
    batchCount.value = files.length
    downloadBlob(zip, `qrcodes-${files.length}-${Date.now()}.zip`)
    batchState.value = 'done'
    setMessage('ok', `已生成 ${files.length} 个二维码并打包下载（${formatSize(zip.size)}）。`)
  } catch (e) {
    batchState.value = 'error'
    setMessage('err', '批量生成失败：' + e.message)
  } finally {
    batchBusy.value = false
  }
}

onMounted(() => {
  // 首次生成由 watch immediate 触发，这里只做环境提示
  if (!supportsNativeDetector()) {
    // 无原生识别器不影响功能（回退 wasm），无需打扰用户
  }
  // 跨工具工作流：接收文本（→ 生成二维码）或文件（→ 识别二维码）
  const pf = consumePending()
  if (pf && pf.files.length) {
    tab.value = 'decode'
    onDecodeFiles(pf.files)
    pushToast('info', `已从「${pf.from}」载入文件用于识别`)
    return
  }
  const pt = consumePendingText()
  if (pt) {
    type.value = 'text'
    form.text = pt.text
    tab.value = 'make'
    pushToast('info', `已从「${pt.from}」载入文本并生成二维码`)
  }
})
</script>

<template>
  <h1 class="page-title">二维码工具箱</h1>
  <p class="page-sub">
    生成 / 识别二维码，全部在你的浏览器里完成。支持网址、WiFi、名片、邮件、短信、电话、定位等格式；
    识别由 ZXing-C++ 的 WASM 内核驱动（优先使用浏览器原生加速），<b>文件与画面从不上传</b>。
  </p>

  <HelpTip title="这页能做什么？怎么用？" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>生成</b>：选一个内容类型（如 WiFi），填好表单，右侧即时出图，下载 PNG 或 SVG。</li>
      <li><b>识别</b>：拖入一张含二维码的图片，或直接用摄像头对着屏幕/二维码扫。</li>
      <li><b>批量</b>：粘贴多行文本，一次生成几十个二维码并自动打包成 ZIP。</li>
    </ol>
    <p style="margin:8px 0 0">
      小提示：加 Logo 会自动把纠错级别提到 <b>H</b>（可恢复约 30% 遮挡），不影响扫码；
      颜色请保持<b>深底浅图上原则</b>——前景比背景暗得多才扫得出。
    </p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'make' }" @click="tab = 'make'"><i class="bi bi-qr-code"></i> 生成二维码</button>
    <button :class="{ active: tab === 'decode' }" @click="tab = 'decode'"><i class="bi bi-upc-scan"></i> 识别二维码</button>
    <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'"><i class="bi bi-collection"></i> 批量生成</button>
  </div>

  <!-- ================= 生成 ================= -->
  <div v-if="tab === 'make'" class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-input-cursor-text"></i> 第一步：选择内容类型</h3>
      <div class="type-grid">
        <button
          v-for="t in QR_TYPES" :key="t.id"
          class="type-card" :class="{ active: type === t.id }"
          @click="type = t.id"
        >
          <i class="bi" :class="t.icon"></i>
          <span>{{ t.label }}</span>
        </button>
      </div>
      <p class="hint">{{ (QR_TYPES.find((x) => x.id === type) || {}).desc }}</p>

      <h3 class="sec-title"><i class="bi bi-pencil-square"></i> 第二步：填写内容</h3>
      <div class="form-grid">
        <template v-for="f in fields" :key="f.key">
          <div class="field" :class="{ 'full': f.type === 'textarea' }">
            <label>
              {{ f.label }}
              <span v-if="f.key === 'password' && disabledPwd" class="tip-inline">已选开放网络，无需密码</span>
            </label>
            <textarea
              v-if="f.type === 'textarea'" rows="3" v-model="form[f.key]" :placeholder="f.ph"
              :disabled="f.key === 'password' && disabledPwd"
            ></textarea>
            <select v-else-if="f.type === 'select'" v-model="form[f.key]">
              <option v-for="o in f.options" :key="o[0]" :value="o[0]">{{ o[1] }}</option>
            </select>
            <label v-else-if="f.type === 'checkbox'" class="check">
              <input type="checkbox" v-model="form[f.key]" /> {{ f.label }}
            </label>
            <input
              v-else :type="f.type" v-model="form[f.key]" :placeholder="f.ph"
              :disabled="f.key === 'password' && disabledPwd"
            />
          </div>
        </template>
      </div>

      <div class="status">
        二维码内容（{{ payloadLen }} 字符，上限约 {{ maxChars }}）：
        <code class="payload-box">{{ payload || '（尚未填写内容）' }}</code>
      </div>
      <p v-if="tooLong" class="msg err">
        内容超出当前纠错级别的容量。请缩短内容，或把「纠错级别」调低（如 M → L）。
      </p>

      <details class="opts">
        <summary><i class="bi bi-sliders"></i> 外观与高级选项</summary>
        <div class="row wrap" style="margin-top:12px">
          <div class="field">
            <label>纠错级别</label>
            <select v-model="opt.ec">
              <option value="L">L 低（容量最大）</option>
              <option value="M">M 中（默认推荐）</option>
              <option value="Q">Q 较高</option>
              <option value="H">H 最高（可挡 30%）</option>
            </select>
          </div>
          <div class="field">
            <label>输出尺寸 {{ opt.size }}px</label>
            <input type="range" min="128" max="1024" step="64" v-model.number="opt.size" style="width:150px" />
          </div>
          <div class="field">
            <label>留白 {{ opt.margin }} 格</label>
            <input type="range" min="0" max="8" step="1" v-model.number="opt.margin" style="width:120px" />
          </div>
          <div class="field">
            <label>前景色</label>
            <input type="color" v-model="opt.dark" />
          </div>
          <div class="field">
            <label>背景色</label>
            <input type="color" v-model="opt.light" />
          </div>
        </div>
        <div class="row wrap">
          <div class="field">
            <label>中心 Logo（可选）</label>
            <button class="btn ghost" @click="pickLogo">
              <i class="bi bi-image"></i> {{ logoFile ? '更换 Logo' : '选择 Logo' }}
            </button>
            <input ref="logoInput" type="file" accept="image/*" hidden @change="onLogo($event.target.files)" />
          </div>
          <div v-if="logoFile" class="field">
            <label>&nbsp;</label>
            <span class="tag"><i class="bi bi-paperclip"></i> {{ logoFile }}</span>
            <button class="btn ghost" style="margin-left:8px" @click="clearLogo"><i class="bi bi-x"></i> 移除</button>
          </div>
        </div>
        <p class="hint">Logo 建议小于画面 20%（自动裁到适当比例）；上传后纠错会自动提到 H，保证仍可扫码。</p>
      </details>
    </div>

    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-eye"></i> 实时预览</h3>
        <StatusPill :state="state" :label="state === 'done' ? '已生成' : state === 'error' ? '无法生成' : '待填充'" />
      </div>
      <div ref="previewEl" class="qr-preview"></div>
      <p v-if="!payload && state !== 'done'" class="hint" style="text-align:center">填写左侧内容后，二维码会立即出现在这里。</p>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn green" :disabled="!lastCanvas" @click="downloadPng">
          <i class="bi bi-download"></i> 下载 PNG
        </button>
        <button class="btn" :disabled="!payload" @click="downloadSvg">
          <i class="bi bi-file-earmark-code"></i> 下载 SVG
        </button>
        <button class="btn ghost" :disabled="!payload" @click="copyPayload">
          <i class="bi bi-clipboard"></i> 复制内容
        </button>
      </div>
      <p class="hint">
        <b>PNG</b> 适合屏幕与社群分享；<b>SVG</b> 适合印刷与海报（放大不糊）。两者都在本地生成，没有任何上传。
      </p>
    </div>
  </div>

  <!-- ================= 识别 ================= -->
  <div v-else-if="tab === 'decode'" class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-image"></i> 方式一：识别图片中的二维码</h3>
      <StepBar :steps="[
        { label: '选择图片', state: decResult ? 'done' : 'active' },
        { label: '本地识别', state: decState === 'working' ? 'active' : decResult && decResult.hits.length ? 'done' : 'todo' },
        { label: '查看结果', state: decResult && decResult.hits.length ? 'done' : 'todo' },
      ]" />
      <DropZone
        :multiple="false" accept="image/*" single="图片"
        hint="把含二维码的图片拖到这里"
        formats="PNG / JPG / WEBP / GIF / AVIF 等浏览器可解开的图片"
        @files="onDecodeFiles"
      />
      <p v-if="decBusy" class="hint"><i class="bi bi-arrow-repeat spin-inline"></i> 正在本地识别，请稍候……</p>
      <p v-if="decResult && !decResult.hits.length" class="hint">
        图片尺寸 {{ decResult.width }}×{{ decResult.height }} 已读取，但没有找到二维码。
      </p>

      <hr class="split" />

      <h3 class="sec-title"><i class="bi bi-camera"></i> 方式二：摄像头扫码</h3>
      <StepBar :steps="[
        { label: '允许摄像头', state: camOn ? 'done' : camState === 'error' ? 'error' : 'active' },
        { label: '对准二维码', state: camOn ? 'active' : 'todo' },
        { label: '自动识别', state: camState === 'done' ? 'done' : 'todo' },
      ]" />
      <div class="row wrap">
        <button v-if="!camOn" class="btn" :disabled="decBusy" @click="startCamera">
          <i class="bi bi-camera-video"></i> 打开摄像头
        </button>
        <button v-else class="btn ghost" @click="stopCamera"><i class="bi bi-stop-circle"></i> 停止</button>
        <span v-if="camOn" class="tag live"><i class="bi bi-broadcast"></i> 正在扫描……</span>
      </div>
      <div v-if="camError" class="msg err">{{ camError }}</div>
      <video v-show="camOn" ref="videoEl" class="cam" playsinline muted></video>
      <p v-if="!camOn" class="hint">
        摄像头仅在本地用于取帧分析，画面不会离开设备、也不会被录制保存。需要 https 或 localhost 环境。
      </p>
      <div v-if="camResult" class="msg ok">扫码成功：{{ camResult.text }}</div>
    </div>

    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-card-checklist"></i> 识别结果</h3>
        <StatusPill :state="decState" :label="decState === 'done' ? '识别完成' : decState === 'working' ? '识别中' : '等待图片'" />
      </div>

      <div v-if="!decResult" class="hint">还没有结果。左边选一张图片或直接扫码，结果会显示在这里并解释含义。</div>

      <div v-else-if="!decResult.hits.length" class="hint">
        未识别到二维码。常见原因：图片太小/倾斜/反光，或二维码本身带特效（艺术码需原始码）。
      </div>

      <template v-else>
        <div v-for="(hit, i) in decResult.hits" :key="i" class="hit">
        <div class="hit-head">
          <span class="tag"><i class="bi bi-upc"></i> {{ hit.format || 'QRCode' }}</span>
          <span class="tag">{{ describe(hit).label }}</span>
        </div>
        <div v-for="f in describe(hit).fields" :key="f.k" class="hit-field">
          <span class="k">{{ f.k }}</span>
          <span class="v">{{ f.v }}</span>
        </div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn ghost" @click="copyText(hit.text)"><i class="bi bi-clipboard"></i> 复制原文</button>
          <button v-if="describe(hit).actions.some((a) => a.id === 'open')" class="btn ghost" @click="openLink(hit)">
            <i class="bi" :class="describe(hit).actions.find((a) => a.id === 'open').icon"></i>
            {{ describe(hit).actions.find((a) => a.id === 'open').label }}
          </button>
          <button v-if="describe(hit).kind === 'vcard'" class="btn ghost" @click="downloadVcf(hit)">
            <i class="bi bi-person-plus"></i> 下载 .vcf 名片
          </button>
          <button class="btn ghost" @click="toGenerate(hit)"><i class="bi bi-qr-code"></i> 重新生成一个</button>
          <button class="btn ghost" @click="sendTextTo(hit)"><i class="bi bi-code-slash"></i> 送去文本工具</button>
        </div>
        <details class="raw">
          <summary>查看原始内容</summary>
          <pre>{{ hit.text }}</pre>
        </details>
        </div>
      </template>

      <p v-if="decResult" class="hint">
        本次引擎：{{ decResult.engine }}。全过程在你的浏览器完成，图片没有上传任何服务器。
      </p>
    </div>
  </div>

  <!-- ================= 批量 ================= -->
  <div v-else class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-body-text"></i> 输入多行内容</h3>
      <p class="hint">每行生成一个二维码；空行会被自动跳过。适合批量做桌牌、商品标签、会议室贴纸。</p>
      <textarea v-model="batchText" rows="10" placeholder="https://example.com/a&#10;https://example.com/b&#10;会议室-301&#10;会议室-302"></textarea>
      <div class="row wrap" style="margin-top:10px">
        <button class="btn green" :disabled="batchBusy || !batchText.trim()" @click="runBatch">
          <i class="bi bi-lightning-charge"></i> {{ batchBusy ? '正在生成……' : '生成并打包 ZIP' }}
        </button>
        <button class="btn ghost" @click="pickBatch"><i class="bi bi-file-earmark-text"></i> 导入 TXT</button>
        <input ref="batchInput" type="file" accept=".txt,.csv,text/plain" hidden @change="onBatchFiles($event.target.files)" />
      </div>
      <div v-if="batchText.trim()" class="status">
        共 <b style="color:var(--txt)">{{ batchText.split(/\r?\n/).filter((s) => s.trim()).length }}</b> 行待生成（沿用「生成」页的尺寸/颜色/Logo 设置）。
      </div>
    </div>
    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-box-seam"></i> 输出</h3>
        <StatusPill :state="batchState" :label="batchState === 'done' ? `已生成 ${batchCount} 个` : batchState === 'working' ? '生成中' : '待开始'" />
      </div>
      <HelpTip title="批量怎么用最省事？" icon="bi-lightbulb" tone="tip">
        <ol class="howto">
          <li>左侧每行一条内容（网址、编号、WiFi 名都行）。</li>
          <li>把二维码样式（尺寸/颜色/Logo）在「生成」页调好，这里会沿用。</li>
          <li>点生成 → 下载一个 ZIP，里面是 <code>001-xxx.png</code> 这样按序编号的图片。</li>
        </ol>
      </HelpTip>
      <p class="hint">ZIP 由本项目自带的 zip.js 在浏览器本地打包，同样零上传。</p>
    </div>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.qr-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 900px) {
  .qr-grid { grid-template-columns: 1fr; }
}
.sec-title {
  margin: 14px 0 10px;
  font-size: 14px;
  color: var(--txt, #e6ebf2);
  display: flex;
  align-items: center;
  gap: 7px;
}
.sec-title i { color: var(--accent, #38bdf8); }
.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px;
  border-radius: 12px;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--panel-2, rgba(28,37,60,.55));
  color: var(--muted, #93a2bd);
  cursor: pointer;
  transition: .15s;
  font-size: 12.5px;
}
.type-card i { font-size: 20px; }
.type-card:hover { border-color: rgba(232,149,74,.45); color: var(--txt, #e6ebf2); }
.type-card.active {
  color: var(--accent, #38bdf8);
  border-color: var(--accent, #38bdf8);
  background: rgba(232,149,74,.1);
  box-shadow: 0 0 14px rgba(232,149,74,.22);
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.form-grid .full { grid-column: 1 / -1; }
.tip-inline { color: var(--muted, #93a2bd); font-size: 11.5px; font-weight: 400; }
.payload-box {
  display: block;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(120,150,200,.1);
  font-family: var(--mono, monospace);
  font-size: 12px;
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 92px;
  overflow: auto;
  color: var(--txt, #e6ebf2);
}
.opts summary {
  cursor: pointer;
  color: var(--accent, #38bdf8);
  font-size: 13.5px;
  padding: 6px 0;
}
.opts summary i { margin-right: 6px; }
.qr-side { position: sticky; top: 12px; }
.qr-preview {
  margin-top: 12px;
  padding: 12px;
  border-radius: 14px;
  background: #ffffff;
  min-height: 160px;
  display: grid;
  place-items: center;
}
.qr-preview :deep(canvas) { display: block; }
.cam {
  width: 100%;
  margin-top: 12px;
  border-radius: 12px;
  background: #000;
  border: 1px solid var(--line, rgba(120,150,200,.16));
}
.tag.live { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.45); }
.spin-inline { display: inline-block; animation: sp2 .9s linear infinite; }
@keyframes sp2 { to { transform: rotate(360deg); } }
.split { border: none; border-top: 1px solid var(--line, rgba(120,150,200,.16)); margin: 18px 0; }
.hit {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--panel-2, rgba(28,37,60,.5));
}
.hit-head { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.hit-field {
  display: flex;
  gap: 10px;
  font-size: 13px;
  padding: 3px 0;
  border-bottom: 1px dashed rgba(120,150,200,.12);
}
.hit-field .k { flex: none; width: 84px; color: var(--muted, #93a2bd); }
.hit-field .v { color: var(--txt, #e6ebf2); word-break: break-all; }
.raw summary { cursor: pointer; font-size: 12.5px; color: var(--muted, #93a2bd); margin-top: 8px; }
.raw pre {
  margin: 6px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(120,150,200,.1);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
  color: var(--txt, #e6ebf2);
}
textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--mono, monospace);
  font-size: 13px;
}
</style>
