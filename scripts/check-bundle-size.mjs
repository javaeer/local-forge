#!/usr/bin/env node
// 产物体积预算检查（阶段 D · 体积与部署）。
//
// 作用：在 `pnpm build` 之后跑，扫描 dist/ 的产物体积，按「应用代码（JS/CSS）」与
// 「WASM 内核（ffmpeg / ffmpeg-st / tesseract / libarchive）」分类，对各类设预算上限，
// 超限即失败（退出码 1）。
//
// 目的不是压当前体积，而是给 CI 一道「回归护栏」：任何让首屏代码或单个 chunk 反常膨胀
// 的提交都会被拦下（例如误把重型库改成静态 import、新增巨型依赖、或重复捆绑内核）。
//
// 用法：
//   node scripts/check-bundle-size.mjs               # 检查（默认预算见下方 DEFAULTS）
//   BUDGET_JS_CHUNK_RAW=500 node scripts/check-bundle-size.mjs   # 环境变量覆盖单项（单位 KiB）
//
// 退出码：0 = 全部达标；1 = 有预算被突破。
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { gzipSync } from 'node:zlib'

const KB = 1024
const DIST = 'dist'

// —— 预算（单位：KiB）——
// 当前基线（PR #7 前本地构建）：es 374KB / pdf 331KB / archive 161KB（raw）；es gzip 161KB。
// 单 chunk 预算留约 7% 余量，重在捕捉「反常膨胀」而非压当前值。
const DEFAULTS = {
  JS_CHUNK_RAW: 400, // 单个 JS chunk 原始体积上限（最严、最有意义的护栏）
  JS_CHUNK_GZIP: 200, // 单个 JS chunk gzip 上限
  APP_RAW: 4096, // 应用代码（全部 JS+CSS，不含 WASM 内核）原始体积上限（宽松，留足余量）
  APP_GZIP: 1500, // 应用代码 gzip 上限（宽松）
  CORE_RAW: 92160, // WASM 内核总量上限（≈90MB，防内核被误翻倍 / 新增）
}
const budget = (k) => {
  const env = process.env['BUDGET_' + k]
  return env != null && env !== '' ? Number(env) : DEFAULTS[k]
}

// 与 public/sw.js 的 CORE_URL_RE 保持一致：这些路径是 WASM 内核，体积大且应被单独计量。
const CORE_RE = /(^|\/)(ffmpeg|ffmpeg-st|tesseract|libarchive)\//

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const fmt = (b) => (b >= KB * KB ? (b / KB / KB).toFixed(2) + ' MB' : (b / KB).toFixed(1) + ' KB')
const gzipSize = (p) => gzipSync(readFileSync(p)).length

function main() {
  if (!existsSync(DIST)) {
    console.error(`✗ 未找到 ${DIST}/，请先执行 pnpm build`)
    process.exit(0) // 非 CI 语境（本地未构建）仅提示，不硬失败
  }
  const files = walk(DIST)
  const rows = []
  let appRaw = 0, appGzip = 0, coreRaw = 0
  const failed = []

  for (const f of files) {
    const ext = extname(f)
    const rel = relative(DIST, f)
    const raw = statSync(f).size
    const isJs = ext === '.js' || ext === '.mjs'
    const isCss = ext === '.css'
    const isCore = CORE_RE.test('/' + rel)
    let gz = 0
    if (isJs || isCss) {
      gz = gzipSize(f)
      if (!isCore) { appRaw += raw; appGzip += gz }
    }
    if (isCore) coreRaw += raw
    if (isJs || isCss) rows.push({ rel, raw, gz, core: isCore })
  }

  // —— 表格（仅展示 JS/CSS，WASM 内核单列总量）——
  console.log('\n📦 产物体积（dist/）')
  console.log('─'.repeat(68))
  console.log('  文件'.padEnd(44) + 'raw'.padStart(11) + 'gzip'.padStart(11) + '  类型')
  for (const r of rows.sort((a, b) => b.raw - a.raw).slice(0, 30)) {
    const rgz = r.gz ? fmt(r.gz) : ''
    console.log('  ' + r.rel.slice(0, 42).padEnd(42) + fmt(r.raw).padStart(11) + rgz.padStart(11) + (r.core ? '  core' : ''))
  }
  console.log('─'.repeat(68))
  console.log(`  应用代码（JS+CSS，不含内核）：raw ${fmt(appRaw)} · gzip ${fmt(appGzip)}`)
  console.log(`  WASM 内核总量：raw ${fmt(coreRaw)}`)

  // —— 预算校验 ——
  const appRawMax = budget('APP_RAW') * KB
  const appGzipMax = budget('APP_GZIP') * KB
  const coreMax = budget('CORE_RAW') * KB
  for (const r of rows) {
    if (!r.core && extname(r.rel) === '.js') {
      const rMax = budget('JS_CHUNK_RAW') * KB
      const gMax = budget('JS_CHUNK_GZIP') * KB
      const over = []
      if (r.raw > rMax) over.push(`raw ${fmt(r.raw)} > ${budget('JS_CHUNK_RAW')}KiB`)
      if (r.gz > gMax) over.push(`gzip ${fmt(r.gz)} > ${budget('JS_CHUNK_GZIP')}KiB`)
      if (over.length) failed.push(`${r.rel}: ${over.join('; ')}`)
    }
  }
  if (appRaw > appRawMax) failed.push(`应用代码 raw ${fmt(appRaw)} > ${budget('APP_RAW')}KiB`)
  if (appGzip > appGzipMax) failed.push(`应用代码 gzip ${fmt(appGzip)} > ${budget('APP_GZIP')}KiB`)
  if (coreRaw > coreMax) failed.push(`WASM 内核 ${fmt(coreRaw)} > ${budget('CORE_RAW')}KiB`)

  console.log('')
  if (failed.length) {
    console.error('✗ 体积预算被突破：')
    for (const f of failed) console.error('  · ' + f)
    console.error('\n如需临时放宽，用环境变量覆盖（单位 KiB），例如 BUDGET_JS_CHUNK_RAW=500 node scripts/check-bundle-size.mjs')
    process.exit(1)
  }
  console.log('✓ 全部体积预算达标')
  process.exit(0)
}

main()
