// CI 环境自检 e2e：断言 tests/run.mjs 注入的 CHROME_PATH 有效、浏览器可由该路径启动、
// 首页可加载且零跨域。价值：CI 若再次把浏览器路径注入改坏，本套件第一个精确报错，
// 而不是让其余 core 套件一起超时。
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const CHROME = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || ''
check('CI 环境：run.mjs 注入了 CHROME_PATH/CHROMIUM_PATH', !!CHROME, CHROME || '（空）')
check('CI 环境：注入的浏览器路径文件存在', !!CHROME && existsSync(CHROME), CHROME || '（空）')

const browser = await puppeteer.launch({
  executablePath: CHROME || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  try { await page.setBypassServiceWorker(true) } catch { /* 老版本 Puppeteer 不提供 */ }
  await page.setViewport({ width: 1280, height: 900 })
  const crossOrigin = []
  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== ORIGIN) crossOrigin.push(u.href)
    } catch { /* data/blob/about 忽略 */ }
  })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  const title = await page.title()
  check('CI 环境：注入路径可启动浏览器并加载首页', typeof title === 'string' && title.length > 0, title)
  check('CI 环境：首页零跨域请求', crossOrigin.length === 0, crossOrigin.slice(0, 3).join(', '))
} finally {
  await browser.close()
}

console.log(`\nCI 环境自检：${failed ? '✗ 失败' : '✓ 通过'}（${results.length} 项）`)
process.exit(failed ? 1 : 0)
