// 音视频转换（纯前端，基于 @ffmpeg/ffmpeg 多线程内核）。
// 优先级：本地多线程内核 /ffmpeg（需 SharedArrayBuffer）→ 本地单线程内核 /ffmpeg-st
// （不需跨源隔离，兼容性最好）→ CDN 多线程。单线程回退保证无 SharedArrayBuffer 的浏览器也能用。
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
let loaded = false

export function onProgress(cb) {
  ffmpeg.on('progress', ({ progress: p }) => { if (p && p > 0 && p < 1) cb(Math.round(p * 100)) })
}

async function loadCore() {
  if (loaded) return
  const mt = async (b) => ({
    coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(`${b}/ffmpeg-core.worker.js`, 'text/javascript'),
  })
  const st = async (b) => ({
    coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  // 1) 多线程（需跨源隔离）
  if (self.crossOriginIsolated) {
    try { await ffmpeg.load(await mt('/ffmpeg')); loaded = true; return }
    catch { /* fall through */ }
  }
  // 2) 单线程（兼容性好，无需 SharedArrayBuffer）
  try { await ffmpeg.load(await st('/ffmpeg-st')); loaded = true; return }
  catch { /* fall through */ }
  // 3) CDN 多线程
  await ffmpeg.load(await mt('https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'))
  loaded = true
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

// 自检（默认路径：优先多线程，无 SharedArrayBuffer 时单线程回退）。
export async function selfTest() {
  await loadCore()
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'selftest.jpg'])
  const data = await ffmpeg.readFile('selftest.jpg')
  return { ok: data.byteLength > 0, outSize: data.byteLength }
}

// 自检（强制单线程内核）：用于无 SharedArrayBuffer 环境 / 沙箱验证管线可用。
export async function selfTestST() {
  const st = async (b) => ({
    coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  const f2 = new FFmpeg()
  await f2.load(await st('/ffmpeg-st'))
  await f2.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'st.jpg'])
  const data = await f2.readFile('st.jpg')
  return { ok: data.byteLength > 0, outSize: data.byteLength }
}
