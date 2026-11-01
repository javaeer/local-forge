// 浏览器内验证 ffmpeg 媒体内核：加载 + 轻量编码（mjpeg），确认管线可用。
// 经由 tests/run.mjs 统一注入 BASE / BASE_URL / CHROMIUM_PATH / CHROME_PATH，脚本无需关心地址与浏览器路径。
import puppeteer from 'puppeteer-core'
const BASE_URL = process.env.BASE_URL || process.env.BASE || 'http://localhost:5173'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()))
page.on('pageerror', (e) => logs.push('[PAGEERR] ' + e.message))
await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0' })
const r = await page.evaluate(async () => {
  const { selfTestST } = await import('/src/lib/media.js')
  return await selfTestST()
})
console.log('MEDIA SELFTEST:', JSON.stringify(r))
console.log('LOGS:', logs.slice(0, 10).join('\n'))

// —— 断言（此前本脚本无断言、无退出码，永远“通过”）——
// selfTestST() 返回 { module, items }，items 为 { id, title, ok, detail|error }[]。
if (!r) throw new Error('✗ MEDIA SELFTEST 返回空，媒体内核自检未执行')
const items = Array.isArray(r) ? r : (Array.isArray(r.items) ? r.items : null)
if (items !== null) {
  if (items.length === 0) throw new Error('✗ MEDIA SELFTEST 返回 0 个条目')
  const failed = items.filter((x) => x && x.ok === false)
  if (failed.length) throw new Error('✗ MEDIA SELFTEST 有 ' + failed.length + ' 个失败项：' + JSON.stringify(failed))
} else {
  const failedCount = (r.failed && Array.isArray(r.failed)) ? r.failed.length : 0
  if (failedCount > 0 || r.ok === false) throw new Error('✗ MEDIA SELFTEST 失败：' + JSON.stringify(r))
}
console.log('✓ MEDIA SELFTEST 通过')
await browser.close()
