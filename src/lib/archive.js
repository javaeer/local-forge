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
  const m = n.match(/^(.*)\.z(\d{1,3})$/)
  if (m) return { base: m[1], kind: 'z', num: parseInt(m[2], 10) } // 形态 A 的 .z01…（排在 .zip 之前）
  const mZip = n.match(/^(.*)\.zip$/)
  if (mZip) return { base: mZip[1], kind: 'zip', num: Infinity } // 形态 A 末卷
  const m2 = n.match(/^(.*)\.(\d{2,4})$/)
  if (m2) return { base: m2[1], kind: 'num', num: parseInt(m2[2], 10) } // 形态 B 的 .001…
  return null
}

// 判断一批文件是否构成一个分卷 ZIP 集合。
// 仅看后缀会让 a.zip + b.zip 被误判为分卷（合并后只剩一个文件，静默丢数据），
// 因此必须同时满足：同一主名、编号连续、且两种命名形态各自完整。
//   - 形态 A（name.z01…name.zNN + name.zip）：恰好一个 .zip 收尾，.z 编号 1..N 连续
//   - 形态 B（name.zip.001…name.zip.NNN）：编号 1..N 连续，不含 .zip 末卷
export function isSplitZipSet(fileList) {
  if (!fileList || fileList.length < 2) return false
  const keys = fileList.map((f) => splitPartKey(f.name))
  if (keys.some((k) => k === null)) return false

  // 1) 主名必须一致
  const base = keys[0].base
  if (!keys.every((k) => k.base === base)) return false

  // 2) 不允许两种形态混用
  const hasZ = keys.some((k) => k.kind === 'z' || k.kind === 'zip')
  const hasNum = keys.some((k) => k.kind === 'num')
  if (hasZ && hasNum) return false

  // 3) 编号必须从 1 开始连续无缺口
  if (hasNum) {
    const nums = keys.map((k) => k.num).sort((a, b) => a - b)
    if (nums.length !== keys.length) return false
    return nums.every((v, i) => v === i + 1)
  }

  // 形态 A：.z 部分编号 1..N 连续，且恰好一个 .zip 末卷
  const zipCount = keys.filter((k) => k.kind === 'zip').length
  if (zipCount !== 1) return false
  const zNums = keys.filter((k) => k.kind === 'z').map((k) => k.num).sort((a, b) => a - b)
  if (!zNums.length) return false
  return zNums.every((v, i) => v === i + 1)
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

// 浏览器内自检（供回显层调用）：覆盖创建/解压/密码/转换/合并/修复/分卷/不支持格式。
// 返回统一结构 { module, items:[{id,title,ok,detail?,error?}] } —— 任何子测试失败都原样记录错误。
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
  const enc = new TextEncoder()
  const mk = (name, text) => new File([enc.encode(text)], name)

  await T('create-zip', '创建 ZIP', async () => {
    const b = await createZip([mk('a.txt', 'hello')])
    if (!b.size) throw new Error('输出为空')
    return b.size + 'B'
  })
  await T('create-tar', '创建 TAR', async () => {
    const b = await createArchive([mk('a.txt', 'hello')], { outputFileName: 'x.tar' })
    if (!b.size) throw new Error('输出为空')
    return b.size + 'B'
  })
  await T('zip-extract', 'ZIP 解压回环', async () => {
    const z = await createZip([mk('a.txt', 'hello')])
    const es = await extract(new File([z], 'x.zip'))
    return '条目: ' + es.map((e) => e.name).join(',')
  })
  await T('zip-password', '密码 ZIP 拒绝无密码/错密码', async () => {
    const pz = await createZip([mk('a.txt', 'secret')], { password: 'test123' })
    let noPw = false
    let wrongPw = false
    try { await extract(new File([pz], 'p.zip')) } catch { noPw = true }
    try { await extract(new File([pz], 'p3.zip'), { password: 'bad' }) } catch { wrongPw = true }
    if (!noPw) throw new Error('无密码应被拒绝')
    if (!wrongPw) throw new Error('错误密码应被拒绝')
    const dec = await extract(new File([pz], 'p2.zip'), { password: 'test123' })
    return '解密成功；无密码/错密码均拒绝（' + dec.map((e) => e.name).join(',') + '）'
  })
  await T('convert', '格式转换 tar→zip', async () => {
    const tar = await createArchive([mk('a.txt', 'x')], { outputFileName: 'y.tar' })
    const conv = await convert(new File([tar], 'y.tar'), 'zip')
    const es = await extract(new File([conv], 'c.zip'))
    return '条目: ' + es.map((e) => e.name).join(',')
  })
  await T('merge', '合并多个 ZIP', async () => {
    const z1 = await createZip([mk('a.txt', 'A')])
    const z2 = await createZip([mk('b.txt', 'B')])
    const m = await merge([new File([z1], 'a.zip'), new File([z2], 'b.zip')], { outExt: 'zip' })
    const es = await extract(new File([m], 'm.zip'))
    return '条目: ' + es.map((e) => e.name).join(',')
  })
  await T('repair', '损坏 ZIP 尽力修复', async () => {
    const good = await createZip([mk('keep.txt', 'data123')])
    const arr = new Uint8Array(await good.arrayBuffer())
    arr[30] = 0 // 破坏中央目录某字节
    const es = await extract(new File([arr], 'bad.zip'))
    return es.length + ' 个条目被尽力读出'
  })
  await T('split-zip', '分卷 ZIP 拼接解压', async () => {
    const big = 'x'.repeat(500)
    const zblob = await createZip([mk('big.txt', big)])
    const buf = new Uint8Array(await zblob.arrayBuffer())
    const cut = 60
    const p1 = new File([buf.slice(0, cut)], 'vol.z01')
    const p2 = new File([buf.slice(cut)], 'vol.zip')
    const isSet = isSplitZipSet([p1, p2])
    const entries = await extractSplitZip([p1, p2])
    const txt = await (await entries[0].getBlob()).text()
    if (!isSet) throw new Error('未识别为分卷集')
    if (txt !== big) throw new Error('拼接后内容不一致')
    return '拼接成功: ' + entries[0].name
  })
  await T('unsupported-7z', '不支持格式明确报错', async () => {
    let threw = false
    try { await createArchive([mk('a.txt', 'x')], { outputFileName: 'x.7z' }) }
    catch { threw = true }
    if (!threw) throw new Error('7z 未被拒绝（应当报错）')
    return '已正确拒绝 7z'
  })

  return { module: '归档', items }
}
