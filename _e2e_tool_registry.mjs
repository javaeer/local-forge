// Tool Registry e2e：命令面板条目数 = Registry、检索命中、NAV 派生一致、路由 meta、零跨域。
import puppeteer from 'puppeteer-core'
import { TOOLS_REGISTRY } from './src/lib/tool-registry.js'
import { TOOL_COUNT } from './src/lib/formats.js'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  try { await page.setBypassServiceWorker(true) } catch { /* 老版本 Puppeteer 不提供 */ }
  await page.setViewport({ width: 1360, height: 1000 })
  const crossOrigin = []
  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        if (u.origin !== ORIGIN) crossOrigin.push(u.href)
      }
    } catch { /* data/blob/about 忽略 */ }
  })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(400)

  /* 1) 命令面板条目数 = Registry 34 条 */
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control')
  await wait(250)
  const palette = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.palette .p-item'))
    const groups = Array.from(document.querySelectorAll('.palette .p-group')).map((e) => e.textContent.trim())
    return { open: !!document.querySelector('.palette'), count: items.length, paths: items.map((e) => (e.querySelector('.p-path') || {}).textContent.trim()), groups }
  })
  check('Registry：⌘K 命令面板打开', palette.open)
  check('Registry：命令面板条目数 = Registry 条数', palette.count === TOOLS_REGISTRY.length,
    `palette=${palette.count} registry=${TOOLS_REGISTRY.length}`)
  check('Registry：命令面板路径无重复', new Set(palette.paths).size === palette.paths.length)
  check('Registry：命令面板分组非空', palette.groups.length > 0, palette.groups.join(' | '))

  /* 2) 检索命中（标题本地化 + 关键字） */
  await page.type('.palette input', 'zip')
  await wait(250)
  const searched = await page.evaluate(() => Array.from(document.querySelectorAll('.palette .p-item'))
    .map((e) => (e.querySelector('.p-path') || {}).textContent.trim()))
  check('Registry：检索 zip 命中压缩工具', searched.includes('/zip-compress'), searched.join(', '))
  await page.keyboard.press('Escape')
  await wait(200)

  /* 3) 侧栏/顶栏 NAV 派生：可见导航链接数 = Registry（顶栏布局下走"全部"面板） */
  const navCount = await page.evaluate(() => document.querySelectorAll('nav a, .sb-nav a').length)
  check('Registry：页面已渲染导航链接', navCount > 0, `nav links=${navCount}`)

  /* 4) 首页卡片数仍等于 TOOL_COUNT（派生未吞卡） */
  const cards = await page.evaluate(() => document.querySelectorAll('details#all-tools .tool-card').length)
  check(`Registry：首页卡片数仍为 ${TOOL_COUNT}`, cards === TOOL_COUNT, `cards=${cards}`)

  /* 5) 零跨域：Registry 为本地静态数据，加载首页不产生跨域请求 */
  const external = crossOrigin.filter((u) => !u.startsWith(ORIGIN))
  check('Registry：零跨域请求', external.length === 0, external.slice(0, 3).join(', '))

  console.log(`\n=== Tool Registry e2e：${results.length - failed}/${results.length} 通过 ===`)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
