// 文件类型识别：用于“最近处理”按类型筛选、图标与分色。
// 纯按扩展名归类，不读文件内容（零成本、零上传）。
const EXT_MAP = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma'],
  pdf: ['pdf'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'apk', 'jar', 'dmg', 'wim', 'ipsw'],
  text: ['txt', 'json', 'csv', 'md', 'xml', 'html', 'js', 'ts', 'css', 'yml', 'yaml', 'log', 'sql', 'svg'],
}

const EXT_TO_TYPE = {}
for (const [type, exts] of Object.entries(EXT_MAP)) {
  for (const e of exts) EXT_TO_TYPE[e] = type
}

export function extOf(name) {
  const base = (name || '').split(/[?#]/)[0]
  const dot = base.lastIndexOf('.')
  // dot <= 0 视为无扩展名（含以 . 开头的隐藏文件，如 .gitignore）
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

// 返回 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'text' | 'other'
export function typeOfName(name) {
  const e = extOf(name)
  return EXT_TO_TYPE[e] || 'other'
}

export const TYPE_META = {
  image: { icon: 'bi-file-earmark-image', color: 'var(--accent-2, #34d399)' },
  video: { icon: 'bi-file-earmark-play', color: '#f59e0b' },
  audio: { icon: 'bi-file-earmark-music', color: '#a78bfa' },
  pdf: { icon: 'bi-file-earmark-pdf', color: '#ef4444' },
  archive: { icon: 'bi-file-earmark-zip', color: '#38bdf8' },
  text: { icon: 'bi-file-earmark-text', color: '#93a2bd' },
  other: { icon: 'bi-file-earmark', color: '#6b7a96' },
}

// 供“最近处理”筛选使用的顺序与 i18n key
export const FILTER_ORDER = ['all', 'image', 'video', 'audio', 'pdf', 'archive', 'text']
export const FILTER_LABEL_KEY = {
  all: 'home.filterAll',
  image: 'home.filterImage',
  video: 'home.filterVideo',
  audio: 'home.filterAudio',
  pdf: 'home.filterPdf',
  archive: 'home.filterArchive',
  text: 'home.filterText',
}
