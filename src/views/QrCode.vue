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
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const router = useRouter()

/* ---------------- 生成 ---------------- */
const TYPE_SCHEMA = computed(() => ({  text: [{ key: 'text', label: T('ui.qr.formContent'), type: 'textarea', ph: T('ui.qr.phContent') }],
  url: [{ key: 'url', label: T('ui.qr.formUrl'), type: 'text', ph: 'example.com' }],
  wifi: [
    { key: 'ssid', label: T('ui.qr.formSsid'), type: 'text', ph: 'My-WiFi' },
    { key: 'password', label: T('ui.qr.formPassword'), type: 'password', ph: T('ui.qr.phPassword') },
    { key: 'encryption', label: T('ui.qr.formEncryption'), type: 'select', options: [['WPA', T('ui.qr.encWpa')], ['WEP', T('ui.qr.encWep')], ['nopass', T('ui.qr.encOpen')]] },
    { key: 'hidden', label: T('ui.qr.formHidden'), type: 'checkbox' },
  ],
  vcard: [
    { key: 'name', label: T('ui.qr.formName'), type: 'text', ph: '张三' },
    { key: 'tel', label: T('ui.qr.formTel'), type: 'text', ph: '13800000000' },
    { key: 'org', label: T('ui.qr.formOrg'), type: 'text', ph: T('ui.qr.phOptional') },
    { key: 'title', label: T('ui.qr.formTitle'), type: 'text', ph: T('ui.qr.phOptional') },
    { key: 'email', label: T('ui.qr.formEmail'), type: 'text', ph: T('ui.qr.phOptional') },
    { key: 'url', label: T('ui.qr.formUrl'), type: 'text', ph: T('ui.qr.phOptional') },
    { key: 'addr', label: T('ui.qr.formAddr'), type: 'text', ph: T('ui.qr.phOptional') },
  ],
  email: [
    { key: 'to', label: T('ui.qr.formTo'), type: 'text', ph: 'someone@example.com' },
    { key: 'subject', label: T('ui.qr.formSubject'), type: 'text', ph: T('ui.qr.phOptional') },
    { key: 'body', label: T('ui.qr.formBody'), type: 'textarea', ph: T('ui.qr.phOptional') },
  ],
  phone: [{ key: 'tel', label: T('ui.qr.formPhone'), type: 'text', ph: '13800000000' }],
  sms: [
    { key: 'tel', label: T('ui.qr.formSmsTel'), type: 'text', ph: '13800000000' },
    { key: 'body', label: T('ui.qr.formSmsBody'), type: 'textarea', ph: T('ui.qr.phOptional') },
  ],
  geo: [
    { key: 'lat', label: T('ui.qr.formLat'), type: 'text', ph: '39.9042' },
    { key: 'lng', label: T('ui.qr.formLng'), type: 'text', ph: '116.4074' },
  ],
}))

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

// 引擎类型/识别结果是中文数据，UI 展示层按当前语言映射（响应式）
const qrTypes = computed(() => QR_TYPES.map((t) => ({
  ...t,
  label: T(`ui.qrType.${t.id}.label`),
  desc: T(`ui.qrType.${t.id}.desc`),
})))
const currentTypeDesc = computed(() => (qrTypes.value.find((x) => x.id === type.value) || {}).desc || '')

// describeText 返回的字段/动作标签是中文，映射成 i18n key
const DESC_KEYMAP = {
  'WiFi 网络':'wifiNet', '联系人名片':'contactCard', '网页链接':'webLink', '邮件':'mail',
  '电话号码':'phoneNum', '短信':'sms', '地理位置':'geo', '文本内容':'textContent',
  '名称 SSID':'wifiSsid', '密码':'wifiPwd', '加密方式':'wifiEnc', '隐藏网络':'wifiHidden',
  '姓名':'vcardName', '公司':'vcardOrg', '职位':'vcardTitle', '电话':'vcardTel',
  '邮箱':'vcardEmail', '网址':'vcardUrl', '地址':'addr', '收件人':'recipient',
  '主题':'subject', '正文':'body', '号码':'number', '内容':'content',
  '纬度':'lat', '经度':'lng',
  '（无）':'none', '是':'yes', '否':'no', '开放网络（无密码）':'openNet',
  '下载 .vcf 名片':'dlVcf', '打开链接':'openLink', '拨号':'dial', '在地图上查看':'viewMap',
}
const dt = (zh) => DESC_KEYMAP[zh] ? T(`ui.qrDesc.${DESC_KEYMAP[zh]}`) : zh
function localizeDescribe(hit) {
  const d = describeText(hit.text)
  return {
    ...d,
    label: dt(d.label),
    fields: d.fields.map((f) => ({ ...f, k: dt(f.k), v: dt(f.v) })),
    actions: d.actions.map((a) => ({ ...a, label: dt(a.label) })),
  }
}

const fields = computed(() => TYPE_SCHEMA.value[type.value] || [])
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
    setMessage('info', T('ui.qr.logoLoaded'))
  } catch (e) {
    logoData.value = null
    logoFile.value = null
    setMessage('err', T('ui.qr.logoFail', { msg: e.message }))
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
    setMessage('err', T('ui.qr.genFail', { msg: e.message }))
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
    pushToast('ok', T('ui.qr.pngOk'))
  } catch (e) {
    setMessage('err', T('ui.qr.pngFail', { msg: e.message }))
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
    pushToast('ok', T('ui.qr.svgOk'))
  } catch (e) {
    setMessage('err', T('ui.qr.svgFail', { msg: e.message }))
  }
}
async function copyPayload() {
  if (!payload.value) return
  try {
    await navigator.clipboard.writeText(payload.value)
    setMessage('ok', T('ui.qr.copyPayloadOk'))
  } catch {
    setMessage('err', T('ui.qr.copyPayloadFail'))
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
      setMessage('err', T('ui.qr.decNoHitMsg'))
      return
    }
    decState.value = 'done'
    decResult.value = { ...res, file }
    setMessage('ok', T('ui.qr.decOkMsg', { n: res.hits.length, engine: res.engine }))
  } catch (e) {
    decState.value = 'error'
    setMessage('err', T('ui.qr.decFail', { msg: e.message }))
  } finally {
    decBusy.value = false
  }
}

function describe(hit) {
  return describeText(hit.text)
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); setMessage('ok', T('ui.qr.copyOk')) }
  catch { setMessage('err', T('ui.qr.copyFail')) }
}
function openLink(hit) {
  const d = describe(hit)
  if (d.kind === 'url') { window.open(hit.text, '_blank', 'noopener'); return }
  if (d.kind === 'geo') { window.open('https://www.openstreetmap.org/?mlat=PLACE'.replace('PLACE', hit.text.slice(4)), '_blank', 'noopener'); return }
  window.open(hit.text, '_blank', 'noopener')
}
function downloadVcf(hit) {
  downloadBlob(new Blob([hit.text], { type: 'text/vcard;charset=utf-8' }), 'contact.vcf')
  setMessage('ok', T('ui.qr.vcfOk'))
}
function toGenerate(hit) {
  tab.value = 'make'
  type.value = 'text'
  form.text = hit.text
  setMessage('info', T('ui.qr.toGenerate'))
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
      throw new Error(T('ui.qr.camUnsupported'))
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
        ? T('ui.qr.camDenied')
        : T('ui.qr.camFail', { msg: e && e.message ? e.message : e })
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
      setMessage('ok', T('ui.qr.scanOk'))
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
  setMessage('info', T('ui.qr.batchImported', { name: basename(f.name) }))
}
async function runBatch() {
  const lines = batchText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (!lines.length) { setMessage('err', T('ui.qr.batchNoLines')); return }
  batchBusy.value = true
  batchState.value = 'working'
  batchCount.value = 0
  try {
    const items = await buildBatch(lines, {
      ec: opt.ec, size: opt.size, margin: opt.margin, dark: opt.dark, light: opt.light,
      logo: logoData.value ? { image: logoData.value.image, ratio: 0.2 } : null,
    })
    if (!items.length) throw new Error(T('ui.qr.batchNoValid'))
    const files = items.map((it) => new File([it.blob], it.name, { type: 'image/png' }))
    const zip = await createZip(files, { level: 6 })
    batchCount.value = files.length
    downloadBlob(zip, `qrcodes-${files.length}-${Date.now()}.zip`)
    batchState.value = 'done'
    setMessage('ok', T('ui.qr.batchDone', { n: files.length, size: formatSize(zip.size) }))
  } catch (e) {
    batchState.value = 'error'
    setMessage('err', T('ui.qr.batchFail', { msg: e.message }))
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
    pushToast('info', T('ui.qr.fromFiles', { from: pf.from }))
    return
  }
  const pt = consumePendingText()
  if (pt) {
    type.value = 'text'
    form.text = pt.text
    tab.value = 'make'
    pushToast('info', T('ui.qr.fromText', { from: pt.from }))
  }
})
</script>

<template>
  <h1 class="page-title">{{ T('ui.qr.pageTitle') }}</h1>
  <p class="page-sub">
    {{ T('ui.qr.sub1') }}
    {{ T('ui.qr.sub2') }}<b>{{ T('ui.qr.sub3') }}</b>
  </p>

  <HelpTip :title="T('ui.qr.helpTitle')" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>{{ T('ui.qr.stepMake') }}</b>{{ T('ui.qr.helpMake') }}</li>
      <li><b>{{ T('ui.qr.stepDecode') }}</b>{{ T('ui.qr.helpDecode') }}</li>
      <li><b>{{ T('ui.qr.stepBatch') }}</b>{{ T('ui.qr.helpBatch') }}</li>
    </ol>
    <p style="margin:8px 0 0">
      {{ T('ui.qr.tipLead') }}<b>H</b>{{ T('ui.qr.tipAfterH') }}
      {{ T('ui.qr.tipColorLead') }}<b>{{ T('ui.qr.tipRule') }}</b>{{ T('ui.qr.tipRuleAfter') }}
    </p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'make' }" @click="tab = 'make'"><i class="bi bi-qr-code"></i> {{ T('ui.qr.tabMake') }}</button>
    <button :class="{ active: tab === 'decode' }" @click="tab = 'decode'"><i class="bi bi-upc-scan"></i> {{ T('ui.qr.tabDecode') }}</button>
    <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'"><i class="bi bi-collection"></i> {{ T('ui.qr.tabBatch') }}</button>
  </div>

  <!-- ================= 生成 ================= -->
  <div v-if="tab === 'make'" class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-input-cursor-text"></i> {{ T('ui.qr.step1') }}</h3>
      <div class="type-grid">
        <button
          v-for="t in qrTypes" :key="t.id"
          class="type-card" :class="{ active: type === t.id }"
          @click="type = t.id"
        >
          <i class="bi" :class="t.icon"></i>
          <span>{{ t.label }}</span>
        </button>
      </div>
      <p class="hint">{{ currentTypeDesc }}</p>

      <h3 class="sec-title"><i class="bi bi-pencil-square"></i> {{ T('ui.qr.step2') }}</h3>
      <div class="form-grid">
        <template v-for="f in fields" :key="f.key">
          <div class="field" :class="{ 'full': f.type === 'textarea' }">
            <label>
              {{ f.label }}
              <span v-if="f.key === 'password' && disabledPwd" class="tip-inline">{{ T('ui.qr.noPwdNeeded') }}</span>
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
        {{ T('ui.qr.payloadLabel', { n: payloadLen, max: maxChars }) }}
        <code class="payload-box">{{ payload || T('ui.qr.payloadEmpty') }}</code>
      </div>
      <p v-if="tooLong" class="msg err">
        {{ T('ui.qr.tooLong') }}
      </p>

      <details class="opts">
        <summary><i class="bi bi-sliders"></i> {{ T('ui.qr.opts') }}</summary>
        <div class="row wrap" style="margin-top:12px">
          <div class="field">
            <label>{{ T('ui.qr.ecLabel') }}</label>
            <select v-model="opt.ec">
              <option value="L">{{ T('ui.qr.ecL') }}</option>
              <option value="M">{{ T('ui.qr.ecM') }}</option>
              <option value="Q">{{ T('ui.qr.ecQ') }}</option>
              <option value="H">{{ T('ui.qr.ecH') }}</option>
            </select>
          </div>
          <div class="field">
            <label>{{ T('ui.qr.optSize', { n: opt.size }) }}</label>
            <input type="range" min="128" max="1024" step="64" v-model.number="opt.size" style="width:150px" />
          </div>
          <div class="field">
            <label>{{ T('ui.qr.optMargin', { n: opt.margin }) }}</label>
            <input type="range" min="0" max="8" step="1" v-model.number="opt.margin" style="width:120px" />
          </div>
          <div class="field">
            <label>{{ T('ui.qr.darkLabel') }}</label>
            <input type="color" v-model="opt.dark" />
          </div>
          <div class="field">
            <label>{{ T('ui.qr.lightLabel') }}</label>
            <input type="color" v-model="opt.light" />
          </div>
        </div>
        <div class="row wrap">
          <div class="field">
            <label>{{ T('ui.qr.logoLabel') }}</label>
            <button class="btn ghost" @click="pickLogo">
              <i class="bi bi-image"></i> {{ logoFile ? T('ui.qr.logoChange') : T('ui.qr.logoPick') }}
            </button>
            <input ref="logoInput" type="file" accept="image/*" hidden @change="onLogo($event.target.files)" />
          </div>
          <div v-if="logoFile" class="field">
            <label>&nbsp;</label>
            <span class="tag"><i class="bi bi-paperclip"></i> {{ logoFile }}</span>
            <button class="btn ghost" style="margin-left:8px" @click="clearLogo"><i class="bi bi-x"></i> {{ T('ui.qr.remove') }}</button>
          </div>
        </div>
        <p class="hint">{{ T('ui.qr.logoHint') }}</p>
      </details>
    </div>

    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-eye"></i> {{ T('ui.qr.previewTitle') }}</h3>
        <StatusPill :state="state" :label="state === 'done' ? T('ui.qr.pillDone') : state === 'error' ? T('ui.qr.pillError') : T('ui.qr.pillIdle')" />
      </div>
      <div ref="previewEl" class="qr-preview"></div>
      <p v-if="!payload && state !== 'done'" class="hint" style="text-align:center">{{ T('ui.qr.previewEmpty') }}</p>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn green" :disabled="!lastCanvas" @click="downloadPng">
          <i class="bi bi-download"></i> {{ T('ui.qr.downloadPng') }}
        </button>
        <button class="btn" :disabled="!payload" @click="downloadSvg">
          <i class="bi bi-file-earmark-code"></i> {{ T('ui.qr.downloadSvg') }}
        </button>
        <button class="btn ghost" :disabled="!payload" @click="copyPayload">
          <i class="bi bi-clipboard"></i> {{ T('ui.qr.copyContent') }}
        </button>
      </div>
      <p class="hint">
        <b>PNG</b> {{ T('ui.qr.fmtHint1') }}<b>SVG</b>{{ T('ui.qr.fmtHint2') }}
      </p>
    </div>
  </div>

  <!-- ================= 识别 ================= -->
  <div v-else-if="tab === 'decode'" class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-image"></i> {{ T('ui.qr.decodeTitle1') }}</h3>
      <StepBar :steps="[
        { label: T('ui.qr.stepPickImg'), state: decResult ? 'done' : 'active' },
        { label: T('ui.qr.stepLocalDec'), state: decState === 'working' ? 'active' : decResult && decResult.hits.length ? 'done' : 'todo' },
        { label: T('ui.qr.stepResult'), state: decResult && decResult.hits.length ? 'done' : 'todo' },
      ]" />
      <DropZone
        :multiple="false" accept="image/*" :single="T('ui.qr.dropSingleImg')"
        :hint="T('ui.qr.dropHintImg')"
        :formats="T('ui.qr.dropFormatsImg')"
        @files="onDecodeFiles"
      />
      <p v-if="decBusy" class="hint"><i class="bi bi-arrow-repeat spin-inline"></i> {{ T('ui.qr.decWorking') }}</p>
      <p v-if="decResult && !decResult.hits.length" class="hint">
        {{ T('ui.qr.decNoHitSize', { w: decResult.width, h: decResult.height }) }}
      </p>

      <hr class="split" />

      <h3 class="sec-title"><i class="bi bi-camera"></i> {{ T('ui.qr.decodeTitle2') }}</h3>
      <StepBar :steps="[
        { label: T('ui.qr.stepCamAllow'), state: camOn ? 'done' : camState === 'error' ? 'error' : 'active' },
        { label: T('ui.qr.stepCamAim'), state: camOn ? 'active' : 'todo' },
        { label: T('ui.qr.stepCamAuto'), state: camState === 'done' ? 'done' : 'todo' },
      ]" />
      <div class="row wrap">
        <button v-if="!camOn" class="btn" :disabled="decBusy" @click="startCamera">
          <i class="bi bi-camera-video"></i> {{ T('ui.qr.openCamera') }}
        </button>
        <button v-else class="btn ghost" @click="stopCamera"><i class="bi bi-stop-circle"></i> {{ T('ui.qr.stop') }}</button>
        <span v-if="camOn" class="tag live"><i class="bi bi-broadcast"></i> {{ T('ui.qr.scanning') }}</span>
      </div>
      <div v-if="camError" class="msg err">{{ camError }}</div>
      <video v-show="camOn" ref="videoEl" class="cam" playsinline muted></video>
      <p v-if="!camOn" class="hint">
        {{ T('ui.qr.camHint') }}
      </p>
      <div v-if="camResult" class="msg ok">{{ T('ui.qr.scanOkPrefix', { text: camResult.text }) }}</div>
    </div>

    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-card-checklist"></i> {{ T('ui.qr.resultTitle') }}</h3>
        <StatusPill :state="decState" :label="decState === 'done' ? T('ui.qr.pillDecDone') : decState === 'working' ? T('ui.qr.pillDecWorking') : T('ui.qr.pillDecIdle')" />
      </div>

      <div v-if="!decResult" class="hint">{{ T('ui.qr.resultEmpty') }}</div>

      <div v-else-if="!decResult.hits.length" class="hint">
        {{ T('ui.qr.resultNoHit') }}
      </div>

      <template v-else>
        <div v-for="(hit, i) in decResult.hits" :key="i" class="hit">
        <div class="hit-head">
          <span class="tag"><i class="bi bi-upc"></i> {{ hit.format || 'QRCode' }}</span>
          <span class="tag">{{ localizeDescribe(hit).label }}</span>
        </div>
        <div v-for="f in localizeDescribe(hit).fields" :key="f.k" class="hit-field">
          <span class="k">{{ f.k }}</span>
          <span class="v">{{ f.v }}</span>
        </div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn ghost" @click="copyText(hit.text)"><i class="bi bi-clipboard"></i> {{ T('ui.qr.copyOriginal') }}</button>
          <button v-if="localizeDescribe(hit).actions.some((a) => a.id === 'open')" class="btn ghost" @click="openLink(hit)">
            <i class="bi" :class="localizeDescribe(hit).actions.find((a) => a.id === 'open').icon"></i>
            {{ localizeDescribe(hit).actions.find((a) => a.id === 'open').label }}
          </button>
          <button v-if="localizeDescribe(hit).kind === 'vcard'" class="btn ghost" @click="downloadVcf(hit)">
            <i class="bi bi-person-plus"></i> {{ T('ui.qr.downloadVcf') }}
          </button>
          <button class="btn ghost" @click="toGenerate(hit)"><i class="bi bi-qr-code"></i> {{ T('ui.qr.regenerate') }}</button>
          <button class="btn ghost" @click="sendTextTo(hit)"><i class="bi bi-code-slash"></i> {{ T('ui.qr.sendToText') }}</button>
        </div>
        <details class="raw">
          <summary>{{ T('ui.qr.viewRaw') }}</summary>
          <pre>{{ hit.text }}</pre>
        </details>
        </div>
      </template>

      <p v-if="decResult" class="hint">
        {{ T('ui.qr.engineHint', { engine: decResult.engine }) }}
      </p>
    </div>
  </div>

  <!-- ================= 批量 ================= -->
  <div v-else class="qr-grid">
    <div class="panel">
      <h3 class="sec-title"><i class="bi bi-body-text"></i> {{ T('ui.qr.batchInputTitle') }}</h3>
      <p class="hint">{{ T('ui.qr.batchHint') }}</p>
      <textarea v-model="batchText" rows="10" :placeholder="T('ui.qr.phBatch')"></textarea>
      <div class="row wrap" style="margin-top:10px">
        <button class="btn green" :disabled="batchBusy || !batchText.trim()" @click="runBatch">
          <i class="bi bi-lightning-charge"></i> {{ batchBusy ? T('ui.qr.generating') : T('ui.qr.genZip') }}
        </button>
        <button class="btn ghost" @click="pickBatch"><i class="bi bi-file-earmark-text"></i> {{ T('ui.qr.importTxt') }}</button>
        <input ref="batchInput" type="file" accept=".txt,.csv,text/plain" hidden @change="onBatchFiles($event.target.files)" />
      </div>
      <div v-if="batchText.trim()" class="status">
        {{ T('ui.qr.batchCountPrefix') }}<b style="color:var(--txt)">{{ batchText.split(/\r?\n/).filter((s) => s.trim()).length }}</b>{{ T('ui.qr.batchCountSuffix') }}
      </div>
    </div>
    <div class="panel qr-side">
      <div class="row" style="justify-content:space-between">
        <h3 class="sec-title" style="margin:0"><i class="bi bi-box-seam"></i> {{ T('ui.qr.outputTitle') }}</h3>
        <StatusPill :state="batchState" :label="batchState === 'done' ? T('ui.qr.pillBatchDone', { n: batchCount }) : batchState === 'working' ? T('ui.qr.pillBatchWorking') : T('ui.qr.pillBatchIdle')" />
      </div>
      <HelpTip :title="T('ui.qr.batchHelpTitle')" icon="bi-lightbulb" tone="tip">
        <ol class="howto">
          <li>{{ T('ui.qr.batchHelp1') }}</li>
          <li>{{ T('ui.qr.batchHelp2') }}</li>
          <li>{{ T('ui.qr.batchHelp3') }}<code>001-xxx.png</code>{{ T('ui.qr.batchHelp3b') }}</li>
        </ol>
      </HelpTip>
      <p class="hint">{{ T('ui.qr.zipHint') }}</p>
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
