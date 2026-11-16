// 图片引擎端到端验证（真实浏览器）：自检 + 真实压缩回环（含半透明渐变图）。
// 启动 dev 服务后由 puppeteer 在浏览器内调用 /src/lib/image.js。
import puppeteer from 'puppeteer-core'
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
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
  const { selfTest, compressImage } = await import('/src/lib/image.js')
  const out = {}
  // 1) 引擎自检（纯 upng 量化/解码，验证调色板 + alpha 保留）
  out.self = await selfTest()
  // 2) 真实压缩：256x256 渐变图（含半透明），PNG 量化后体积应下降且可解码
  const mk = () =>
    new Promise((res) => {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const x = c.getContext('2d')
      const g = x.createLinearGradient(0, 0, 256, 256)
      g.addColorStop(0, 'rgba(255,0,0,1)')
      g.addColorStop(0.5, 'rgba(0,255,0,0.5)')
      g.addColorStop(1, 'rgba(0,0,255,1)')
      x.fillStyle = g
      x.fillRect(0, 0, 256, 256)
      c.toBlob((b) => res(new File([b], 'grad.png', { type: 'image/png' })), 'image/png')
    })
  const f = await mk()
  out.origSize = f.size
  const comp = await compressImage(f, { outMime: 'image/png', quality: 0.6 })
  out.compressedSize = comp.size
  out.savedPct = Math.round((1 - comp.size / f.size) * 100)
  // 校验量化后 PNG 仍是合法可解码图片（保留尺寸 + 透明）——用 <img> 解码（产品真实路径）
  const url = URL.createObjectURL(comp)
  const im = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('量化后 PNG 无法解码'))
    el.src = url
  })
  URL.revokeObjectURL(url)
  out.decodedW = im.naturalWidth
  out.decodedH = im.naturalHeight
  out.validPng = im.naturalWidth === 256 && im.naturalHeight === 256
  // 3) JPG / WEBP 输出
  const jpg = await compressImage(f, { outMime: 'image/jpeg', quality: 0.7 })
  out.jpg = { size: jpg.size, type: jpg.type }
  const webp = await compressImage(f, { outMime: 'image/webp', quality: 0.7 })
  out.webp = { size: webp.size, type: webp.type }
  return out
})
console.log('IMAGE SELFTEST:', JSON.stringify(r, null, 2))
console.log('LOGS:', logs.slice(0, 10).join('\n'))
await browser.close()
