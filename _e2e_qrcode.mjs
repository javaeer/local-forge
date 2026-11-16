// 二维码专项端到端（真实浏览器 + 真实解码器）：
//   1) 打开 /qr-code → 选 WiFi 类型 → 填表 → 断言预览 canvas 真的画出来了
//   2) 导出预览 PNG → 用 Node 端 zxing-wasm 真解码 → 断言内容与 payload 完全一致
//   3) 把同一张 PNG 上传回页面的「识别」标签 → 断言页面自己能识出来并结构化解释
//   4) 切到「批量生成」页签 → 输入多行 → 断言无渲染错误
// 目的：既测功能正确性（不是只测函数），也防「模板渲染期报错」的盲区再次发生。
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { readBarcodes } from 'zxing-wasm/reader'

const BASE = (process.env.BASE || 'http://localhost:4173').replace(/\/+$/, '')
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const TMP = '/tmp/qr-e2e.png'
const SSID = 'My-Test-WiFi'
const PWD = 'test1234'
const EXPECT = `WIFI:T:WPA;S:${SSID};P:${PWD};H:false;;`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

const log = []
function ok(m) { log.push('  ✓ ' + m) }
function fail(m) { log.push('  ✗ ' + m); failures++ }
let failures = 0

try {
  await page.goto(BASE + '/qr-code', { waitUntil: 'networkidle0' })

  // ---------- 1) 生成：WiFi ----------
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.type-card')].find((x) => x.textContent.includes('WiFi'))
    card && card.click()
  })
  await page.waitForFunction(() => document.querySelectorAll('.form-grid input[type=text]').length >= 1, { timeout: 10000 })
  await page.evaluate((ssid, pwd) => {
    const setNative = (el, v, proto) => {
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const [ssidEl, pwdEl] = [...document.querySelectorAll('.form-grid input[type=text], .form-grid input[type=password]')]
    setNative(ssidEl, ssid, HTMLInputElement)
    setNative(pwdEl, pwd, HTMLInputElement)
  }, SSID, PWD)

  await page.waitForFunction(() => !!document.querySelector('.qr-preview canvas'), { timeout: 15000 })
  const size = await page.$eval('.qr-preview canvas', (c) => c.width + 'x' + c.height)
  size && size !== 'x0' ? ok(`预览已渲染：${size}`) : fail('预览 canvas 尺寸异常：' + size)

  const payloadText = await page.$eval('.payload-box', (el) => el.textContent.trim())
  payloadText === EXPECT ? ok('载荷构造正确：' + payloadText) : fail(`载荷不符：实际=${payloadText} 期望=${EXPECT}`)

  // ---------- 2) Node 端真实解码验证 ----------
  const dataUrl = await page.$eval('.qr-preview canvas', (c) => c.toDataURL('image/png'))
  fs.writeFileSync(TMP, Buffer.from(dataUrl.split(',')[1], 'base64'))
  const decoded = await readBarcodes(new Uint8Array(fs.readFileSync(TMP)))
  if (!decoded.length) fail('Node 端 zxing-wasm 未能解码该二维码')
  else if (decoded[0].text !== EXPECT) fail(`解码内容不符：实际=${decoded[0].text} 期望=${EXPECT}`)
  else ok(`独立解码器验证通过（${decoded[0].format}）：${decoded[0].text}`)

  // ---------- 3) 识别页：上传刚才那张图 ----------
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.includes('识别二维码'))
    b && b.click()
  })
  await page.waitForFunction(() => !!document.querySelector('.dropzone input[type=file]'), { timeout: 10000 })
  const input = await page.$('.dropzone input[type=file]')
  await input.uploadFile(TMP)
  await page.waitForFunction(() => document.querySelectorAll('.hit').length > 0, { timeout: 30000 })
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.hit')
    const fields = [...el.querySelectorAll('.hit-field')].map((r) => [
      r.querySelector('.k').textContent.trim(),
      r.querySelector('.v').textContent.trim(),
    ])
    return { kind: el.querySelector('.hit-head').textContent.replace(/\s+/g, ' ').trim(), fields }
  })
  const flat = JSON.stringify(hit.fields)
  flat.includes(SSID) && flat.includes(PWD)
    ? ok('页面自识别成功并结构化：' + hit.kind + ' | ' + hit.fields.map((f) => f.join('=')).join(', '))
    : fail('页面识别结果未包含预期字段：' + flat)

  // ---------- 4) 批量页 ----------
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.includes('批量生成'))
    b && b.click()
  })
  await page.waitForFunction(() => !!document.querySelector('textarea'), { timeout: 10000 })
  ok('批量页渲染正常')

  console.log('=== 二维码端到端 ===')
  console.log(log.join('\n'))
  console.log('运行期错误:', errors.length ? '\n' + errors.join('\n') : '无')
  if (errors.length) failures += errors.length
  console.log(failures === 0 ? '\n✅ 二维码功能端到端全绿' : `\n❌ 有 ${failures} 项问题`)
  await browser.close()
  process.exit(failures === 0 ? 0 : 1)
} catch (e) {
  console.log('测试异常:', e.message)
  if (errors.length) console.log('捕获错误:\n' + errors.join('\n'))
  await browser.close()
  process.exit(1)
}
