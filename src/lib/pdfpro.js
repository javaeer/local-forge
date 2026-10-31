// PDF 进阶能力（纯前端，复用项目已装的 pdf-lib 与 pdfjs-dist，不新增依赖）。
//
// 关键取舍：pdf-lib 的 StandardFonts（Helvetica 等）不含 CJK 字形，直接 drawText 中文会抛错。
// 因此「文字水印」改为：先用 Canvas 把文字（任意语言/字体）渲染成透明底 PNG，
// 再以图片图层绘制到每页 —— 中文可用、可斜向、可调透明度，且不需要内嵌几 MB 的字体文件。

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

const A4 = [595.28, 841.89]

async function loadPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return PDFDocument.load(bytes, { ignoreEncryption: true })
}

// 非 JPG/PNG（WEBP/AVIF/GIF…）先由浏览器转 JPG，因为 pdf-lib 只认 JPG/PNG 字节
async function toEmbeddableBytes(file) {
  const isPng = /\.png$/i.test(file.name) || file.type === 'image/png'
  const isJpg = /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg'
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isPng || isJpg) return { bytes, kind: isPng ? 'png' : 'jpg' }
  const { decodeToImageData } = await import('./image.js')
  const img = await decodeToImageData(file)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.putImageData(img, 0, 0)
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('图片转换失败：' + file.name))), 'image/jpeg', 0.92),
  )
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'jpg', converted: true }
}

/* ---------------- 图片 → PDF ---------------- */
export async function imagesToPdf(files, { pageSize = 'fit', onprogress } = {}) {
  if (!files || !files.length) throw new Error('未选择图片')
  const out = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    const { bytes, kind } = await toEmbeddableBytes(files[i])
    const img = kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes)
    const page = pageSize === 'a4' ? out.addPage(A4) : out.addPage([img.width, img.height])
    const pw = page.getWidth()
    const ph = page.getHeight()
    const margin = Math.min(pw, ph) * 0.05
    const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height, 1)
    const dw = img.width * scale
    const dh = img.height * scale
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    if (onprogress) onprogress(Math.round(((i + 1) / files.length) * 100))
  }
  const saved = await out.save({ useObjectStreams: true })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: `images-${files.length}-${Date.now()}.pdf`, count: files.length }
}

/* ---------------- PDF → 图片 ---------------- */
export async function pdfToImages(file, { scale = 2, format = 'image/png', onprogress } = {}) {
  const { pdfjs, ensurePdfWorker } = await import('./pdfworker.js')
  await ensurePdfWorker()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: Number(scale) || 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('第 ' + i + ' 页导出失败'))), format, 0.92),
    )
    const ext = format === 'image/jpeg' ? 'jpg' : 'png'
    parts.push({ blob, name: `page-${String(i).padStart(3, '0')}.${ext}` })
    if (onprogress) onprogress(Math.round((i / doc.numPages) * 100))
  }
  return { parts, pages: doc.numPages }
}

/* ---------------- 水印 ---------------- */
// 用 Canvas 渲染文字为透明底 PNG（支持中文），返回可嵌入的 PNG 字节
export async function makeWatermarkPng(text, { fontSize = 48, opacity = 0.16, color = '#333333', rotate = 30 } = {}) {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `${fontSize * dpr}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.font = font
  const m = ctx.measureText(String(text || ''))
  const w = Math.max(1, Math.ceil(m.width) + 40 * dpr)
  const h = Math.ceil(fontSize * dpr * 1.6)
  canvas.width = w
  canvas.height = h
  const c2 = canvas.getContext('2d')
  c2.font = font
  c2.textAlign = 'center'
  c2.textBaseline = 'middle'
  c2.globalAlpha = Math.max(0.02, Math.min(1, Number(opacity) || 0.16))
  c2.fillStyle = color || '#333333'
  c2.translate(w / 2, h / 2)
  c2.rotate(((Number(rotate) || 0) * Math.PI) / 180)
  c2.fillText(String(text || ''), 0, 0)
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('水印渲染失败'))), 'image/png'))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h }
}

export async function watermarkPdf(file, { text, fontSize = 48, opacity = 0.16, color = '#333333', rotate = 30, mode = 'center' } = {}) {
  if (!text) throw new Error('请输入水印文字')
  const doc = await loadPdf(file)
  const wm = await makeWatermarkPng(text, { fontSize, opacity, color, rotate })
  const img = await doc.embedPng(wm.bytes)
  const pages = doc.getPages()
  for (const page of pages) {
    const pw = page.getWidth()
    const ph = page.getHeight()
    if (mode === 'tile') {
      // 平铺：3×4 阵列覆盖整页
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          const dw = pw / 3
          const dh = (dw / wm.width) * wm.height
          page.drawImage(img, { x: c * dw + (c % 2 ? -dw * 0.15 : 0), y: ph - (r + 1) * (ph / 4), width: dw, height: dh })
        }
      }
    } else {
      const dw = pw * 0.62
      const dh = (dw / wm.width) * wm.height
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    }
  }
  const saved = await doc.save({ useObjectStreams: true })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: `${file.name.replace(/\.pdf$/i, '')}-watermarked.pdf`, pages: pages.length }
}

/* ---------------- 页码 ---------------- */
export async function addPageNumbers(file, { position = 'bottom-center', start = 1, fontSize = 10, prefix = '', suffix = '' } = {}) {
  const doc = await loadPdf(file)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  pages.forEach((page, i) => {
    const pw = page.getWidth()
    const ph = page.getHeight()
    const label = `${prefix}${Number(start) + i}${suffix} / ${pages.length}`
    // 用字号估算宽度（Helvetica 数字字宽约为字号的 0.55 倍），避免依赖字体度量 API 差异
    const tw = label.length * (Number(fontSize) || 10) * 0.55
    const margin = 24
    let x = (pw - tw) / 2
    let y = margin
    if (position.startsWith('top')) y = ph - margin - (Number(fontSize) || 10)
    if (position.endsWith('left')) x = margin
    if (position.endsWith('right')) x = pw - tw - margin
    page.drawText(label, { x, y, size: Number(fontSize) || 10, font, color: rgb(0.25, 0.25, 0.25) })
  })
  const saved = await doc.save({ useObjectStreams: true })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: `${file.name.replace(/\.pdf$/i, '')}-paged.pdf`, pages: pages.length }
}

/* ---------------- 整理：旋转 / 重排 / 删除 ---------------- */
export async function organizePdf(file, { order = null, rotations = {}, remove = [] } = {}) {
  const src = await loadPdf(file)
  const total = src.getPageCount()
  const removeSet = new Set((remove || []).map(Number))
  let indices = Array.from({ length: total }, (_, i) => i).filter((i) => !removeSet.has(i))
  if (Array.isArray(order) && order.length) {
    const keep = order.filter((i) => !removeSet.has(i) && i >= 0 && i < total)
    const rest = indices.filter((i) => !keep.includes(i))
    indices = [...keep, ...rest]
  }
  if (!indices.length) throw new Error('至少要保留一页')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices)
  copied.forEach((p) => out.addPage(p))
  const pages = out.getPages()
  indices.forEach((srcIdx, i) => {
    const deg = Number(rotations[srcIdx] || 0)
    if (deg) pages[i].setRotation(degrees(deg))
  })
  const saved = await out.save({ useObjectStreams: true })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: `${file.name.replace(/\.pdf$/i, '')}-organized.pdf`, pages: indices.length, from: total }
}

/* ---------------- 提取文本 / 读取信息 ---------------- */
export async function extractPdfText(file, { onprogress } = {}) {
  const { pdfjs, ensurePdfWorker } = await import('./pdfworker.js')
  await ensurePdfWorker()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const text = tc.items.map((it) => (it.str || '')).join('')
    pages.push({ page: i, text })
    if (onprogress) onprogress(Math.round((i / doc.numPages) * 100))
  }
  const meta = await doc.getMetadata().catch(() => null)
  return {
    pages,
    text: pages.map((p) => `—— 第 ${p.page} 页 ——\n${p.text}`).join('\n\n'),
    info: meta && meta.info ? { title: meta.info.Title, author: meta.info.Author, subject: meta.info.Subject, keywords: meta.info.Keywords } : null,
  }
}

/* ---------------- 元数据 ---------------- */
export async function readPdfMeta(file) {
  const doc = await loadPdf(file)
  return {
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    subject: doc.getSubject() || '',
    keywords: doc.getKeywords() || '',
    producer: doc.getProducer() || '',
    creator: doc.getCreator() || '',
    pages: doc.getPageCount(),
  }
}

export async function writePdfMeta(file, { title, author, subject, keywords } = {}) {
  const doc = await loadPdf(file)
  if (title != null) doc.setTitle(title)
  if (author != null) doc.setAuthor(author)
  if (subject != null) doc.setSubject(subject)
  if (keywords != null) doc.setKeywords(typeof keywords === 'string' ? keywords.split(/[,，\s]+/).filter(Boolean) : keywords)
  doc.setModificationDate(new Date())
  const saved = await doc.save({ useObjectStreams: true })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: `${file.name.replace(/\.pdf$/i, '')}-meta.pdf` }
}

/* ---------------- 自检 ---------------- */
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
  const makePdfFile = async (text = 'A') => {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    await d.save()
    const bytes = await d.save()
    return new File([bytes], text + '.pdf', { type: 'application/pdf' })
  }
  const makePngFile = async (color = '#38bdf8') => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const ctx = c.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 120, 80)
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 生成失败'))), 'image/png'))
    return new File([blob], 't.png', { type: 'image/png' })
  }

  await T('img2pdf', '图片转 PDF', async () => {
    const r = await imagesToPdf([await makePngFile(), await makePngFile('#a78bfa')], { pageSize: 'a4' })
    if (r.count !== 2) throw new Error('页数不符：' + r.count)
    const doc = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))
    if (doc.getPageCount() !== 2) throw new Error('输出 PDF 页数不对')
    return `2 张图 → ${doc.getPageCount()} 页 A4`
  })
  await T('pdf2img', 'PDF 转图片', async () => {
    const r = await pdfToImages(await makePdfFile('P'), { scale: 1, format: 'image/png' })
    if (!r.parts.length) throw new Error('未渲染出任何页')
    return `${r.pages} 页 → ${r.parts.length} 张 PNG`
  })
  await T('watermark-cn', '中文水印（Canvas 图层）', async () => {
    const r = await watermarkPdf(await makePdfFile('W'), { text: '机密 · 会师镇', opacity: 0.18, rotate: 30 })
    const doc = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))
    if (doc.getPageCount() !== 1) throw new Error('输出页数不对')
    return `含中文的水印嵌入成功（${r.pages} 页）`
  })
  await T('pagenum', '添加页码', async () => {
    const two = await PDFDocument.create()
    two.addPage([200, 200])
    two.addPage([200, 200])
    const f = new File([await two.save()], 'two.pdf', { type: 'application/pdf' })
    const r = await addPageNumbers(f, { position: 'bottom-center', start: 1 })
    const doc = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))
    if (doc.getPageCount() !== 2) throw new Error('页数不对')
    return `2 页加页码成功`
  })
  await T('organize', '旋转与删除页', async () => {
    const three = await PDFDocument.create()
    three.addPage([200, 200]); three.addPage([200, 200]); three.addPage([200, 200])
    const f = new File([await three.save()], 'three.pdf', { type: 'application/pdf' })
    const r = await organizePdf(f, { rotations: { 0: 90 }, remove: [2] })
    if (r.pages !== 2 || r.from !== 3) throw new Error(`结果不符：${r.from}→${r.pages}`)
    const doc = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))
    if (doc.getPage(0).getRotation().angle !== 90) throw new Error('首页未旋转 90°')
    return `3 页 → 删 1 页剩 ${r.pages} 页，首页旋转 90°`
  })
  await T('extract-text', '提取 PDF 文本', async () => {
    // 造一个真正含文本的 PDF
    const d = await PDFDocument.create()
    const page = d.addPage([240, 120])
    const font = await d.embedFont(StandardFonts.Helvetica)
    page.drawText('Hello LocalForge', { x: 20, y: 60, size: 14, font })
    const f = new File([await d.save()], 't.pdf', { type: 'application/pdf' })
    const r = await extractPdfText(f)
    if (!r.text.includes('Hello')) throw new Error('未提取到文本：' + JSON.stringify(r.text.slice(0, 80)))
    return '提取到：' + r.text.replace(/\s+/g, ' ').slice(0, 40)
  })
  await T('meta', '元数据读写', async () => {
    const f = await makePdfFile('M')
    await writePdfMeta(f, { title: '会师镇资料', author: 'LocalForge', subject: '测试', keywords: '会宁,会师镇' })
    const m = await readPdfMeta(await makePdfFile('M'))
    const f2 = await (async () => {
      const w = await writePdfMeta(f, { title: '会师镇资料', author: 'LocalForge' })
      return new File([w.blob], 'm2.pdf', { type: 'application/pdf' })
    })()
    const m2 = await readPdfMeta(f2)
    if (m2.title !== '会师镇资料') throw new Error('标题写入失败：' + m2.title)
    if (m2.author !== 'LocalForge') throw new Error('作者写入失败：' + m2.author)
    return `原 ${m.pages} 页 → 写入后标题「${m2.title}」/ 作者「${m2.author}」`
  })

  return { module: 'PDF 进阶', items }
}
