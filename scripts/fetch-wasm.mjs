#!/usr/bin/env node
// 构建期 / 开发期从 CDN 拉取 WASM 内核（阶段 D · 体积与部署）。
//
// 背景：ffmpeg（单/多线程）×2、tesseract、libarchive 的 WASM 内核共约 80MB，
// 此前被直接提交进 Git（public/ffmpeg 等）。这些文件现已 gitignore，
// 本脚本在 `pnpm build` / `pnpm dev` 前把它们从 CDN 拉回 public/，
// 使运行时与离线机制（public/sw.js 的 CORE_GROUPS 仍指向本地 /ffmpeg 等路径）完全不变。
//
// 来源（均经 HEAD 200 验证，tesseract-core-lstm.wasm 字节数与本地一致）：
//   public/ffmpeg/     ← @ffmpeg/core-mt@0.12.10/dist/esm
//   public/ffmpeg-st/  ← @ffmpeg/core@0.12.10/dist/esm
//   public/tesseract/  ← tesseract.js-core@7.0.0（+ worker.min.js 来自 tesseract.js@7.0.0/dist）
//   public/libarchive/ ← libarchive.js@2.0.2/dist
//
// 行为：已存在的文件跳过（支持离线构建 / 手动放置 / 复用缓存）；缺失则从 CDN 下载。
//   下载失败：本地打印警告并继续（离线开发可用运行时兜底）；
//   若在 CI 环境（process.env.CI）下仍有缺失，则退出码 1（避免部署缺内核的版本）。
//
// 用法：
//   node scripts/fetch-wasm.mjs            # 缺失才下载
//   FORCE=1 node scripts/fetch-wasm.mjs    # 强制重新下载全部
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CDN = 'https://cdn.jsdelivr.net/npm'
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true'

// dir：本地 public 下的目录；files：{ url: CDN 完整地址, name: 落地文件名 }
const KERNELS = [
  {
    dir: 'public/ffmpeg',
    files: [
      { url: `${CDN}/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.js`, name: 'ffmpeg-core.js' },
      { url: `${CDN}/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.wasm`, name: 'ffmpeg-core.wasm' },
      { url: `${CDN}/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js`, name: 'ffmpeg-core.worker.js' },
    ],
  },
  {
    dir: 'public/ffmpeg-st',
    files: [
      { url: `${CDN}/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js`, name: 'ffmpeg-core.js' },
      { url: `${CDN}/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm`, name: 'ffmpeg-core.wasm' },
    ],
  },
  {
    dir: 'public/tesseract',
    files: [
      { url: `${CDN}/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm`, name: 'tesseract-core-lstm.wasm' },
      { url: `${CDN}/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js`, name: 'tesseract-core-lstm.wasm.js' },
      { url: `${CDN}/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm`, name: 'tesseract-core-simd-lstm.wasm' },
      { url: `${CDN}/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js`, name: 'tesseract-core-simd-lstm.wasm.js' },
      { url: `${CDN}/tesseract.js@7.0.0/dist/worker.min.js`, name: 'worker.min.js' },
    ],
  },
  {
    dir: 'public/libarchive',
    files: [
      { url: `${CDN}/libarchive.js@2.0.2/dist/libarchive.wasm`, name: 'libarchive.wasm' },
      { url: `${CDN}/libarchive.js@2.0.2/dist/worker-bundle.js`, name: 'worker-bundle.js' },
    ],
  },
]

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB')

async function ensureFile(dir, f) {
  const dest = join(dir, f.name)
  if (!FORCE && existsSync(dest) && statSync(dest).size > 0) {
    return { name: f.name, status: 'skip' }
  }
  mkdirSync(dir, { recursive: true })
  const res = await fetch(f.url)
  if (!res.ok) throw new Error(`${f.url} → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  return { name: f.name, status: 'downloaded', size: buf.length }
}

async function main() {
  console.log('🔧 拉取 WASM 内核（缺失才下载，FORCE=1 强制全部重下）\n')
  const failures = []
  let total = 0
  for (const k of KERNELS) {
    console.log(`· ${k.dir}`)
    for (const f of k.files) {
      try {
        const r = await ensureFile(k.dir, f)
        const tag = r.status === 'skip' ? '· 跳过' : `· 下载 ${fmt(r.size)}`
        console.log(`    ${tag.padEnd(12)} ${f.name}`)
        if (r.size) total += r.size
      } catch (e) {
        failures.push({ dir: k.dir, name: f.name, err: e.message })
        console.error(`    ✗ ${f.name} —— ${e.message}`)
      }
    }
  }

  console.log('')
  if (failures.length) {
    console.error(`⚠ ${failures.length} 个文件拉取失败：`)
    for (const x of failures) console.error(`    · ${x.dir}/${x.name}（${x.err}）`)
    console.error('  本地已有文件会被复用；若全部缺失，在线时由运行时 CDN 兜底（media 已内置，OCR/archive 需联网）。')
    if (process.env.CI) {
      console.error('  CI 环境下内核缺失将导致部署版本缺内核，故以失败退出。')
      process.exit(1)
    }
    console.error('  非 CI 环境：仅警告，构建继续。')
  } else {
    console.log(`✓ WASM 内核就绪（本次新增下载约 ${fmt(total)}）`)
  }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
