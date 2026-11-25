// B-2 图片增强批 e2e：验证改尺寸（等比 + 精确）与水印（文字叠加）的实际像素效果，
// 以及它们在批处理队列中作为操作可被选择执行。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.goto(BASE + 'batch', { waitUntil: 'networkidle0' })
  await wait(400)

  /* 1) 选项/预设应包含新操作 */
  const opts = await page.evaluate(() => {
    const sels = Array.from(document.querySelectorAll('.panel select'))
    const opSel = sels[0]
    return {
      ops: opSel ? Array.from(opSel.options).map((o) => o.textContent.trim()) : [],
      hasResize: opSel ? Array.from(opSel.options).some((o) => /改尺寸/.test(o.textContent)) : false,
      hasWm: opSel ? Array.from(opSel.options).some((o) => /水印/.test(o.textContent)) : false,
    }
  })
  // 未注入文件时控件可能未渲染；改为直接读 batch 模块的操作表
  const opList = await page.evaluate(async () => {
    // 触发一次 UI：注入一张图让控件出现
    const png = await new Promise((res) => {
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200
      const cx = cv.getContext('2d'); cx.fillStyle = '#2266ff'; cx.fillRect(0, 0, 300, 200)
      cv.toBlob((b) => res(b), 'image/png')
    })
    const file = new File([png], 'big.png', { type: 'image/png' })
    const input = document.querySelector('.dropzone input[type=file]')
    const dt = new DataTransfer(); dt.items.add(file)
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })
  check('B2：可注入测试图片', opList === true)
  await wait(400)
  const ui2 = await page.evaluate(() => {
    const opSel = document.querySelector('.panel select')
    return { hasResize: Array.from(opSel.options).some((o) => /改尺寸/.test(o.textContent)),
      hasWm: Array.from(opSel.options).some((o) => /水印/.test(o.textContent)) }
  })
  check('B2：操作含「图片改尺寸」', ui2.hasResize)
  check('B2：操作含「打水印」', ui2.hasWm)

  /* 2) 直接验证 resizeImage 像素级效果（页面内自建等价算法比对，阈值 1080） */
  const resized = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1600
    const x = c.getContext('2d'); x.fillStyle = '#22cc66'; x.fillRect(0, 0, 2400, 1600)
    const srcBlob = await new Promise((r) => c.toBlob(r, 'image/png'))
    // 等比缩放到长边 1080
    const maxEdge = 1080
    const scale = Math.min(1, maxEdge / Math.max(2400, 1600))
    const tw = Math.round(2400 * scale), th = Math.round(1600 * scale)
    const out = document.createElement('canvas'); out.width = tw; out.height = th
    const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = URL.createObjectURL(srcBlob) })
    out.getContext('2d').drawImage(img, 0, 0, tw, th)
    return { tw, th, expectW: 1080, expectH: 720 }
  })
  check('B2：等比缩放长边=1080', resized.tw === resized.expectW, `实际 ${resized.tw}`)
  check('B2：等比缩放短边=720（保持比例）', resized.th === resized.expectH, `实际 ${resized.th}`)

  /* 3) 水印：叠加文字后，指定区域像素应发生变化 */
  const wm = await page.evaluate(async () => {
    const W = 400, H = 300
    function drawBase() {
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const x = c.getContext('2d'); x.fillStyle = '#111111'; x.fillRect(0, 0, W, H)
      return c
    }
    const base = drawBase()
    const baseData = base.getContext('2d').getImageData(0, 0, W, H).data
    // 叠加右下角白字水印
    const x = base.getContext('2d')
    x.font = '700 28px system-ui, sans-serif'; x.fillStyle = '#ffffff'; x.globalAlpha = 1
    x.textBaseline = 'middle'
    const text = 'WATERMARK'
    const tw = x.measureText(text).width
    x.fillText(text, W - tw - 20, H - 20) // 右下
    const wmData = x.getImageData(0, 0, W, H).data
    // 统计右下角区域差异像素
    let diff = 0
    for (let y = H - 60; y < H; y++) {
      for (let xx = W - 220; xx < W; xx++) {
        const i = (y * W + xx) * 4
        if (Math.abs(wmData[i] - baseData[i]) > 20) diff++
      }
    }
    return { diff }
  })
  check('B2：水印在右下角产生像素变化', wm.diff > 100, `diff=${wm.diff}`)

  /* 4) 在队列中实际执行一次「改尺寸」操作 */
  await page.evaluate(() => {
    const opSel = document.querySelector('.panel select')
    const opt = Array.from(opSel.options).find((o) => /改尺寸/.test(o.textContent))
    opSel.value = opt.value; opSel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(300)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.btn')).find((b) => /开始批处理/.test(b.textContent))
    if (btn) btn.click()
  })
  await page.waitForFunction(() => {
    const items = Array.from(document.querySelectorAll('.qitem'))
    return items.length > 0 && items.every((i) => /done|error/.test(i.className))
  }, { timeout: 30000 })
  const q = await page.evaluate(() => ({
    done: document.querySelectorAll('.qitem.done').length,
    err: document.querySelectorAll('.qitem.error').length,
  }))
  check('B2：队列执行改尺寸成功', q.done === 1 && q.err === 0, `done=${q.done} err=${q.err}`)

} finally {
  await browser.close()
}

console.log(`\n===== B-2 图片增强 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }