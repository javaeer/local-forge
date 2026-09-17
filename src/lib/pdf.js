// PDF 处理（纯前端，基于 pdf-lib）。
// 压缩：copyPages 重建 + 对象流去重/压缩，减小体积；文本/已压缩型 PDF 降幅有限属正常。
import { PDFDocument } from 'pdf-lib'

export async function compressPdf(file, { quality = 0.7 } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, src.getPageIndices())
  pages.forEach((p) => out.addPage(p))
  const saved = await out.save({ useObjectStreams: true, objectsPerTick: 200 })
  const name = (file.name.replace(/\.pdf$/i, '') || 'doc') + '-compressed.pdf'
  return { blob: new Blob([saved], { type: 'application/pdf' }), name, inSize: bytes.length, outSize: saved.length }
}

// 合并多个 PDF 为一个
export async function mergePdf(files, { onprogress } = {}) {
  const out = await PDFDocument.create()
  let n = 0
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const pages = await out.copyPages(doc, doc.getPageIndices())
    pages.forEach((p) => out.addPage(p))
    n++
    if (onprogress) onprogress(Math.round((n / files.length) * 100))
  }
  const saved = await out.save({ useObjectStreams: true, objectsPerTick: 200 })
  return { blob: new Blob([saved], { type: 'application/pdf' }), name: 'merged.pdf', count: files.length, size: saved.length }
}

// 拆分：每页输出一个独立 PDF，返回可逐个下载的部件列表
export async function splitPdf(file, { onprogress } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const indices = src.getPageIndices()
  const parts = []
  for (let i = 0; i < indices.length; i++) {
    const out = await PDFDocument.create()
    const [p] = await out.copyPages(src, [indices[i]])
    out.addPage(p)
    const saved = await out.save({ useObjectStreams: true, objectsPerTick: 200 })
    parts.push({ blob: new Blob([saved], { type: 'application/pdf' }), name: `${file.name.replace(/\.pdf$/i, '')}-p${i + 1}.pdf` })
    if (onprogress) onprogress(Math.round(((i + 1) / indices.length) * 100))
  }
  return parts
}
