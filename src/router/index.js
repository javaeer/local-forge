import { createRouter, createWebHistory } from 'vue-router'
import { NAV } from '../lib/nav.js'

// 路由级懒加载：各视图改为动态 import，首屏只加载 Home，
// ffmpeg / OCR 等重量视图在用户真正进入时才按需拉取，显著降低首屏 JS 体积。
const views = {
  Home: () => import('../views/Home.vue'),
  ZipCompress: () => import('../views/ZipCompress.vue'),
  ZipExtract: () => import('../views/ZipExtract.vue'),
  ArchiveTool: () => import('../views/ArchiveTool.vue'),
  MediaConvert: () => import('../views/MediaConvert.vue'),
  MediaPro: () => import('../views/MediaPro.vue'),
  ImageConvert: () => import('../views/ImageConvert.vue'),
  BatchQueue: () => import('../views/BatchQueue.vue'),
  DocConvert: () => import('../views/DocConvert.vue'),
  PdfTools: () => import('../views/PdfTools.vue'),
  PdfPro: () => import('../views/PdfPro.vue'),
  ShareFiles: () => import('../views/ShareFiles.vue'),
  PasswordRecovery: () => import('../views/PasswordRecovery.vue'),
  Repair: () => import('../views/Repair.vue'),
  QrCode: () => import('../views/QrCode.vue'),
  HashTool: () => import('../views/HashTool.vue'),
  ExifTool: () => import('../views/ExifTool.vue'),
  TextTool: () => import('../views/TextTool.vue'),
  OcrTool: () => import('../views/OcrTool.vue'),
  SvgTool: () => import('../views/SvgTool.vue'),
  CssReference: () => import('../views/CssReference.vue'),
  About: () => import('../views/About.vue'),
  Privacy: () => import('../views/Privacy.vue'),
}

// 视图文件名 -> 路由 path（与 NAV + SelfTestPanel 的 VIEW_ROUTES 保持一致）
const fileToPath = {
  'Home.vue': '/',
  'ZipCompress.vue': '/zip-compress',
  'ZipExtract.vue': '/zip-extract',
  'ArchiveTool.vue': '/archive',
  'MediaConvert.vue': '/media-convert',
  'MediaPro.vue': '/media-pro',
  'ImageConvert.vue': '/image-convert',
  'BatchQueue.vue': '/batch',
  'DocConvert.vue': '/doc-convert',
  'PdfTools.vue': '/pdf-tools',
  'PdfPro.vue': '/pdf-pro',
  'ShareFiles.vue': '/share-files',
  'PasswordRecovery.vue': '/password-recovery',
  'Repair.vue': '/repair',
  'QrCode.vue': '/qr-code',
  'HashTool.vue': '/hash',
  'ExifTool.vue': '/exif',
  'TextTool.vue': '/text',
  'OcrTool.vue': '/ocr',
  'SvgTool.vue': '/svg-tool',
  'CssReference.vue': '/css-reference',
  'About.vue': '/about',
  'Privacy.vue': '/privacy',
}

const routes = Object.entries(fileToPath).map(([file, path]) => ({
  path,
  name: path === '/' ? 'home' : path.slice(1),
  component: views[file.replace('.vue', '')],
  meta: { title: (NAV.find((n) => n.path === path) || {}).title || '', icon: (NAV.find((n) => n.path === path) || {}).icon || '' },
}))

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// 同步页面标题
router.afterEach((to) => {
  const t = to.meta && to.meta.title ? `LocalForge · ${to.meta.title}` : 'LocalForge'
  document.title = t
})

export default router
