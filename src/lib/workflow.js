// 跨工具工作流：注册“结果 → 下一步”的可达路径，并在内存中传递文件。
// 设计：
//  - FLOWS[fromTool] = [{ to, label }...]，label 为词条 key（wf.*），由视图渲染为“下一步”按钮
//  - pendingFiles 为模块级内存 store（不落盘，页面刷新即清，符合零上传叙事）
//  - goNext(router, fromPath, files) 负责写入 pending 并跳转
import { ref } from 'vue'

// 工具标识：用 NAV 路径作为 key，直观且与路由一致
export const FLOWS = {
  '/zip-extract': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/pdf-tools', labelKey: 'wf.toPdf' },
    { to: '/hash', labelKey: 'wf.toHash' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/archive': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/pdf-tools', labelKey: 'wf.toPdf' },
    { to: '/hash', labelKey: 'wf.toHash' },
  ],
  '/image-convert': [
    { to: '/zip-compress', labelKey: 'wf.toZip' },
    { to: '/pdf-pro?tab=img2pdf', labelKey: 'wf.toImgPdf' },
    { to: '/qr-code', labelKey: 'wf.toQr' },
    { to: '/exif', labelKey: 'wf.toExif' },
  ],
  '/exif': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/pdf-tools': [
    { to: '/ocr?tab=pdf', labelKey: 'wf.toOcr' },
    { to: '/pdf-pro?tab=pdf2img', labelKey: 'wf.toPdf2img' },
  ],
  '/pdf-pro': [
    { to: '/pdf-tools', labelKey: 'wf.toPdfTools' },
    { to: '/ocr?tab=pdf', labelKey: 'wf.toOcr' },
  ],
  '/media-convert': [
    { to: '/media-pro?tab=gif', labelKey: 'wf.toGif' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/media-pro': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/ocr': [
    { to: '/text', labelKey: 'wf.toText' },
  ],
  '/qr-code': [
    { to: '/text', labelKey: 'wf.toText' },
  ],
  '/text': [
    { to: '/qr-code', labelKey: 'wf.toQr' },
  ],
}

export function flowsFrom(path) {
  const clean = path.split('?')[0]
  return FLOWS[clean] || []
}

// ---------- 文件传递（内存，仅当前会话） ----------
export const pendingFiles = ref([])
export const pendingFrom = ref('')
export const pendingText = ref('')

export function stashFiles(files, fromPath) {
  pendingFiles.value = Array.from(files || [])
  pendingFrom.value = fromPath || ''
  pendingText.value = ''
}

export function stashText(text, fromPath) {
  pendingText.value = text || ''
  pendingFiles.value = []
  pendingFrom.value = fromPath || ''
}

export function takeFiles() {
  const files = pendingFiles.value
  pendingFiles.value = []
  return files
}

export function consumePending() {
  if (!pendingFiles.value.length) return null
  const files = pendingFiles.value
  const from = pendingFrom.value
  pendingFiles.value = []
  pendingFrom.value = ''
  return { files, from }
}

// 消费传递来的文本（供文本工具/二维码生成使用）
export function consumePendingText() {
  if (!pendingText.value) return null
  const text = pendingText.value
  const from = pendingFrom.value
  pendingText.value = ''
  pendingFrom.value = ''
  return { text, from }
}

// 工作流词条（避免 i18n 循环依赖，直接内置 5 语言）。
// 注意：必须 5 语言齐全，否则 ja/ko/es 下会回退中文，破坏多语言目标。
export const WF_LABELS = {
  'wf.toImage': { 'zh-CN': '送去图片工具', en: 'Send to Image Tools', 'ja-JP': '画像ツールへ送る', 'ko-KR': '이미지 도구로 보내기', 'es-ES': 'Enviar a Herramientas de imagen' },
  'wf.toPdf': { 'zh-CN': '送去 PDF 工具', en: 'Send to PDF Tools', 'ja-JP': 'PDFツールへ送る', 'ko-KR': 'PDF 도구로 보내기', 'es-ES': 'Enviar a Herramientas PDF' },
  'wf.toZip': { 'zh-CN': '打包为 ZIP', en: 'Pack as ZIP', 'ja-JP': 'ZIPにまとめる', 'ko-KR': 'ZIP으로 묶기', 'es-ES': 'Empaquetar en ZIP' },
  'wf.toHash': { 'zh-CN': '校验哈希', en: 'Verify hashes', 'ja-JP': 'ハッシュ検証', 'ko-KR': '해시 검증', 'es-ES': 'Verificar hashes' },
  'wf.toImgPdf': { 'zh-CN': '合成 PDF', en: 'Merge into PDF', 'ja-JP': 'PDFに合成', 'ko-KR': 'PDF로 합치기', 'es-ES': 'Combinar en PDF' },
  'wf.toQr': { 'zh-CN': '生成二维码', en: 'Make QR code', 'ja-JP': 'QRコード生成', 'ko-KR': 'QR 코드 만들기', 'es-ES': 'Crear código QR' },
  'wf.toExif': { 'zh-CN': '清理隐私信息', en: 'Clean privacy data', 'ja-JP': 'プライバシー情報を削除', 'ko-KR': '개인정보 삭제', 'es-ES': 'Eliminar datos privados' },
  'wf.toOcr': { 'zh-CN': '送去 OCR 识别', en: 'Send to OCR', 'ja-JP': 'OCRへ送る', 'ko-KR': 'OCR로 보내기', 'es-ES': 'Enviar a OCR' },
  'wf.toPdfTools': { 'zh-CN': '送去 PDF 工具', en: 'Send to PDF Tools', 'ja-JP': 'PDFツールへ送る', 'ko-KR': 'PDF 도구로 보내기', 'es-ES': 'Enviar a Herramientas PDF' },
  'wf.toPdf2img': { 'zh-CN': '转为图片', en: 'Convert to images', 'ja-JP': '画像に変換', 'ko-KR': '이미지로 변환', 'es-ES': 'Convertir a imágenes' },
  'wf.toGif': { 'zh-CN': '转为 GIF', en: 'Convert to GIF', 'ja-JP': 'GIFに変換', 'ko-KR': 'GIF로 변환', 'es-ES': 'Convertir a GIF' },
  'wf.toText': { 'zh-CN': '送去文本工具', en: 'Send to Text Tools', 'ja-JP': 'テキストツールへ送る', 'ko-KR': '텍스트 도구로 보내기', 'es-ES': 'Enviar a Herramientas de texto' },
}

export function wfLabel(labelKey, locale) {
  const map = WF_LABELS[labelKey]
  if (!map) return labelKey
  return map[locale] || map['zh-CN']
}
