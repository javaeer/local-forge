// 首页「任务化」入口词条（五语），按 i18n.dev.js 的独立拆包约定。
// 任务卡标题 / 工序标题分别来自本包与 formats.js：本包只负责「任务名 + 引导语」。
export const TASKS_MESSAGES = {
  'zh-CN': {
    task: {
      pack: { title: '打包与解压', desc: '压缩、分卷、加密、格式互转与提取' },
      convert: { title: '转换格式', desc: '图片、音视频、PDF、文档一键互转' },
      extract: { title: '识别与提取', desc: 'OCR 认字、哈希校验、隐私清理' },
      knowledge: { title: '查阅知识', desc: '词典、诗文格律、中医典籍离线可查' },
      allTools: '浏览全部 55 道工序（按功能查找）',
      cmdCta: '⌘K 搜索所有工具',
      recentCta: '继续上次的处理',
    },
  },
  en: {
    task: {
      pack: { title: 'Pack & Unpack', desc: 'Compress, split, encrypt, convert and extract archives' },
      convert: { title: 'Convert formats', desc: 'Images, audio, video, PDF and documents in one click' },
      extract: { title: 'Recognize & Extract', desc: 'OCR text, hash checks and privacy cleanup' },
      knowledge: { title: 'Explore knowledge', desc: 'Dictionaries, poetic meters and TCM classics, fully offline' },
      allTools: 'Browse all 55 processes (find by function)',
      cmdCta: '⌘K Search all tools',
      recentCta: 'Continue last job',
    },
  },
  'ja-JP': {
    task: {
      pack: { title: '梱包と展開', desc: '圧縮・分割・暗号化・形式変換と展開' },
      convert: { title: '形式変換', desc: '画像・音声・動画・PDF・ドキュメントを相互変換' },
      extract: { title: '認識と抽出', desc: 'OCR 文字起こし、ハッシュ検証、プライバシー削除' },
      knowledge: { title: '知識を調べる', desc: '辞書・詩の格律・中医古籍をオフラインで検索' },
      allTools: '55 すべての工程を見る（機能から探す）',
      cmdCta: '⌘K すべてのツールを検索',
      recentCta: '前回の処理を続ける',
    },
  },
  'ko-KR': {
    task: {
      pack: { title: '압축과 해제', desc: '압축·분할·암호화·형식 변환과 추출' },
      convert: { title: '형식 변환', desc: '이미지·오디오·비디오·PDF·문서 원클릭 변환' },
      extract: { title: '인식과 추출', desc: 'OCR 문자 인식, 해시 검증, 개인정보 정리' },
      knowledge: { title: '지식 조회', desc: '사전·시운율·한의 고전 오프라인 검색' },
      allTools: '55개 전체 공정 보기(기능별 찾기)',
      cmdCta: '⌘K 모든 도구 검색',
      recentCta: '이전 작업 이어하기',
    },
  },
  'es-ES': {
    task: {
      pack: { title: 'Empaquetar y extraer', desc: 'Comprimir, dividir, cifrar, convertir y extraer' },
      convert: { title: 'Convertir formatos', desc: 'Imágenes, audio, vídeo, PDF y documentos en un clic' },
      extract: { title: 'Reconocer y extraer', desc: 'OCR, verificación de hash y limpieza de privacidad' },
      knowledge: { title: 'Consultar conocimientos', desc: 'Diccionario, métrica poética y clásicos de TCM sin conexión' },
      allTools: 'Ver las 55 herramientas (buscar por función)',
      cmdCta: '⌘K Buscar todas las herramientas',
      recentCta: 'Continuar el último trabajo',
    },
  },
}
