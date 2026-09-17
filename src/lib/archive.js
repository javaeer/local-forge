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

// ---------- 分卷 ZIP 解压（PKWARE spanned / 7-Zip 分卷）----------
// 命名形态 A（zip.js / WinZip spanned）：name.z01, name.z02, ..., name.zip（末卷为 .zip）
// 命名形态 B（7-Zip 分卷）：name.zip.001, name.zip.002, ...（无单独 .zip）
function splitPartKey(name) {
  const n = name.toLowerCase()
  const m = n.match(/\.z(\d{1,3})$/)
  if (m) return { kind: 'z', num: parseInt(m[1], 10) } // 形态 A 的 .z01…（排在 .zip 之前）
  if (n.endsWith('.zip')) return { kind: 'zip', num: Infinity } // 形态 A 末卷
  const m2 = n.match(/\.(\d{2,4})$/)
  if (m2) return { kind: 'num', num: parseInt(m2[1], 10) } // 形态 B 的 .001…
  return null
}

// 判断一批文件是否构成一个分卷 ZIP 集合（≥2 个且命名均符合上述规则）
export function isSplitZipSet(fileList) {
  if (!fileList || fileList.length < 2) return false
  const keys = fileList.map((f) => splitPartKey(f.name))
  return keys.every((k) => k !== null)
}

// 将多卷按顺序拼接为一个 Blob，再走通用解压
export async function extractSplitZip(fileList, { password } = {}) {
  const parts = fileList
    .map((f) => ({ f, k: splitPartKey(f.name) }))
    .filter((p) => p.k !== null)
    .sort((a, b) => (a.k.kind === b.k.kind ? a.k.num - b.k.num : a.k.kind === 'zip' ? 1 : b.k.kind === 'zip' ? -1 : a.k.kind.localeCompare(b.k.kind)))
  const bufs = await Promise.all(parts.map((p) => p.f.arrayBuffer()))
  let total = 0
  for (const b of bufs) total += b.byteLength
  const merged = new Uint8Array(total)
  let off = 0
  for (const b of bufs) {
    merged.set(new Uint8Array(b), off)
    off += b.byteLength
  }
  // 用首卷名推导出合并后的文件名（去掉分卷后缀）
  const base = fileList[0].name.replace(/\.z\d{1,3}$/i, '').replace(/\.zip\.\d{2,4}$/i, '').replace(/\.zip$/i, '')
  const mergedFile = new File([merged], (base || 'archive') + '.zip')
  return extract(mergedFile, { password })
}
