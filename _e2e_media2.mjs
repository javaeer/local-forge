// 端到端验证 MediaConvert 真实转换（WAV→MP3），确认 convertMedia 在移除了
// crossOriginIsolated 守卫后能走通，并记录用到的内核类型与耗时。
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()))
page.on('pageerror', (e) => logs.push('[PAGEERR] ' + e.message))
await page.goto('http://localhost:5173/media-convert', { waitUntil: 'networkidle0' })

const r = await page.evaluate(async () => {
  const iso = self.crossOriginIsolated
  const { convertMedia } = await import('/src/lib/media.js')
  // 构造一个最小有效 WAV（8bit 单声道 8kHz，约 0.1s 静音）
  const enc = new TextEncoder()
  const sr = 8000, dur = 0.1, n = Math.floor(sr * dur)
  const dataLen = n
  const buf = new ArrayBuffer(44 + dataLen)
  const dv = new DataView(buf)
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE')
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr, true)
  dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
  wr(36, 'data'); dv.setUint32(40, dataLen, true)
  const data = new Uint8Array(buf)
  const t0 = performance.now()
  const blob = await convertMedia(data, 'input.wav', ['-i', 'input.wav', '-c:a', 'libmp3lame', 'out.mp3'], 'out.mp3', 'audio/mpeg')
  const t1 = performance.now()
  return { crossOriginIsolated: iso, ok: blob.size > 0, outSize: blob.size, ms: Math.round(t1 - t0), type: blob.type }
})
console.log('MEDIA CONVERT:', JSON.stringify(r))
console.log('LOGS:', logs.slice(0, 8).join('\n'))
await browser.close()
