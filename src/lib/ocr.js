// OCR 图片 / 扫描件转文字（纯前端，基于 tesseract.js v7 + Tesseract 5 LSTM 内核）。
//
// 离线策略（与项目 ffmpeg 内核一致）：
//   - worker 脚本与识别内核（wasm）随包放在 /public/tesseract，本地加载，不依赖 CDN
//   - 语言训练数据（.traineddata）体积大，首次使用时按需下载，之后由 tesseract.js
//     缓存到浏览器 IndexedDB，后续离线可用
//   - 本地内核加载失败时自动回退官方 CDN，保证功能不因打包问题而完全不可用
//
// 全部在本地完成：图片/ PDF 从不上传任何服务器。

import { createWorker } from 'tesseract.js'

// 本地打包的内核与 worker（public/tesseract/）
const LOCAL_DIR = '/tesseract'
const LOCAL_WORKER = '/tesseract/worker.min.js'
// 回退用的官方 CDN（内核 + worker）
const CDN_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0'
const CDN_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js'

// 内核选择：显式指定具体内核文件，避免 tesseract 按目录顺序盲目探测
// （目录模式下它总优先 relaxed-simd，会尝试加载未打包的内核而报 importScripts 失败）。
// 我们只打包两套：simd-lstm（现代浏览器）与 lstm（不支持 SIMD 的兜底），按能力选择。
const CORE_VARIANT = { simd: 'tesseract-core-simd-lstm.wasm.js', plain: 'tesseract-core-lstm.wasm.js' }

function hasSimd() {
  // wasm-feature-detect 的轻量替代：通过 WAT 魔数编译探测 SIMD 支持
  try {
    // v128 指令的最小 SIMD 模块（来自 wasm-feature-detect 的 simd 检测）
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    return WebAssembly.validate(bytes)
  } catch { return false }
}

function pickCorePath(baseDir) {
  const variant = hasSimd() ? CORE_VARIANT.simd : CORE_VARIANT.plain
  return `${baseDir.replace(/\/$/, '')}/${variant}`
}

// 常用语言。size 为大致首次下载量，供界面提示。
export const OCR_LANGS = [
  { id: 'eng', label: '英语', size: '约 4MB' },
  { id: 'chi_sim', label: '简体中文', size: '约 42MB' },
  { id: 'chi_sim+eng', label: '简体中文 + 英语', size: '约 46MB' },
  { id: 'chi_tra', label: '繁体中文', size: '约 43MB' },
  { id: 'jpn', label: '日语', size: '约 30MB' },
  { id: 'kor', label: '韩语', size: '约 27MB' },
  { id: 'fra', label: '法语', size: '约 8MB' },
  { id: 'deu', label: '德语', size: '约 9MB' },
  { id: 'spa', label: '西班牙语', size: '约 8MB' },
  { id: 'rus', label: '俄语', size: '约 12MB' },
]

let worker = null
let workerLangs = ''
let workerSource = ''
let progressCb = null

export function onOcrProgress(cb) {
  progressCb = cb
}

// tesseract.js 的 logger 会推送大量进度事件，这里只把有语义的阶段透出
function makeLogger(prefix) {
  return (m) => {
    if (!progressCb || !m) return
    const p = typeof m.progress === 'number' ? Math.round(m.progress * 100) : null
    const status = String(m.status || '')
    if (p === null) return
    progressCb({
      // 阶段：下载语言包 / 初始化 / 识别
      stage: /loading.*traineddata|load/i.test(status) ? 'lang' : /initializ/i.test(status) ? 'init' : 'recognize',
      status,
      percent: p,
      label: prefix ? `${prefix} · ${status}` : status,
    })
  }
}

// 获取（或按需重建）worker。切换语言时必须重建——tesseract 的语言在初始化时载入。
async function getWorker(langs) {
  // 先尝试本地内核（显式内核文件），失败再回退 CDN
  for (const src of [
    { name: 'local', workerPath: LOCAL_WORKER, corePath: pickCorePath(LOCAL_DIR) },
    { name: 'cdn', workerPath: CDN_WORKER, corePath: `${CDN_CORE}/${hasSimd() ? CORE_VARIANT.simd : CORE_VARIANT.plain}` },
  ]) {
    try {
      if (worker && workerLangs === langs && workerSource === src.name) return { worker, source: src.name }
      if (worker) {
        try { await worker.terminate() } catch { /* 终止失败不影响新建 */ }
        worker = null
      }
      const w = await createWorker(langs, 1, {
        workerPath: src.workerPath,
        corePath: src.corePath,
        logger: makeLogger(),
      })
      worker = w
      workerLangs = langs
      workerSource = src.name
      return { worker: w, source: src.name }
    } catch (e) {
      console.warn(`[ocr] 使用${src.name === 'local' ? '本地' : 'CDN'}内核初始化失败：`, e)
      if (worker) { try { await worker.terminate() } catch { /* ignore */ } worker = null }
      if (src.name === 'cdn') throw new Error('OCR 内核初始化失败（本地与 CDN 均不可用）：' + (e.message || e))
    }
  }
  throw new Error('OCR 内核初始化失败')
}

// 释放 worker（切换页面 / 长时间不用时调用，避免常驻占用内存）
export async function releaseOcr() {
  if (!worker) return
  try { await worker.terminate() } catch { /* ignore */ }
  worker = null
  workerLangs = ''
  workerSource = ''
}

export function ocrStatus() {
  return { loaded: !!worker, langs: workerLangs, source: workerSource }
}

/**
 * 识别一张图片。
 * @param {Blob|File|HTMLCanvasElement|HTMLImageElement} image
 * @param {{ lang?: string }} [opts]
 * @returns {Promise<{ text: string, confidence: number, source: string }>}
 */
export async function recognizeImage(image, { lang = 'chi_sim+eng' } = {}) {
  const { worker: w, source } = await getWorker(lang)
  const r = await w.recognize(image)
  const data = r && r.data ? r.data : {}
  return {
    text: String(data.text || '').replace(/\n{3,}/g, '\n\n').trim(),
    confidence: typeof data.confidence === 'number' ? Math.round(data.confidence) : 0,
    source,
  }
}

/**
 * 识别一个 PDF：先用 pdf.js 逐页渲染成图片，再逐页 OCR。
 * @param {File} file
 * @param {{ lang?: string, scale?: number, pages?: string, onprogress?: Function }} [opts]
 *        pages 支持 "1-3,5,8-" 这样的页码表达式，留空表示全部页。
 */
export async function recognizePdf(file, { lang = 'chi_sim+eng', scale = 2, pages = '', onprogress } = {}) {
  const { pdfjs, ensurePdfWorker } = await import('./pdfworker.js')
  await ensurePdfWorker()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const wanted = parsePages(pages, doc.numPages)
  const { worker: w, source } = await getWorker(lang)
  const results = []
  for (let n = 0; n < wanted.length; n++) {
    const p = wanted[n]
    const page = await doc.getPage(p)
    // 渲染分辨率影响识别率：太小看不清，太大浪费时间。2x 是通用折中。
    const viewport = page.getViewport({ scale: Number(scale) || 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const r = await w.recognize(canvas)
    const t = r && r.data ? r.data : {}
    results.push({
      page: p,
      text: String(t.text || '').replace(/\n{3,}/g, '\n\n').trim(),
      confidence: typeof t.confidence === 'number' ? Math.round(t.confidence) : 0,
    })
    if (onprogress) onprogress(Math.round(((n + 1) / wanted.length) * 100), p, wanted.length)
  }
  return { results, pages: wanted.length, total: doc.numPages, source }
}

// 解析页码表达式："1-3,5,8-" → [1,2,3,5,8,9,...]
export function parsePages(expr, total) {
  const s = String(expr || '').trim()
  if (!s) return Array.from({ length: total }, (_, i) => i + 1)
  const out = new Set()
  for (const part of s.split(/[,，\s]+/)) {
    if (!part) continue
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/)
    if (m) {
      const a = m[1] ? Number(m[1]) : 1
      const b = m[2] ? Number(m[2]) : total
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i)
    } else {
      const n = Number(part)
      if (Number.isFinite(n) && n >= 1 && n <= total) out.add(n)
    }
  }
  const arr = [...out].sort((x, y) => x - y)
  return arr.length ? arr : Array.from({ length: total }, (_, i) => i + 1)
}

/* ---------------- 自检 ---------------- */
// 自检会真实下载语言训练数据（英语约 4MB）。若网络不可用则标记为 skipped，不算失败。
export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  // 造一张写着 "Hello" 的图片：白底黑字，字号足够大以保证识别率
  const mkTextPng = async () => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 120
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#000000'
    ctx.font = '64px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('Hello', 20, 60)
    const blob = await new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('测试图生成失败'))), 'image/png'),
    )
    return blob
  }

  await T('kernel', 'OCR 内核初始化（本地优先）', async () => {
    const { source } = await getWorker('eng')
    return source === 'local' ? '本地内核 /tesseract' : '回退 CDN 内核'
  })

  await T('recognize', '识别合成图片（应含 Hello）', async () => {
    const blob = await mkTextPng()
    const r = await recognizeImage(blob, { lang: 'eng' })
    const hit = /hello/i.test(r.text)
    if (!hit) throw new Error(`未识别出期望文本，实际结果：${JSON.stringify(r.text.slice(0, 80))}`)
    return `置信度 ${r.confidence} · 文本 ${JSON.stringify(r.text.trim().slice(0, 40))}`
  })

  await T('pages', '页码表达式解析', async () => {
    const a = parsePages('1-3,5,8-', 10).join(',')
    const expect = '1,2,3,5,8,9,10'
    if (a !== expect) throw new Error(`解析错误：得到 ${a}，期望 ${expect}`)
    return a
  })

  return { module: 'OCR', items }
}
