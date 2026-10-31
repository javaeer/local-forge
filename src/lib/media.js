// 音视频转换（纯前端，基于 @ffmpeg/ffmpeg 多线程内核）。
//
// 内核分级兜底（A-1：体积与可用性权衡后的策略）：
//   0) 显式单线程（自检 / 诊断用）
//   1) 本地多线程 /ffmpeg        —— 主力内核，需跨源隔离（部署已强制 COOP/COEP，32MB）
//   2) CDN 多线程                —— 本地 MT 文件缺失/损坏时的第一兜底（免预缓存体积）
//   3) 本地单线程 /ffmpeg-st     —— 无 SharedArrayBuffer 环境的兜底（31MB，按需下载，不进首装预缓存）
//   4) CDN 单线程                —— 连本地 ST 都不可用时的最后兜底
//
// 设计要点：本地 ST 内核体积与 MT 几乎相同（31MB vs 32MB），但只在"无跨源隔离"这一
// 少数场景才需要。故把 ST 排在 CDN-MT 之后，配合 Service Worker 不预缓存内核，
// 使绝大多数用户（隔离环境）只下载 32MB，而非 63MB 全量。ST/CDN 仅按需拉取。
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
let loaded = false

// CDN 兜底地址（版本与 package.json 的 @ffmpeg/core-mt 保持一致）
const CDN_MT = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
const CDN_ST = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'

export function onProgress(cb) {
  ffmpeg.on('progress', ({ progress: p }) => { if (p && p > 0 && p < 1) cb(Math.round(p * 100)) })
}

// 内核加载回调（A-5）：加载内核期间没有 ffmpeg progress 事件，但耗时可能达数秒。
// 视图可注册此回调，在"加载内核"阶段给出不确定进度（脉冲）或阶段切换。
let onCoreLoad = null
export function setCoreLoadHook(cb) { onCoreLoad = cb }

// 内核偏好：
//   'auto' = 本地MT → CDN-MT → 本地ST → CDN-ST   （默认：本地优先，省流量）
//   'cdn'  = CDN-MT → 本地MT → CDN-ST → 本地ST   （CDN 优先：不占主机空间，绕开单文件上限）
//   'st'   = 直接单线程（自检环境更稳、更快）
// 提示：Settings 的"内核策略"或 URL 参数 ?lf-core=cdn 可切换。
let corePreference = 'auto'
export function setCorePreference(p) {
  corePreference = p === 'st' ? 'st' : p === 'cdn' ? 'cdn' : 'auto'
}
export function corePreferenceLabel() { return corePreference }

// CDN 优先时的探测：先用 HEAD 确认 CDN 确实可达（避免离线环境白等超时）。
let cdnProbe = null
async function cdnReachable() {
  if (cdnProbe !== null) return cdnProbe
  try {
    const res = await fetch(`${CDN_MT}/ffmpeg-core.js`, { method: 'HEAD', cache: 'no-store' })
    cdnProbe = res.ok
  } catch { cdnProbe = false }
  return cdnProbe
}

// 记录实际生效的内核层级，供自检 / 视图回显（如 "本地多线程" / "CDN 单线程"）。
let coreSource = ''
export function coreSourceLabel() { return coreSource }

// 内核 URL 构造器。必须定义在 loadCore 之前——否则函数体内的 const 处于 TDZ，
// 提前调用会抛 ReferenceError 并被下面的 try/catch 静默吞掉，导致误回落到多线程内核而卡死。
const mtURLs = async (b) => ({
  coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  workerURL: await toBlobURL(`${b}/ffmpeg-core.worker.js`, 'text/javascript'),
})
const stURLs = async (b) => ({
  coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
})

// 尝试加载一个层级：成功则置 loaded 并记录来源；失败抛出由调用方决定是否继续兜底。
async function tryLoad(loader, source) {
  await ffmpeg.load(await loader())
  loaded = true
  coreSource = source
}

async function loadCore() {
  if (loaded) return
  onCoreLoad && onCoreLoad('start')
  try {
    await loadCoreTiered()
  } finally {
    onCoreLoad && onCoreLoad(loaded ? 'end' : 'error')
  }
}

async function loadCoreTiered() {
  // 0) 调用方显式要求单线程（自检环境更稳，避免多线程内核在无 SharedArrayBuffer 时挂起）
  if (corePreference === 'st') {
    try { await tryLoad(() => stURLs('/ffmpeg-st'), '本地单线程（指定）'); return }
    catch (e) { console.warn('[media] 指定单线程内核加载失败，回退自动选择：', e) }
  }

  // 'cdn' 模式：CDN 多线程优先（不占主机空间，绕开免费主机的单文件上限）。
  // 用 toBlobURL 把 CDN 资源转成同源 blob，因此不违反 COEP:require-corp，跨源隔离下同样可用。
  if (corePreference === 'cdn' && self.crossOriginIsolated && await cdnReachable()) {
    try { await tryLoad(() => mtURLs(CDN_MT), 'CDN 多线程（指定）'); return }
    catch (e) { console.warn('[media] CDN 多线程内核加载失败，回退本地：', e) }
  }

  if (self.crossOriginIsolated) {
    // 1) 本地多线程（主力）：需跨源隔离。部署已强制 COOP/COEP，多数情况命中此层。
    try { await tryLoad(() => mtURLs('/ffmpeg'), '本地多线程'); return }
    catch (e) { console.warn('[media] 本地多线程内核加载失败，回退 CDN 多线程：', e) }
    // 2) CDN 多线程（本地 MT 缺失/损坏时的第一兜底）
    try { await tryLoad(() => mtURLs(CDN_MT), 'CDN 多线程'); return }
    catch (e) { console.warn('[media] CDN 多线程内核加载失败，回退本地单线程：', e) }
  }
  // 3) 本地单线程（无 SharedArrayBuffer 环境的主力兜底；按需下载，不进预缓存）
  try { await tryLoad(() => stURLs('/ffmpeg-st'), '本地单线程'); return }
  catch (e) { console.warn('[media] 本地单线程内核加载失败，回退 CDN 单线程：', e) }
  // 4) CDN 单线程（最后兜底）
  await tryLoad(() => stURLs(CDN_ST), 'CDN 单线程')
}

// 显式触发内核加载（供自检 / 视图预热使用）
export async function ensureMediaCore() {
  await loadCore()
  return coreMode()
}

// 进阶能力所需的底层接口：写输入 + 执行任意参数 + 一次性取回多个输出文件。
// 与 convertMedia 共用同一个 ffmpeg 实例（内核只加载一次）。
export async function writeMediaFile(name, data) {
  await loadCore()
  await ffmpeg.writeFile(name, data)
}
export async function execMedia(args, outFiles = []) {
  await loadCore()
  await ffmpeg.exec(args)
  const out = []
  for (const f of outFiles) {
    const data = await ffmpeg.readFile(f.name)
    out.push({ name: f.name, blob: new Blob([data.buffer], { type: f.mime || 'application/octet-stream' }) })
  }
  return out
}
// 只读回已存在的输出文件（不执行任何命令）。
// 注意：不能用 exec 空参数来"读文件"——ffmpeg 无输入时会打印帮助并以非 0 退出，exec 会 reject。
export async function readMediaFiles(files) {
  const out = []
  for (const f of files) {
    try {
      const data = await ffmpeg.readFile(f.name)
      out.push({ name: f.name, blob: new Blob([data.buffer], { type: f.mime || 'application/octet-stream' }) })
    } catch {
      out.push({ name: f.name, blob: null })
    }
  }
  return out
}
// 删除虚拟文件系统里的临时文件（避免多次操作后堆积）
export async function unlinkMediaFiles(names) {
  for (const n of names) {
    try { await ffmpeg.deleteFile(n) } catch { /* 不存在则忽略 */ }
  }
}
export function coreMode() {
  return { loaded, isolated: !!self.crossOriginIsolated, source: coreSource }
}

// 运行一次转换：writeName 为写入虚拟文件系统的输入名，args 为完整 ffmpeg 参数，
// outName 为输出文件名。返回输出 Blob（type 由调用方指定）。
export async function convertMedia(inputData, inputName, args, outName, outMime) {
  // loadCore() 内部已按「多线程 → 单线程 → CDN」顺序回退，
  // 即使页面未启用跨源隔离（无 SharedArrayBuffer），也会回退到本地单线程内核。
  await loadCore()
  await ffmpeg.writeFile(inputName, inputData)
  await ffmpeg.exec(args)
  const data = await ffmpeg.readFile(outName)
  return new Blob([data.buffer], { type: outMime })
}

// 子项收集：成功记录 detail，失败原样记录 error（message + stack）。
async function addItem(items, id, title, fn) {
  try {
    const detail = await fn()
    items.push({ id, title, ok: true, detail })
  } catch (e) {
    items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
  }
}

// 自检（默认路径：本地MT→CDN-MT→本地ST→CDN-ST 分级兜底）。返回统一结构。
export async function selfTest() {
  const items = []
  await addItem(items, 'load-core', '加载 ffmpeg 内核（分级兜底）', async () => {
    await loadCore()
    return coreSource || (self.crossOriginIsolated ? '多线程' : '单线程')
  })
  await addItem(items, 'mjpeg', 'ffmpeg 编码（mjpeg）', async () => {
    await ffmpeg.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'selftest.jpg'])
    const data = await ffmpeg.readFile('selftest.jpg')
    if (data.byteLength === 0) throw new Error('编码输出为空')
    return data.byteLength + 'B'
  })
  return { module: '媒体', items }
}

// 自检（强制单线程内核）：用于无 SharedArrayBuffer 环境 / 沙箱验证管线可用。返回统一结构。
export async function selfTestST() {
  const st = async (b) => ({
    coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  const f2 = new FFmpeg()
  const items = []
  await addItem(items, 'load-st-core', '加载 ffmpeg 单线程内核', async () => {
    await f2.load(await st('/ffmpeg-st'))
    return '单线程'
  })
  await addItem(items, 'mjpeg', 'ffmpeg 编码（mjpeg）', async () => {
    await f2.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'st.jpg'])
    const data = await f2.readFile('st.jpg')
    if (data.byteLength === 0) throw new Error('编码输出为空')
    return data.byteLength + 'B'
  })
  return { module: '媒体', items }
}

// ---------------------------------------------------------------------------
// 内核策略的全局初始化：URL 参数 > localStorage > 默认 'auto'
//   ?lf-core=cdn   多线程内核走 CDN（不占主机空间，适合有单文件上限的免费主机）
//   ?lf-core=local 强制本地内核
//   ?lf-core=st    单线程
// 该策略在应用启动时应用一次，用户无需改代码即可适配不同托管环境。
// ---------------------------------------------------------------------------
export function initCorePreference() {
  try {
    let choice = ''
    try {
      const u = new URL(self.location.href)
      choice = u.searchParams.get('lf-core') || ''
    } catch { /* ignore */ }
    if (!choice) {
      try { choice = localStorage.getItem('lf-core') || '' } catch { /* ignore */ }
    }
    if (choice) {
      setCorePreference(choice)
      try { localStorage.setItem('lf-core', choice) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return corePreference
}
