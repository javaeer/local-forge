// 批处理队列（B-1）。
//
// 目标：把"一次一个文件"的操作升级为"一次一批"，用统一的队列模型串行执行，
// 逐项进度、可取消、可导出结果（单个下载 / 打包成 ZIP）。
//
// 设计：
//   - OP 注册表：每个操作声明 id / label / accept / 默认参数 / run(file, params, ctx) → {name, blob}
//   - runBatch(files, opId, params, hooks)：串行执行，逐项回调 onItem/onDone
//   - 复用既有引擎（image/archive/pdf/pdfpro/exif），不新增依赖
//
// 预设（PRESETS）是"操作 + 一组参数"的命名组合，方便一键套用。
import { compressImage, resizeImage, watermarkImage } from './image.js'
import { compressPdf } from './pdf.js'
import { createZip } from './archive.js'
import { stripMetadata } from './exif.js'

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i

/* ---------------- 操作注册表 ---------------- */
// run(file, params, ctx) → { name, blob }（blob 为处理结果）
export const OPS = {
  'image-compress': {
    id: 'image-compress',
    label: '图片压缩',
    accept: 'image/*',
    match: (f) => IMG_RE.test(f.name),
    defaults: { outMime: 'image/jpeg', quality: 0.8, losslessPng: false },
    async run(file, p, ctx) {
      const blob = await compressImage(file, p)
      const ext = p.outMime === 'image/png' ? 'png' : p.outMime === 'image/webp' ? 'webp' : 'jpg'
      return { name: file.name.replace(/\.[^.]+$/, '') + '-min.' + ext, blob }
    },
  },
  'image-convert': {
    id: 'image-convert',
    label: '图片转格式',
    accept: 'image/*',
    match: (f) => IMG_RE.test(f.name),
    defaults: { outMime: 'image/webp', quality: 0.9 },
    async run(file, p) {
      const blob = await compressImage(file, p)
      const ext = p.outMime === 'image/png' ? 'png' : p.outMime === 'image/jpeg' ? 'jpg' : 'webp'
      return { name: file.name.replace(/\.[^.]+$/, '') + '.' + ext, blob }
    },
  },
  'exif-clean': {
    id: 'exif-clean',
    label: '清除 EXIF',
    accept: 'image/*',
    match: (f) => /\.(jpe?g|png)$/i.test(f.name),
    defaults: {},
    async run(file) {
      // stripMetadata 返回 {blob, removed, removedBytes, kind}，只取 blob。
      // 曾把整个结果对象当 blob 传给下游 → new File([对象]) 序列化成 "[object Object]"
      // → 后续图片工序解码失败 → 配方结果被过滤为空 → 下载按钮永不出现。
      const { blob } = await stripMetadata(file)
      return { name: file.name.replace(/(\.[^.]+)$/, '-clean$1'), blob }
    },
  },
  'image-resize': {
    id: 'image-resize',
    label: '图片改尺寸',
    accept: 'image/*',
    match: (f) => IMG_RE.test(f.name),
    defaults: { maxEdge: 1600, outMime: 'image/jpeg', quality: 0.85 },
    async run(file, p) {
      const blob = await resizeImage(file, p)
      const ext = p.outMime === 'image/png' ? 'png' : p.outMime === 'image/webp' ? 'webp' : 'jpg'
      return { name: file.name.replace(/\.[^.]+$/, '') + `-${p.maxEdge}.${ext}`, blob }
    },
  },
  'image-watermark': {
    id: 'image-watermark',
    label: '打水印',
    accept: 'image/*',
    match: (f) => IMG_RE.test(f.name),
    defaults: { text: 'LocalForge', position: 'bottom-right', opacity: 0.35, outMime: 'image/png' },
    async run(file, p) {
      const blob = await watermarkImage(file, p)
      const ext = p.outMime === 'image/jpeg' ? 'jpg' : p.outMime === 'image/webp' ? 'webp' : 'png'
      return { name: file.name.replace(/\.[^.]+$/, '') + '-wm.' + ext, blob }
    },
  },
  'pdf-compress': {
    id: 'pdf-compress',
    label: 'PDF 压缩',
    accept: 'application/pdf',
    match: (f) => /\.pdf$/i.test(f.name),
    defaults: { quality: 0.7 },
    async run(file, p) {
      const { blob } = await compressPdf(file, p)
      return { name: file.name.replace(/\.pdf$/i, '') + '-min.pdf', blob }
    },
  },
  'pdf-to-images': {
    id: 'pdf-to-images',
    label: 'PDF → 图片',
    accept: 'application/pdf',
    match: (f) => /\.pdf$/i.test(f.name),
    defaults: { scale: 2, format: 'image/png' },
    async run(file, p, ctx) {
      const { pdfToImages } = await import('./pdfpro.js')
      const pages = await pdfToImages(file, p)
      // 队列约定：一次 run 只产出一个结果。多页 PDF 这里只放第一页，
      // 完整多页导出由"打包为 ZIP"入口处理（见 runBatchZip）。
      const first = pages[0]
      return { name: file.name.replace(/\.pdf$/i, '') + '-p1.png', blob: first.blob }
    },
  },
  'zip-pack': {
    id: 'zip-pack',
    label: '打包为 ZIP',
    accept: '*',
    match: () => true,
    defaults: { level: 6 },
    async run(file, p, ctx) {
      const blob = await createZip([file], { level: p.level, onprogress: ctx && ctx.onProgress && ((r) => ctx.onProgress(r / 100)) })
      return { name: file.name.replace(/\.[^.]+$/, '') + '.zip', blob }
    },
  },
}

export const OP_LIST = Object.values(OPS)

/* ---------------- 预设（操作 + 参数命名组合） ---------------- */
export const PRESETS = [
  { id: 'web-optimize', label: '网页优化（转 JPG 80%）', op: 'image-compress', params: { outMime: 'image/jpeg', quality: 0.8 } },
  { id: 'webp-max', label: 'WebP 高质量（90%）', op: 'image-convert', params: { outMime: 'image/webp', quality: 0.9 } },
  { id: 'tiny', label: '极限压缩（JPG 60%）', op: 'image-compress', params: { outMime: 'image/jpeg', quality: 0.6 } },
  { id: 'privacy', label: '隐私清理（去 EXIF）', op: 'exif-clean', params: {} },
  { id: 'resize-1080', label: '改尺寸（长边 1080）', op: 'image-resize', params: { maxEdge: 1080, outMime: 'image/jpeg', quality: 0.85 } },
  { id: 'resize-800', label: '改尺寸（长边 800，省流量）', op: 'image-resize', params: { maxEdge: 800, outMime: 'image/jpeg', quality: 0.82 } },
  { id: 'watermark', label: '加文字水印', op: 'image-watermark', params: { text: 'LocalForge', position: 'bottom-right', opacity: 0.35 } },
  { id: 'pdf-shrink', label: 'PDF 瘦身（70%）', op: 'pdf-compress', params: { quality: 0.7 } },
  { id: 'pack', label: '逐个打包 ZIP', op: 'zip-pack', params: { level: 6 } },
]

/* ---------------- 队列执行 ---------------- */
// files: File[]；opId；params；hooks: { onItem({index,total,file,status,progress,result,error}), shouldCancel() }
// 返回 { results: [{name, blob, ok, error}], cancelled }
export async function runBatch(files, opId, params = {}, hooks = {}) {
  const op = OPS[opId]
  if (!op) throw new Error('未知批处理操作：' + opId)
  const total = files.length
  const results = []
  let cancelled = false

  for (let i = 0; i < total; i++) {
    if (hooks.shouldCancel && hooks.shouldCancel()) { cancelled = true; break }
    const file = files[i]
    hooks.onItem && hooks.onItem({ index: i, total, file, status: 'running', progress: 0 })
    try {
      const { name, blob } = await op.run(file, { ...op.defaults, ...params }, {
        onProgress: (r) => hooks.onItem && hooks.onItem({ index: i, total, file, status: 'running', progress: r }),
      })
      const item = { name, blob, ok: true, src: file.name }
      results.push(item)
      hooks.onItem && hooks.onItem({ index: i, total, file, status: 'done', progress: 1, result: item })
    } catch (e) {
      const item = { name: file.name, blob: null, ok: false, error: e.message || String(e), src: file.name }
      results.push(item)
      hooks.onItem && hooks.onItem({ index: i, total, file, status: 'error', error: item.error })
    }
  }
  hooks.onDone && hooks.onDone({ results, cancelled })
  return { results, cancelled }
}

// 按操作过滤可处理的文件（用于"拖入混合文件"时自动筛出可处理项）
export function filterAcceptable(files, opId) {
  const op = OPS[opId]
  if (!op) return files
  return files.filter((f) => op.match(f))
}
