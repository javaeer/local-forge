// 可靠的归档创建实现（不依赖 libarchive 的 write，其在浏览器环境返回空）
import { createZip } from './archive.js'

const enc = new TextEncoder()

async function fileBytes(f) {
  return new Uint8Array(await f.arrayBuffer())
}

// ---------- USTAR TAR ----------
function tarHeader(name, size, isDir) {
  const h = new Uint8Array(512)
  const set = (off, str, len) => {
    const b = enc.encode(str)
    h.set(b.subarray(0, Math.min(len, b.length)), off)
  }
  set(0, name.slice(0, 100), 100)
  set(100, '0000644\0', 8)
  set(108, '0000000\0', 8)
  set(116, '0000000\0', 8)
  set(124, size.toString(8).padStart(11, '0') + '\0', 12)
  set(136, Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 12)
  h[156] = isDir ? 0x35 : 0x30 // '5' dir / '0' file
  set(257, 'ustar\0', 6)
  set(263, '00', 2)
  set(265, 'root\0', 32)
  set(297, 'root\0', 32)
  // checksum
  for (let i = 148; i < 156; i++) h[i] = 0x20
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]
  set(148, sum.toString(8).padStart(6, '0') + '\0 ', 8)
  return h
}

export async function writeTar(files) {
  const blocks = []
  for (const f of files) {
    const data = await fileBytes(f)
    const name = (f.webkitRelativePath || f.name).slice(0, 100)
    blocks.push(tarHeader(name, data.length, false))
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
