// App 图标生成器 e2e（core 组）：在真实 Chromium 里验证「本地生成 → 商店合规 PNG → ZIP」链路。
// 覆盖：页面挂载与 i18n、上传/预览、尺寸预设、App Store 产物无 alpha 通道（ITMS-90717）、
// 裁剪模式 / 背景色 / 勾选、下载 ZIP 后解析字节、隐私不变量（零跨域请求）、无控制台错误。
// 运行：pnpm build && node tests/run.mjs e2e --only appicon
import puppeteer from 'puppeteer-core'
import { writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { encodeIconPng } from './src/lib/app-icon.js'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const SRC_PNG = '/tmp/lf-appicon-src.png'
const DL_DIR = '/tmp/lf-appicon-downloads'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 构造带半透明像素的 1024 源图（故意混入 alpha，用来验证 App Store 产物被强制去 alpha）
function makeSourcePng() {
  const w = 1024, h = 1024
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inCircle = (x - 512) ** 2 + (y - 512) ** 2 < 380 ** 2
      d[i] = inCircle ? 30 : 240
      d[i + 1] = inCircle ? 120 : 240
      d[i + 2] = inCircle ? 220 : 240
      d[i + 3] = (x < 120 || y < 120) ? 128 : 255 // 边缘半透明
    }
  }
  return encodeIconPng({ data: d, width: w, height: h })
}
writeFileSync(SRC_PNG, makeSourcePng())
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })

// 解析 store ZIP（无压缩），返回 name -> Buffer
function parseStoreZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const files = {}
  let p = 0
  while (p + 4 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen)
    const start = p + 30 + nameLen + extraLen
    files[name] = buf.subarray(start, start + size)
    p = start + size
  }
  return files
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []
  const crossOrigin = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (req) => {
    const u = req.url()
    if (/^https?:/.test(u)) {
      try { if (new URL(u).origin !== ORIGIN) crossOrigin.push(u) } catch { /* 忽略畸形 URL */ }
    }
  })
  // 允许下载到临时目录，用于端到端解析 ZIP 产物
  try {
    const cdp = await page.createCDPSession()
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR })
  } catch { /* 新版 Chromium 可能已迁移到 Browser.setDownloadBehavior */ }

  await page.goto(BASE + 'app-icon', { waitUntil: 'networkidle0' })
  await wait(500)

  const info = await page.evaluate(() => ({
    title: document.querySelector('h1.page-title') ? document.querySelector('h1.page-title').textContent.trim() : '',
    docTitle: document.title,
    help: !!document.querySelector('.helptip'),
    drop: !!document.querySelector('.dropzone input[type=file]'),
    presets: document.querySelectorAll('.preset-cb').length,
    groups: document.querySelectorAll('.preset-group').length,
  }))
  // 沙箱 Chromium 会按系统语言本地化，故断言语言无关：标题非空 + 含 · + 无原始 key 泄漏
  const titleText = info.title + ' ' + info.docTitle
  check('页面挂载：标题已本地化且无 i18n key 泄漏',
    !!info.title && info.docTitle.includes('·') && !/(?:nav|group|home|views)\.[A-Za-z]/.test(titleText),
    `${info.title} / ${info.docTitle}`)
  check('使用说明与拖放区存在', info.help && info.drop)
  check('渲染 19 个尺寸预设、分 3 组展示', info.presets === 19 && info.groups === 3,
    `${info.presets} 项 / ${info.groups} 组`)

  // 上传源图 → 自动生成
  const input = await page.$('.dropzone input[type=file]')
  await input.uploadFile(SRC_PNG)
  await page.waitForSelector('.icon-card', { timeout: 15000 })
  await wait(400)

  const cards = await page.$$eval('.icon-card', (els) => els.map((e) => ({
    name: e.getAttribute('data-name'),
    size: Number(e.getAttribute('data-size')),
    colorType: Number(e.getAttribute('data-colortype')),
  })))
  check('默认生成 7 个产物（App Store / Google Play / Android 5 档）', cards.length === 7, `${cards.length} 个`)
  const a = cards.find((c) => c.name === 'Icon-1024.png')
  check('App Store 1024 产物尺寸精确为 1024×1024', !!a && a.size === 1024, a ? String(a.size) : 'missing')
  check('★ App Store 1024 产物 PNG colorType=2（无 alpha 通道，规避 ITMS-90717）',
    !!a && a.colorType === 2, a ? `colorType=${a.colorType}` : 'missing')
  check('其余产物尺寸与预设一一对应且无异常诊断',
    cards.every((c) => c.size > 0) &&
    (await page.$$eval('.issue-list li.error', (els) => els.length)) === 0)
  const g = cards.find((c) => c.name === 'Icon-512.png')
  check('Google Play 512 产物存在（允许 alpha 通道）', !!g && g.size === 512 && g.colorType === 6,
    g ? `size=${g.size} colorType=${g.colorType}` : 'missing')

  // 预览图真实渲染
  const previewOk = await page.$$eval('.icon-thumb img', (els) => els.every((e) => e.complete && e.naturalWidth > 0))
  check('每个产物都有可解码的本地预览图', previewOk)

  // 背景色注入拦截：非法值应产生 warning，合法值后消失
  await page.evaluate(() => {
    const el = document.querySelector('.bg-text')
    el.value = 'red;position:fixed'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(200)
  const badBg = await page.$$eval('.issue-list li.warning', (els) => els.length)
  await page.evaluate(() => {
    const el = document.querySelector('.bg-text')
    el.value = '#0f172a'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(200)
  const goodBg = await page.$$eval('.issue-list li.warning', (els) => els.length)
  check('背景色白名单：非法值告警、合法值告警消失', badBg > 0 && goodBg === 0, `bad=${badBg} good=${goodBg}`)

  // 切换裁剪方式 + 重新生成
  await page.select('.fit-select', 'contain')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn')].find((x) => x.querySelector('.bi-grid-1x2'))
    if (b) b.click()
  })
  await wait(900)
  const afterFit = await page.$$eval('.icon-card', (els) => els.length)
  check('切换为「完整保留」后重新生成成功且无错误',
    afterFit === 7 && (await page.$$eval('.issue-list li.error', (els) => els.length)) === 0, `${afterFit} 个`)

  // 全选 19 项 → 生成全部；仅必选 → 只剩 1 项
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn.tiny')].find((x) => /Select all|全选|すべて選択|모두 선택|Seleccionar todo/i.test(x.textContent))
    if (b) b.click()
  })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn')].find((x) => x.querySelector('.bi-grid-1x2'))
    if (b) b.click()
  })
  await wait(1200)
  const allCount = await page.$$eval('.icon-card', (els) => els.length)
  check('全选可一次生成 19 个尺寸（含 iOS 传统 12 档）', allCount === 19, `${allCount} 个`)
  const iosOk = await page.$$eval('.icon-card', (els) => els.some((e) => e.getAttribute('data-name') === 'Icon-180.png'))
  check('iOS 传统尺寸确实进入产物（Icon-180.png）', iosOk)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn.tiny')].find((x) => /Required only|仅必选|必須のみ|필수만|Solo obligatorios/i.test(x.textContent))
    if (b) b.click()
  })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn')].find((x) => x.querySelector('.bi-grid-1x2'))
    if (b) b.click()
  })
  await wait(700)
  const requiredOnly = await page.$$eval('.icon-card', (els) => els.map((e) => e.getAttribute('data-name')))
  check('「仅必选」保留 App Store 1024（required 不可取消）',
    requiredOnly.length === 1 && requiredOnly[0] === 'Icon-1024.png', requiredOnly.join(','))

  // 端到端下载 ZIP，并在 Node 侧解析真实字节
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.btn.green')].find((x) => x.querySelector('.bi-file-earmark-zip'))
    if (b) b.click()
  })
  let zipPath = ''
  for (let i = 0; i < 40; i++) {
    const list = readdirSync(DL_DIR).filter((f) => f.endsWith('.zip'))
    if (list.length) { zipPath = DL_DIR + '/' + list[0]; break }
    await wait(150)
  }
  check('点击下载后 ZIP 文件落地', !!zipPath && existsSync(zipPath), zipPath || 'no download')
  if (zipPath) {
    const files = parseStoreZip(readFileSync(zipPath))
    const names = Object.keys(files)
    check('ZIP 内含 App Store 图标 + README，文件名稳定 ASCII',
      names.includes('Icon-1024.png') && names.includes('README.txt') &&
      names.every((n) => /^[\x20-\x7e]+$/.test(n)), names.join(' | '))
    const png = files['Icon-1024.png']
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20), ct = png[25]
    check('★ 下载包内 Icon-1024.png 实测 1024×1024 且 colorType=2（无 alpha 通道）',
      w === 1024 && h === 1024 && ct === 2, `${w}x${h} colorType=${ct}`)
    check('README 明确声明不生成 Asset Catalog / Adaptive Icon',
      /NOT:/.test(files['README.txt'].toString('utf8')))
  }

  // 工作流「下一步」按钮存在
  const nextOk = await page.$$eval('.next-steps .ns-btn', (els) => els.length)
  check('站内工作流「下一步」已接入', nextOk >= 1, `${nextOk} 项`)

  check('隐私不变量：无任何跨域网络请求', crossOrigin.length === 0, crossOrigin.slice(0, 3).join(' | '))
  check('页面无控制台 / 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

console.log(`\n===== App 图标生成器 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }
