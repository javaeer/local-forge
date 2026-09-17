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
