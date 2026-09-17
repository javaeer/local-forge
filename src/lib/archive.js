// 通用归档引擎：覆盖 ezyzip.pro 全部创建/解压/转换/合并能力（纯前端）
import { Archive } from 'libarchive.js'
import { ZipReader, ZipWriter, BlobReader, BlobWriter } from '@zip.js/zip.js'

let libReady = false
async function ensureLib() {
  if (!libReady) {
    await Archive.init({ workerUrl: '/libarchive/worker-bundle.js' })
    libReady = true
  }
}

// 用 zip.js 解压（AES 密码支持最佳），返回条目数组（eager 提取，避免 use-after-close）
async function extractZip(file, { password } = {}) {
  const reader = new ZipReader(new BlobReader(file), { password: password || undefined })
  const list = await reader.getEntries()
  const entries = []
  for (const e of list) {
    if (e.directory) continue
    const blob = await e.getData(new BlobWriter(), { password: password || undefined })
    entries.push({ name: e.filename, size: e.uncompressedSize || blob.size, getBlob: () => Promise.resolve(blob) })
  }
  await reader.close()
  return entries
}

// 校验某个密码是否能解开该加密 ZIP（AES 密码在 getData 时才校验）。
// 供密码恢复模块复用：逐个候选密码尝试，命中即返回。
export async function testZipPassword(file, pw) {
  const reader = new ZipReader(new BlobReader(file), { password: pw || undefined })
  try {
    const entries = await reader.getEntries()
    const entry = entries.find((e) => !e.directory)
    if (!entry) { await reader.close(); return false }
    await entry.getData(new BlobWriter(), { password: pw || undefined })
    await reader.close()
    return true
  } catch {
    await reader.close().catch(() => {})
    return false
  }
}

// 用 libarchive.js 解压（200+ 格式：rar/7z/tar/iso/dmg/wim/apk/ipsw…）
// 关键坑：libarchive.js 走 Comlink 代理，getFilesObject()/getFilesArray() 会把含 "/"
// 的路径拆成嵌套对象树，且因代理对象跨端 instanceof 判断失效，嵌套文件会被静默丢弃。
// 因此直接用底层 client.listFiles()（返回完整 path 的原始条目）+ extractSingleFile(path)。
async function extractLib(file, { password } = {}) {
  await ensureLib()
  const archive = await Archive.open(file, password ? { password } : undefined)
  const list = await archive.client.listFiles()
  const entries = []
  for (const e of list) {
    if (e.type !== 'FILE') continue // 跳过目录/符号链接等非文件条目
    const blob = await archive.extractSingleFile(e.path)
    entries.push({ name: e.path, size: blob.size, getBlob: () => Promise.resolve(blob) })
  }
  return entries
}

const ZIP_LIKE = /\.(zip|zipx|jar|apk|ipa|ipsw|mcpack|war|xapk)$/i
// 这些用 zip.js（密码/AES 更稳）；其余交给 libarchive.js
export async function extract(file, { password } = {}) {
  if (ZIP_LIKE.test(file.name)) {
    try {
      return await extractZip(file, { password })
    } catch (e) {
      // zip.js 失败（如非 AES 的旧加密）回退 libarchive
      return await extractLib(file, { password })
    }
  }
  return await extractLib(file, { password })
}

// 用 zip.js 创建 ZIP（支持密码/分卷/目录结构/压缩级别）
export async function createZip(files, { password = '', level = 6, splitSize = 0, onprogress } = {}) {
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    level: Number(level),
    useWebWorkers: true,
    password: password || undefined,
    encryptionStrength: password ? 3 : 0,
    ...(splitSize ? { splitSize: Number(splitSize) } : {}),
  })
  let done = 0
  const total = files.reduce((s, f) => s + f.size, 0) || 1
  for (const f of files) {
    const path = f.webkitRelativePath || f.fullPath || f.name
    await writer.add(path, new BlobReader(f), {
      onprogress: (cur) => {
        if (onprogress) onprogress(Math.min(99, Math.round(((done + cur) / total) * 100)))
      },
    })
    done += f.size
  }
  const blob = await writer.close()
  if (onprogress) onprogress(100)
  return blob
}

// 可靠创建：zip/tar/tar.gz/iso 由本项目自研写入器实现；其余格式回退提示
export async function createArchive(
  files,
  { outputFileName = 'archive.tar', compression = 'NONE', format = null, password = null, onprogress } = {}
) {
  const fmt = (() => {
    const n = outputFileName.toLowerCase()
    if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'tar.gz'
    if (n.endsWith('.tar.bz2')) return 'tar.bz2'
    if (n.endsWith('.tar.xz')) return 'tar.xz'
    if (n.endsWith('.tar.zst')) return 'tar.zst'
    return (n.split('.').pop() || 'tar').toLowerCase()
  })()
  const { createArchiveReliable } = await import('./writers.js')
  return createArchiveReliable(files, { fmt, compression, password: password || '', onprogress })
}

// 格式互转：解压源 → 创建目标
export async function convert(file, outExt, { password = '', compression = 'NONE', onprogress } = {}) {
  const entries = await extract(file, { password })
  const files = []
  for (const e of entries) {
    const data = new Uint8Array(await (await e.getBlob()).arrayBuffer())
    files.push(new File([data], e.name))
  }
  const outName = 'converted.' + outExt.replace(/^\./, '')
  if (outExt === 'zip') return createZip(files, { onprogress })
  return createArchive(files, { outputFileName: outName, compression, onprogress })
}

// 合并多个归档为一个
export async function merge(files, { outExt = 'zip', compression = 'NONE', onprogress } = {}) {
  const all = []
  let n = 0
  for (const f of files) {
    const entries = await extract(f)
    for (const e of entries) {
      const data = new Uint8Array(await (await e.getBlob()).arrayBuffer())
      all.push(new File([data], e.name))
    }
    n++
    if (onprogress) onprogress(Math.round((n / files.length) * 80))
  }
  const outName = 'merged.' + outExt.replace(/^\./, '')
  if (outExt === 'zip') return createZip(all, { onprogress: (p) => onprogress && onprogress(80 + Math.round(p * 0.2)) })
  return createArchive(all, { outputFileName: outName, compression, onprogress: (p) => onprogress && onprogress(80 + Math.round(p * 0.2)) })
}
