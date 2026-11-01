#!/usr/bin/env node
// LocalForge 统一测试入口。
//
// 背景：仓库根目录散落 17 个 _e2e_*.mjs，各自约定不同——环境变量有 BASE / BASE_URL 两种、
// 浏览器路径变量有 CHROME_PATH / CHROMIUM_PATH / 硬编码 /usr/bin/chromium 三种、有的默认连
// dev server（5173）、有的连 preview（4173），还有 _e2e_media.mjs 根本没有断言与退出码。
// 结果没人知道怎么跑全套，CI 里 e2e 整段被注释。
//
// 本 runner 把差异收敛到一处：
//   1. 统一注入 BASE / BASE_URL / CHROME_PATH / CHROMIUM_PATH，脚本零改动；
//   2. 按需自动拉起 vite dev(5173) / preview(4173) 并等待就绪，跑完回收；
//   3. 按 --group / --only / --skip 过滤，串行执行、超时强杀、统一非零退出。
//
// 用法：
//   node tests/run.mjs                  # 单元测试 + core 组 e2e
//   node tests/run.mjs unit             # 只跑单元测试（node --test tests/unit）
//   node tests/run.mjs e2e              # 只跑 e2e（core 组）
//   node tests/run.mjs e2e --group heavy
//   node tests/run.mjs e2e --only i18n,doc
//   node tests/run.mjs e2e --skip ocr
//   node tests/run.mjs --list           # 列出全部套件
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SUITES } from './suites.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, def = '') => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? (args[i + 1] ?? '') : def
}
const has = (n) => args.includes('--' + n)
const listFlag = (name) => (flag(name) || '').split(',').map((s) => s.trim()).filter(Boolean)
const verbose = has('verbose') || has('v')

function run(cmd, params, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, params, { cwd: root, ...opts })
    let out = ''
    if (child.stdout) child.stdout.on('data', (d) => { out += d; if (opts.echo) process.stdout.write(d) })
    if (child.stderr) child.stderr.on('data', (d) => { out += d; if (opts.echo) process.stderr.write(d) })
    child.on('exit', (code) => resolve({ code: code ?? -1, out }))
    child.on('error', (e) => resolve({ code: -1, out: out + '\n' + e.message }))
  })
}

// —— 浏览器可执行文件探测 ——
function findChrome() {
  const env = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH
  if (env && existsSync(env)) return env
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p
  }
  // puppeteer 缓存目录：~/.cache/puppeteer/chrome/*/chrome-linux*/chrome
  const base = join(process.env.HOME || '', '.cache/puppeteer/chrome')
  if (existsSync(base)) {
    for (const ver of readdirSync(base)) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = join(base, ver, sub)
        if (existsSync(p)) return p
      }
    }
  }
  return ''
}

// —— 按需拉起 vite 服务 ——
const servers = {}
async function ensureServer(kind) {
  if (servers[kind]) return servers[kind]
  const port = kind === 'dev' ? 5173 : 4173
  const url = `http://127.0.0.1:${port}/`
  const vite = join(root, 'node_modules/vite/bin/vite.js')
  if (!existsSync(vite)) throw new Error('未找到 vite（请先 pnpm install）')
  if (kind === 'preview' && !existsSync(join(root, 'dist/index.html'))) {
    console.log('  · dist 缺失，先构建一次…')
    const r = await run(process.execPath, [vite, 'build'], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (r.code) throw new Error('构建失败，preview 无法启动')
  }
  const proc = spawn(process.execPath, [vite, kind === 'dev' ? 'dev' : 'preview', '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'ignore', 'ignore'],
  })
  servers[kind] = { proc, url }
  // 轮询就绪（最多 90s）
  for (let i = 0; i < 180; i++) {
    try { const res = await fetch(url); if (res.ok) return servers[kind] } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`vite ${kind} 在 ${url} 启动超时`)
}
function stopServers() {
  for (const k of Object.keys(servers)) { try { servers[k].proc.kill('SIGTERM') } catch { /* ignore */ } }
}

async function runUnit() {
  const unitDir = join(root, 'tests/unit')
  if (!existsSync(unitDir)) return { name: 'unit', ok: true, ms: 0, skipped: true }
  const files = readdirSync(unitDir).filter((f) => f.endsWith('.test.mjs')).map((f) => join('tests/unit', f))
  const t0 = Date.now()
  const r = await run(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: ['ignore', 'inherit', 'inherit'] })
  return { name: 'unit', ok: r.code === 0, ms: Date.now() - t0, out: r.out }
}

async function runE2E() {
  let only = listFlag('only')
  let skip = listFlag('skip')
  let group = flag('group', 'core')
  let listMode = has('list')
  let suites = SUITES.filter((s) => (only.length ? only.includes(s.id) : s.group === group))
  if (skip.length) suites = suites.filter((s) => !skip.includes(s.id))
  if (listMode) {
    console.log(`e2e 套件（--group ${group}）：`)
    for (const s of SUITES) console.log(`  [${s.group}] ${s.id.padEnd(14)} ${s.server.padEnd(7)} ${s.timeout / 1000}s  ${s.desc}`)
    return null
  }
  const chrome = findChrome()
  if (!chrome) { console.error('✗ 找不到 Chromium：请设 CHROME_PATH 或 npx puppeteer browsers install chrome'); return { name: 'e2e', ok: false, ms: 0, out: 'no chrome' } }
  console.log(`[e2e] 浏览器：${chrome}\n[e2e] 套件 ${suites.length} 个（--group ${group}）`)

  const results = []
  const usedServers = new Set(suites.map((s) => s.server))
  const urls = {}
  for (const kind of usedServers) { try { urls[kind] = (await ensureServer(kind)).url } catch (e) { console.error('✗ 服务启动失败：', e.message); return { name: 'e2e', ok: false, ms:0, out: e.message } } }

  for (const s of suites) {
    const url = urls[s.server]
    const t0 = Date.now()
    const childEnv = {
      ...process.env,
      BASE: url, BASE_URL: url,
      CHROME_PATH: chrome, CHROMIUM_PATH: chrome,
    }
    const r = await run(process.execPath, [join(root, s.file)], { env: childEnv, echo: verbose, stdio: ['ignore', 'pipe', 'pipe'] })
    const ms = ((Date.now() - t0) / 1000).toFixed(1)
    const ok = r.code === 0
    results.push({ id: s.id, ok, ms, out: r.out })
    if (!ok && !verbose) {
      const tail = r.out.split('\n').filter(Boolean).slice(-25).join('\n')
      console.log(`  └─ 末 25 行输出：\n${tail}`)
    }
  }
  return { name: 'e2e', ok: results.every((r) => r.ok), ms: 0, results }
}

function report(r) {
  if (!r) return
  if (r.skipped) { console.log('· unit：无测试目录，跳过'); return }
  if (r.name === 'unit') { console.log(`\n单元测试：${r.ok ? '✓ 通过' : '✗ 失败'}（${((r.ms) / 1000).toFixed(1)}s）`); return }
  const results = r.results || []
  console.log(`\n端到端：${r.ok ? '✓ 全部通过' : '✗ 有失败'}（${results.length} 个套件）`)
  for (const x of results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.id.padEnd(14)} ${x.ms}s`)
}

;(async () => {
  const mode = args.find((a) => a === 'unit' || a === 'e2e') || 'all'
  try {
    let ok = true
    if (mode === 'unit' || mode === 'all') { const u = await runUnit(); report(u); ok = ok && u.ok }
    if (mode === 'e2e' || mode === 'all') { const e = await runE2E(); report(e); if (e) ok = ok && e.ok }
    stopServers()
    process.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('运行器异常：', e.message)
    stopServers()
    process.exit(1)
  }
})()
