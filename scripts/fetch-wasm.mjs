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
//
// 离线内核扩展（B-4）：除 WASM 内核外，还把「工具运行时会从网上拉的其余资源」
// 一并收进本地 public/，与 public/sw.js 的 CORE_GROUPS 对齐：
//   public/tesseract/lang/  ← OCR 语言训练数据（@tesseract.js-data/<lang> 的
//                             4.0.0_best_int 整数量化 LSTM 模型，9 种语言共约 16MB；
//                             tesseract.js 运行时默认从 jsDelivr 按需下载，现改为本地优先）
//   public/pdfjs/           ← pdf.js worker（从 node_modules 复制，不联网；
//                             稳定路径使 SW 可将其列入 'pdf' 内核组预缓存）
// 语言包带 sha256 校验 + unpkg 镜像回退；下载失败仅警告（运行时回退 CDN），CI 下退出码 1。
import { existsSync, mkdirSync, writeFileSync, statSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

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
  {
    dir: 'public/tesseract/lang',
    files: [
      // OCR 语言训练数据（tesseract.js v7 默认源：@tesseract.js-data/<lang>/4.0.0_best_int，
      // 整数量化 LSTM 模型 = 官方 tessdata_fast 的等价精简版；与运行时下载的字节完全一致）。
      // 校验和实测自 jsDelivr 原始下载；unpkg 镜像作回退。
      { urls: [`${CDN}/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`], name: 'eng.traineddata.gz', sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' },
      { urls: [`${CDN}/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz`], name: 'chi_sim.traineddata.gz', sha256: 'b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c' },
      { urls: [`${CDN}/@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz`], name: 'chi_tra.traineddata.gz', sha256: '11fe2610dab05d8a880d02f193ce70203f4c4bbe061b987d5529a2c038a22743' },
      { urls: [`${CDN}/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz`], name: 'jpn.traineddata.gz', sha256: '2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88' },
      { urls: [`${CDN}/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz`], name: 'kor.traineddata.gz', sha256: '78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126' },
      { urls: [`${CDN}/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz`], name: 'fra.traineddata.gz', sha256: 'd611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255' },
      { urls: [`${CDN}/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz`], name: 'deu.traineddata.gz', sha256: '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b' },
      { urls: [`${CDN}/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz`], name: 'spa.traineddata.gz', sha256: '40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb' },
      { urls: [`${CDN}/@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz`, `https://unpkg.com/@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz`], name: 'rus.traineddata.gz', sha256: 'f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a' },
    ],
  },
  {
    dir: 'public/pdfjs',
    files: [
      // pdf.js worker：不联网，直接从 node_modules 复制到稳定路径 /pdfjs/，
      // 使 SW 的 'pdf' 内核组可预缓存（Vite 打包出的带 hash 资源名无法静态登记）。
      { from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs', name: 'pdf.worker.min.mjs' },
    ],
  },
]

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB')

async function fetchBuf(urls, name) {
  // 依次尝试镜像列表，全部失败才抛错
  const list = Array.isArray(urls) ? urls : [urls]
  const errs = []
  for (const u of list) {
    try {
      const res = await fetch(u)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) throw new Error('空响应')
      return buf
    } catch (e) {
      errs.push(`${u} → ${e.message}`)
    }
  }
  throw new Error(errs.join('；'))
}

async function ensureFile(dir, f) {
  const dest = join(dir, f.name)
  if (!FORCE && existsSync(dest) && statSync(dest).size > 0) {
    // 已有文件也校验 sha256（若声明了校验和），损坏的缓存文件会被重下
    if (!FORCE && f.sha256) {
      const ok = verify(dest, f.sha256)
      if (!ok) console.warn(`    ⚠ ${f.name} 现有文件 sha256 不匹配，将重新拉取`)
      else return { name: f.name, status: 'skip' }
    } else {
      return { name: f.name, status: 'skip' }
    }
  }
  mkdirSync(dir, { recursive: true })
  let buf
  if (f.from) {
    // 本地复制（node_modules → public），无网络依赖
    if (!existsSync(f.from)) throw new Error(`源文件不存在：${f.from}（是否已 pnpm install？）`)
    copyFileSync(f.from, dest)
    return { name: f.name, status: 'copied', size: statSync(dest).size }
  }
  buf = await fetchBuf(f.urls || f.url, f.name)
  if (f.sha256) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== f.sha256) throw new Error(`sha256 不匹配：期望 ${f.sha256.slice(0, 12)}…，实际 ${got.slice(0, 12)}…`)
  }
  writeFileSync(dest, buf)
  return { name: f.name, status: 'downloaded', size: buf.length }
}

function verify(path, sha256) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex') === sha256
  } catch { return false }
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
        const tag = r.status === 'skip' ? '· 跳过'
          : r.status === 'copied' ? `· 复制 ${fmt(r.size)}`
          : `· 下载 ${fmt(r.size)}`
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
