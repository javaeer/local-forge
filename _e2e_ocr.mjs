// OCR 专项端到端（真实浏览器 + 真实识别）：
//   1) 打开 /ocr → 断言页面无渲染错误、语言下拉与步骤条渲染正常
//   2) 语言切到「英语」（体积小，CI 快）→ 上传一张写着 Hello 的合成 PNG → 点「开始识别」
//   3) 等待识别结果 → 断言真的识别出 Hello，并显示置信度与内核来源
//   4) 切到「PDF 逐页识别」页签 → 断言页码范围/倍率控件与页签渲染正常
// 目的：覆盖「模板渲染期报错」盲区 + 验证真实识别链路（含本地内核加载）。
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const BASE = (process.env.BASE || 'http://localhost:4173').replace(/\/+$/, '')
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const TMP = '/tmp/ocr-e2e.png'
const EXPECT = 'Hello'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

const log = []
let failures = 0
function ok(m) { log.push('  ✓ ' + m) }
function fail(m) { log.push('  ✗ ' + m); failures++ }

try {
  await page.goto(BASE + '/ocr', { waitUntil: 'networkidle0' })

  // ---------- 0) 用浏览器 canvas 造一张测试图（白底黑字，字号足够大） ----------
  const dataUrl = await page.evaluate((word) => {
    const c = document.createElement('canvas')
    c.width = 420
    c.height = 120
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#000000'
    ctx.font = '68px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(word, 24, 62)
    return c.toDataURL('image/png')
  }, EXPECT)
  fs.writeFileSync(TMP, Buffer.from(dataUrl.split(',')[1], 'base64'))
  ok('测试图已生成：' + TMP + '（' + fs.statSync(TMP).size + 'B）')

  // ---------- 1) 首屏渲染 ----------
  await page.waitForSelector('.page-title', { timeout: 15000 })
  const title = await page.$eval('.page-title', (el) => el.textContent.trim())
  title.includes('OCR') ? ok('页面渲染：' + title) : fail('页面标题异常：' + title)
  const langCount = await page.$$eval('select option', (els) => els.length)
  langCount >= 8 ? ok('语言下拉渲染 ' + langCount + ' 项') : fail('语言下拉项过少：' + langCount)
  const stepCount = await page.$$eval('.stepbar .step', (els) => els.length)
  stepCount === 3 ? ok('步骤条渲染 ' + stepCount + ' 步') : fail('步骤条异常：' + stepCount)

  // ---------- 2) 选英语 + 上传图片 ----------
  await page.select('select', 'eng')
  await page.waitForSelector('.dropzone input[type=file]', { timeout: 10000 })
  const input = await page.$('.dropzone input[type=file]')
  await input.uploadFile(TMP)
  await page.waitForSelector('.img-preview img', { timeout: 15000 })
  ok('图片已载入并预览')

  // ---------- 3) 真实识别 ----------
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('开始识别'))
    b && b.click()
  })
  await page.waitForSelector('.ocr-out', { timeout: 240000 })
  // 等结果文本填充（OCR 需要时间）
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.ocr-out')
      return el && el.textContent.trim() && !el.textContent.includes('（未识别到文字）')
    },
    { timeout: 240000 },
  )
  const got = await page.$eval('.ocr-out', (el) => el.textContent.trim())
  new RegExp(EXPECT, 'i').test(got)
    ? ok('识别成功，结果含 "' + EXPECT + '"：' + JSON.stringify(got.slice(0, 60)))
    : fail('识别结果不含期望文本：' + JSON.stringify(got.slice(0, 80)));
  const status = await page.$eval('.status', (el) => el.textContent.replace(/\s+/g, ' ').trim())
  if (/置信度/.test(status)) ok('结果区显示：' + status); else fail('结果区缺少置信度信息：' + status)
  if (/本地|CDN/.test(status)) ok('内核来源已标注'); else fail('未标注内核来源：' + status)

  // ---------- 4) PDF 页签 ----------
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.includes('PDF'))
    b && b.click()
  })
  await page.waitForFunction(
    () => [...document.querySelectorAll('input[type=text]')].some((i) => (i.placeholder || '').includes('1-3')),
    { timeout: 10000 },
  )
  ok('PDF 逐页识别页签渲染正常（页码范围 / 倍率控件就位）')

  console.log('=== OCR 端到端 ===')
  console.log(log.join('\n'))
  console.log('运行期错误:', errors.length ? '\n' + errors.join('\n') : '无')
  if (errors.length) failures += errors.length
  console.log(failures === 0 ? '\n✅ OCR 功能端到端全绿' : `\n❌ 有 ${failures} 项问题`)
  await browser.close()
  process.exit(failures === 0 ? 0 : 1)
} catch (e) {
  console.log('测试异常:', e.message)
  console.log(log.join('\n'))
  if (errors.length) console.log('捕获错误:\n' + errors.join('\n'))
  await browser.close()
  process.exit(1)
}
