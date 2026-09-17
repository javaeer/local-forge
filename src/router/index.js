import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import ZipCompress from '../views/ZipCompress.vue'
import ZipExtract from '../views/ZipExtract.vue'
import ArchiveTool from '../views/ArchiveTool.vue'
import MediaConvert from '../views/MediaConvert.vue'
import ImageConvert from '../views/ImageConvert.vue'
import PdfTools from '../views/PdfTools.vue'
import ShareFiles from '../views/ShareFiles.vue'
import PasswordRecovery from '../views/PasswordRecovery.vue'
import Repair from '../views/Repair.vue'

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/zip-compress', name: 'zip-compress', component: ZipCompress, meta: { title: '压缩为 ZIP' } },
  { path: '/zip-extract', name: 'zip-extract', component: ZipExtract, meta: { title: '解压 ZIP' } },
  { path: '/archive', name: 'archive', component: ArchiveTool, meta: { title: '归档工具箱' } },
  { path: '/media-convert', name: 'media-convert', component: MediaConvert, meta: { title: '媒体转换' } },
  { path: '/image-convert', name: 'image-convert', component: ImageConvert, meta: { title: '图片工具' } },
  { path: '/pdf-tools', name: 'pdf-tools', component: PdfTools, meta: { title: 'PDF 工具' } },
  { path: '/share-files', name: 'share-files', component: ShareFiles, meta: { title: 'P2P 分享' } },
  { path: '/password-recovery', name: 'password-recovery', component: PasswordRecovery, meta: { title: '密码恢复' } },
  { path: '/repair', name: 'repair', component: Repair, meta: { title: '修复归档' } },
]

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
