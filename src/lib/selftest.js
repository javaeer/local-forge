// 自检聚合器：动态加载各功能模块并运行其 selfTest()，统一返回报告。
// 懒加载（import），不进主包；模块级异常 / 超时由本层兜底成失败项，绝不静默、绝不卡死面板。
async function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' 自检超时（>' + ms + 'ms，可能 WASM 内核加载卡住）')), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function runAllSelfTests() {
  const modules = [
    { id: 'image', load: () => import('./image.js'), fn: 'selfTest' },
    { id: 'archive', load: () => import('./archive.js'), fn: 'selfTest' },
    // 媒体默认 selfTest() 走多线程内核，在部分无 SharedArrayBuffer / headless 环境下会卡住，
    // 自检面板统一用 selfTestST()（单线程，兼容性好）验证 ffmpeg 管线可用。
    { id: 'media', load: () => import('./media.js'), fn: 'selfTestST' },
    { id: 'mediapro', load: () => import('./mediapro.js'), fn: 'selfTest' },
    { id: 'pdf', load: () => import('./pdf.js'), fn: 'selfTest' },
    { id: 'pdfpro', load: () => import('./pdfpro.js'), fn: 'selfTest' },
    { id: 'qrcode', load: () => import('./qrcode.js'), fn: 'selfTest' },
    { id: 'hash', load: () => import('./hash.js'), fn: 'selfTest' },
    { id: 'exif', load: () => import('./exif.js'), fn: 'selfTest' },
    { id: 'text', load: () => import('./text.js'), fn: 'selfTest' },
    { id: 'ocr', load: () => import('./ocr.js'), fn: 'selfTest' },
    // 本次合并进来的 SVG 工具箱 / CSS 速查表：selfTest 内联于各自模块
    { id: 'svgtool', load: () => import('./svgtool.js'), fn: 'selfTest' },
    { id: 'cssref', load: () => import('./cssref.selftest.js'), fn: 'selfTest' },
  ]
  const results = []
  for (const m of modules) {
    try {
      const mod = await m.load()
      // 单模块 120s：ffmpeg / OCR 这类 WASM 内核首次加载较慢，需留足时间
      const rep = await withTimeout(mod[m.fn](), 120000, m.id)
      results.push(rep)
    } catch (e) {
      results.push({
        module: m.id,
        items: [{ id: 'module-run', title: '模块加载 / 自检', ok: false, error: { message: e.message, stack: e.stack } }],
      })
    }
  }
  return { generatedAt: new Date().toISOString(), modules: results }
}
