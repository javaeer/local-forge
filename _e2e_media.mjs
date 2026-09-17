// 浏览器内验证 ffmpeg 媒体内核：加载 + 轻量编码（mjpeg），确认管线可用
import puppeteer from 'puppeteer-core'
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'] })
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
await browser.close()
