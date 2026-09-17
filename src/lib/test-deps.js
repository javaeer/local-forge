// 仅用于 E2E 测试：把裸模块名通过 Vite 解析后重导出，供 page.evaluate 内 import('/src/lib/test-deps.js') 使用。
// 该文件不被应用代码引用，生产构建会被 tree-shaking 剔除。
export { PDFDocument } from 'pdf-lib'
export * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
export { workerUrl }
