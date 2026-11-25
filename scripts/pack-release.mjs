#!/usr/bin/env node
// 发布打包器：把「可直接离线运行的成品」组装进 release/ 并产出 zip + 校验和。
// 零新增依赖：仅用 Node 内置模块 + 系统 zip（GitHub runner / 常见 Linux 均自带）。
//
// 用法：
//   node scripts/pack-release.mjs                 # 版本取 package.json.version
//   RELEASE_VERSION=v1.0.0 node scripts/pack-release.mjs
//
// 产出：
//   release/local-forge-<version>/       暂存目录（保留，便于检查）
//   release/local-forge-<version>.zip    发布资产
//   release/SHA256SUMS.txt               逐文件 sha256
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const rawVersion = process.env.RELEASE_VERSION || pkg.version || '0.0.0'
const version = String(rawVersion).replace(/^v/, '')
const stage = join(root, 'release', `local-forge-${version}`)
const releaseDir = join(root, 'release')
const zipPath = join(releaseDir, `local-forge-${version}.zip`)

function fail(msg) { console.error('✗ ' + msg); process.exit(1) }
function info(msg) { console.log('  ' + msg) }

// ---- 1) 前置校验 ----
if (!existsSync(join(root, 'dist/index.html'))) {
  fail('缺少 dist/index.html，请先执行 pnpm build')
}
if (spawnSync('zip', ['--version'], { stdio: 'ignore' }).status !== 0) {
  fail('系统缺少 zip 命令，无法打包')
}

// ---- 2) 重建暂存目录 ----
mkdirSync(releaseDir, { recursive: true })
if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

// 复制函数：源不存在时记录缺失，不静默漏掉
const missing = []
function copyIfExists(srcRel, dstRel, { dir = false } = {}) {
  const src = join(root, srcRel)
  if (!existsSync(src)) { missing.push(srcRel); return false }
  const dst = join(stage, dstRel || srcRel)
  mkdirSync(dirname(dst), { recursive: true })
  if (dir) cpSync(src, dst, { recursive: true })
  else cpSync(src, dst)
  return true
}

// ---- 3) 应用产物 ----
copyIfExists('dist', 'dist', { dir: true })
info('已复制 dist/')

// ---- 4) 离线内核数据快照（被 .gitignore 排除，发布包必须自带）----
// 保持 public/ 下的原始路径，SW 的 CORE_GROUPS 无需改动即可离线命中。
const dataDirs = ['public/ffmpeg', 'public/ffmpeg-st', 'public/tesseract', 'public/libarchive', 'public/pdfjs']
for (const d of dataDirs) copyIfExists(d, d, { dir: true })

// 数据文件可能是整目录或 *.gz 通配，逐个存在性校验
const dataGlobs = [
  'public/dict/*.gz',
  'public/classics/*.gz',
  'public/classics/full',
  'public/tcm/*.gz',
  'public/tcm/bencao*.gz',
  'public/tcm/full',
  'public/tcm/full-index.json.gz',
]
function copyGlob(pattern) {
  const isDirPattern = !pattern.includes('*')
  if (isDirPattern) { copyIfExists(pattern, pattern, { dir: true }); return }
  const dir = dirname(pattern)
  const base = pattern.slice(pattern.lastIndexOf('/') + 1)
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$')
  if (!existsSync(dir)) { missing.push(pattern); return }
  const hits = readdirSync(dir).filter((n) => re.test(n) && statSync(join(dir, n)).isFile())
  if (!hits.length) { missing.push(pattern); return }
  for (const n of hits) copyIfExists(join(dir, n), join(dir, n))
}
for (const g of dataGlobs) copyGlob(g)

// ---- 5) 说明与许可文件 ----
for (const f of ['README.md', 'LICENSE', 'LICENSE.txt', 'public/dict/LICENSE.txt', 'public/classics/LICENSE.txt']) {
  if (existsSync(join(root, f))) copyIfExists(f, f)
}

// ---- 6) 清单 ----
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}
const files = walk(stage).sort()
let totalBytes = 0
const groupCounts = {}
for (const f of files) {
  totalBytes += statSync(f).size
  const rel = relative(stage, f).replace(/\\/g, '/')
  const top = rel.split('/')[0]
  groupCounts[top] = (groupCounts[top] || 0) + 1
}
const manifest = {
  name: 'local-forge',
  version,
  commit: (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout || '').trim(),
  builtAt: new Date().toISOString(),
  fileCount: files.length,
  totalBytes,
  groups: groupCounts,
  missingData: missing,
}
writeFileSync(join(stage, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')

// ---- 7) 校验和（对整个暂存目录逐文件）----
const allFiles = walk(stage).sort()
const sums = allFiles.map((f) => {
  const h = createHash('sha256').update(readFileSync(f)).digest('hex')
  return `${h}  ${relative(stage, f).replace(/\\/g, '/')}`
}).join('\n') + '\n'
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), sums)
// 包内也放一份，便于下载方就地校验
writeFileSync(join(stage, 'SHA256SUMS.txt'), sums)

// ---- 8) 打 zip ----
if (existsSync(zipPath)) rmSync(zipPath, { force: true })
const zip = spawnSync('zip', ['-q', '-r', zipPath, '.'], { cwd: stage, stdio: 'inherit' })
if (zip.status !== 0) fail('zip 打包失败')

// ---- 9) 报告 ----
console.log(`\n✓ 发布包已生成：${relative(root, zipPath)}`)
info(`版本 ${version} · ${manifest.fileCount} 文件 · ${(totalBytes / 1048576).toFixed(1)} MB`)
info(`commit ${manifest.commit || '(未知)'} · ${manifest.builtAt}`)
if (missing.length) {
  console.log(`\n⚠ 以下可选数据快照未找到（发布前请确认是否需要补拉）：`)
  for (const m of [...new Set(missing)]) info(m)
} else {
  info('所有数据快照齐全')
}
info('校验和：release/SHA256SUMS.txt（下载后 sha256sum -c 校验）')
