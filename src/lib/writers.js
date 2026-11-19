// 可靠的归档创建实现（不依赖 libarchive 的 write，其在浏览器环境返回空）
import { createZip } from './archive.js'

const enc = new TextEncoder()

async function fileBytes(f) {
  return new Uint8Array(await f.arrayBuffer())
}

// ---------- USTAR / PAX TAR ----------
// USTAR 头部把路径拆成两段：name(100 字节) + prefix(155 字节，offset 345)。
// 旧实现直接 name.slice(0,100) 会把长路径截断成同名文件、并把多字节字符拦腰切断。
// 这里先尝试在 '/' 处拆到 prefix，仍放不下时改用 PAX 扩展头（typeflag 'x'）承载完整路径。
const USTAR_NAME = 100
const USTAR_PREFIX = 155

// 返回 { name, prefix } ；无法放入两段时返回 null（需要 PAX）
function splitUstarName(fullName) {
  const bytes = enc.encode(fullName)
  if (bytes.length <= USTAR_NAME) return { name: fullName, prefix: '' }
  // 从右往左找 '/'，使尾部 name ≤100 字节、头部 prefix ≤155 字节
  for (let i = fullName.length - 1; i > 0; i--) {
    if (fullName[i] !== '/') continue
    const head = fullName.slice(0, i)
    const tail = fullName.slice(i + 1)
    if (!tail) continue
    const tailBytes = enc.encode(tail).length
    const headBytes = enc.encode(head).length
    if (tailBytes <= USTAR_NAME && headBytes <= USTAR_PREFIX) return { name: tail, prefix: head }
  }
  return null
}

function tarHeader({ name, prefix = '', size, isDir = false, typeflag = '0' }) {
  const h = new Uint8Array(512)
  const set = (off, str, len) => {
    const b = enc.encode(str)
    h.set(b.subarray(0, Math.min(len, b.length)), off)
  }
  set(0, name, USTAR_NAME)
  if (prefix) set(345, prefix, USTAR_PREFIX)
  set(100, '0000644\0', 8)
  set(108, '0000000\0', 8)
  set(116, '0000000\0', 8)
  set(124, size.toString(8).padStart(11, '0') + '\0', 12)
  set(136, Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 12)
  h[156] = typeflag.charCodeAt(0)
  set(257, 'ustar\0', 6) // magic
  set(263, '00', 2) // version
  set(265, 'root\0', 32)
  set(297, 'root\0', 32)
  // checksum
  for (let i = 148; i < 156; i++) h[i] = 0x20
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]
  set(148, sum.toString(8).padStart(6, '0') + '\0 ', 8)
  return h
}

// 构造 PAX 扩展记录："<len> key=value\n"，len 含自身长度。按字节计。
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  const bodyBytes = enc.encode(body).length
  let len = bodyBytes + 1 // 先假设长度 1 位
  while (true) {
    const now = bodyBytes + String(len).length
    if (now === len) break
    len = now
  }
  return String(len) + body
}

// 生成一个 PAX 扩展头（typeflag 'x'）+ 其数据块，用于承载放不进 USTAR 的长路径
function paxHeaderBlock(fullName) {
  const record = paxRecord('path', fullName)
  const data = enc.encode(record)
  const header = tarHeader({ name: 'PaxHeader', prefix: '', size: data.length, typeflag: 'x' })
  const blocks = [header, data]
  const pad = (512 - (data.length % 512)) % 512
  if (pad) blocks.push(new Uint8Array(pad))
  return blocks
}

export async function writeTar(files) {
  const blocks = []
  for (const f of files) {
    const data = await fileBytes(f)
    const fullName = f.webkitRelativePath || f.name
    const split = splitUstarName(fullName)
    if (split) {
      blocks.push(tarHeader({ name: split.name, prefix: split.prefix, size: data.length, isDir: false }))
    } else {
      // 路径过长：先写 PAX 扩展头声明完整 path，再写头部（name 字段用可读的占位名）
      blocks.push(...paxHeaderBlock(fullName))
      const base = fullName.split('/').pop() || 'file'
      const safeName = enc.encode(base).length <= USTAR_NAME ? base : base.slice(0, 40)
      blocks.push(tarHeader({ name: safeName, prefix: '', size: data.length, isDir: false }))
    }
    blocks.push(data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad) blocks.push(new Uint8Array(pad))
  }
  blocks.push(new Uint8Array(512), new Uint8Array(512)) // end markers
  return new Blob(blocks)
}

async function gzipBlob(blob) {
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).blob()
}

export async function writeTarGz(files) {
  return await gzipBlob(await writeTar(files))
}

// 统一创建入口：zip/tar/tar.gz 可靠；其余格式回退提示
// 注：7Z / ISO / XZ / ZST / BZ2 等创建需原版专有 WASM 模块（网页端不可得），
// 但其解压/提取由 libarchive.js 全覆盖。
export async function createArchiveReliable(files, { fmt, compression = 'NONE', password = '', onprogress } = {}) {
  if (onprogress) onprogress(10)
  let blob
  if (fmt === 'zip') blob = await createZip(files, { password, level: 6, splitSize: 0 })
  else if (fmt === 'tar') blob = await writeTar(files)
  else if (fmt === 'tar.gz' || fmt === 'tgz') blob = await writeTarGz(files)
  else throw new Error(`网页端暂不支持直接创建 .${fmt}（需原版专有 WASM 模块）。可创建为 ZIP / TAR / TAR.GZ。`)
  if (onprogress) onprogress(100)
  return blob
}
