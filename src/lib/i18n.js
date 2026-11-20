// 零依赖 i18n 内核：中/英词条 + 响应式 locale + 插值 + localStorage 持久化。
// 设计原则：
//  - 不引库（vue-i18n 对本项目属超配），用 Vue ref 实现响应式
//  - 词条按命名空间组织，t('nav.home') 形式访问，缺失时回退中文并 console.warn（开发期可见）
//  - 视图渐进接入：外壳/首页/导航先行，业务视图后续按需替换
import { ref, computed } from 'vue'

const LOCALE_KEY = 'lf-locale'

const messages = {
  'zh-CN': {
    app: {
      brand: 'LocalForge',
      search: '搜索工具',
      searchHint: '搜索工具 (Ctrl+K)',
      allTools: '全部工具',
      all: '全部',
      localBadge: '本地处理 · 零上传',
      lightMode: '浅色模式',
      darkMode: '深色模式',
      toSidebar: '切换到侧栏导航',
      toTopbar: '切回顶栏导航',
      closeMenu: '关闭菜单',
      openMenu: '打开菜单',
      expandSidebar: '展开侧栏',
      mainNav: '主导航',
      quickNav: '快捷导航',
      searchPlaceholder: '搜索工具…（如 二维码 / zip / ocr）',
      noResults: '没有匹配的工具',
      keySelect: '选择',
      keyOpen: '打开',
      keyClose: '关闭',
    },
    nav: {
      home: '首页',
      zipCompress: '压缩为 ZIP',
      zipCompressShort: '压缩',
      zipExtract: '解压 ZIP',
      zipExtractShort: '解压',
      archive: '归档工具箱',
      passwordRecovery: 'ZIP 密码恢复',
      repair: '修复归档',
      mediaConvert: '媒体转换',
      mediaConvertShort: '媒体',
      mediaPro: '音视频进阶',
      imageConvert: '图片工具',
      imageConvertShort: '图片',
      batch: '批处理队列',
      batchShort: '批量',
      pdfTools: 'PDF 工具',
      pdfToolsShort: 'PDF',
      pdfPro: 'PDF 进阶',
      qrCode: '二维码工具箱',
      qrCodeShort: '二维码',
      ocr: 'OCR 文字识别',
      ocrShort: 'OCR',
      hash: '文件哈希校验',
      hashShort: '哈希',
      exif: '照片隐私清理',
      text: '文本 / 编码工具箱',
      docConvert: '文档转换',
      docConvertShort: '文档',
      wechatArticle: '公众号排版',
      wechatArticleShort: '公众号',
      appIcon: 'App 图标生成器', appIconShort: 'App 图标',
      shareFiles: 'P2P 分享文件',
      about: '关于',
      privacy: '隐私协议',
    },
    group: {
      common: '常用',
      archive: '压缩 / 归档',
      media: '媒体',
      image: '图片',
      pdf: 'PDF',
      qr: '二维码 / 识别',
      verify: '校验 / 隐私',
      share: '分享 / 安全',
      about: '关于',
    },
    home: {
      note: { lookup: '词典、格律、诗文与中医经典——都是可离线检索的本地知识原料，随时取用、不联网也能查。' },
      badge: '纯浏览器端 · 原料零外流',
      title: '你的本地工坊',
      sub: '一座装在你浏览器里的本地工坊。文件、数据与知识都是原料，56 道工序在本地锤炼成可用成果——原料进、成品出，全程不出本机。',
      pillLocal: '零上传 · 纯本地',
      pillThread: '多线程锻造',
      pillFormats: '200+ 归档格式',
      pillP2p: 'P2P 直传',
      howtoTitle: '怎么开工？三步走',
      howto1: '在下方选一道工序（如「压缩为 ZIP」「图片工具」）。',
      howto2: '把原料拖进页面的投料区，或点击「选择文件」（文件不会上传）。',
      howto3: '按提示设置选项，点「开始锻造」，成品直接下载即可。',
      howtoNote: '所有操作都在本地完成；页面底部的「测试回显面板」可一键自检各功能是否正常。',
      recent: '最近处理',
      clear: '清空',
      justNow: '刚刚',
      minAgo: '{n} 分钟前',
      hourAgo: '{n} 小时前',
      dayAgo: '{n} 天前',
      filterAll: '全部',
      filterImage: '图片',
      filterVideo: '视频',
      filterAudio: '音频',
      filterPdf: 'PDF',
      filterArchive: '压缩包',
      filterText: '文本/其他',
      recentEmpty: '还没有记录。处理并下载一个文件后，这里会显示最近操作。',
    },
    footer: {
      note: '纯前端实现 · 文件全程在浏览器本地处理，不上传任何服务器 · 由 zip.js · libarchive.js · ffmpeg.wasm 驱动',
    },
    wf: {
      nextStep: '下一步',
      sendTo: '发送到',
    },
    progress: {
      done: '完成',
    },
    offline: {
      title: '离线内核',
      desc: '把这些内核与数据包（词典、诗文、中医经典）下载到本地缓存，之后断网也能直接使用对应工具和阅读数据。不用的话无需下载——按需拉取，不占首装体积。',
      unsupported: '当前环境不支持 Service Worker，无法预缓存内核（请使用 HTTPS 或 localhost 访问）。',
      fetch: '下载',
      fetchAll: '全部下载',
      cached: '已就绪',
      ready: '离线可用',
      clear: '清空缓存',
      cleared: '已清空内核缓存。',
      done: '已缓存 {n} 个文件（{size}）。',
      failed: '预缓存未完成，请检查网络后重试。',
    },
  },

  en: {
    app: {
      brand: 'LocalForge',
      search: 'Search tools',
      searchHint: 'Search tools (Ctrl+K)',
      allTools: 'All tools',
      all: 'All',
      localBadge: 'Local · Zero upload',
      lightMode: 'Light mode',
      darkMode: 'Dark mode',
      toSidebar: 'Switch to sidebar',
      toTopbar: 'Back to top bar',
      closeMenu: 'Close menu',
      openMenu: 'Open menu',
      expandSidebar: 'Expand sidebar',
      mainNav: 'Main navigation',
      quickNav: 'Quick navigation',
      searchPlaceholder: 'Search tools… (e.g. QR / zip / ocr)',
      noResults: 'No matching tools',
      keySelect: 'Select',
      keyOpen: 'Open',
      keyClose: 'Close',
    },
    nav: {
      home: 'Home',
      zipCompress: 'Compress to ZIP',
      zipCompressShort: 'ZIP',
      zipExtract: 'Extract ZIP',
      zipExtractShort: 'Extract',
      archive: 'Archive Toolkit',
      passwordRecovery: 'ZIP Password Recovery',
      repair: 'Repair Archive',
      mediaConvert: 'Media Convert',
      mediaConvertShort: 'Media',
      mediaPro: 'Media Pro',
      imageConvert: 'Image Tools',
      imageConvertShort: 'Image',
      batch: 'Batch Queue',
      batchShort: 'Batch',
      pdfTools: 'PDF Tools',
      pdfToolsShort: 'PDF',
      pdfPro: 'PDF Pro',
      qrCode: 'QR Code Studio',
      qrCodeShort: 'QR',
      ocr: 'OCR Text Recognition',
      ocrShort: 'OCR',
      hash: 'File Hash Check',
      hashShort: 'Hash',
      exif: 'Photo Privacy Cleaner',
      text: 'Text / Encoding Tools',
      docConvert: 'Doc Convert',
      docConvertShort: 'Doc',
      wechatArticle: 'WeChat Article',
      wechatArticleShort: 'WeChat',
      appIcon: 'App Icon Generator', appIconShort: 'App Icon',
      shareFiles: 'P2P File Share',
      about: 'About',
      privacy: 'Privacy',
    },
    group: {
      common: 'Common',
      archive: 'Archive',
      media: 'Media',
      image: 'Image',
      pdf: 'PDF',
      qr: 'QR / Recognition',
      verify: 'Verify / Privacy',
      share: 'Share / Security',
      about: 'About',
    },
    home: {
      note: { lookup: 'Dictionaries, verse meters, poetry and TCM classics — offline-searchable local knowledge, always at hand and usable without a network.' },
      badge: 'Runs entirely in your browser · Nothing leaves',
      title: 'Your Local Workshop',
      sub: 'A workshop inside your browser. Files, data and knowledge are raw materials — 56 local processes forge them into usable results. Materials in, finished work out, nothing ever leaves your device.',
      pillLocal: 'Zero upload · Fully local',
      pillThread: 'Multi-threaded forging',
      pillFormats: '200+ archive formats',
      pillP2p: 'P2P transfer',
      howtoTitle: 'Ready to forge? Three steps',
      howto1: 'Pick a process below (e.g. "Compress to ZIP", "Image Tools").',
      howto2: 'Drop raw material into the feed zone or click "Choose files" (nothing is uploaded).',
      howto3: 'Set options, hit "Start forging", and download the finished result.',
      howtoNote: 'Everything runs locally; the "Self-test panel" at the bottom can verify all modules in one click.',
      recent: 'Recent activity',
      clear: 'Clear',
      justNow: 'just now',
      minAgo: '{n} min ago',
      hourAgo: '{n} h ago',
      dayAgo: '{n} d ago',
      filterAll: 'All',
      filterImage: 'Image',
      filterVideo: 'Video',
      filterAudio: 'Audio',
      filterPdf: 'PDF',
      filterArchive: 'Archive',
      filterText: 'Text/Other',
      recentEmpty: 'No records yet. Process and download a file and it will show up here.',
    },
    footer: {
      note: 'Pure front-end · Files are processed locally in your browser, never uploaded · Powered by zip.js · libarchive.js · ffmpeg.wasm',
    },
    wf: {
      nextStep: 'Next step',
      sendTo: 'Send to',
    },
    progress: {
      done: 'Done',
    },
    offline: {
      title: 'Offline Cores',
      desc: 'Download these cores and data packs (dictionaries, poetry, TCM classics) into the local cache so the matching tools and data keep working with no network. Nothing is downloaded unless you ask.',
      unsupported: 'Service Worker is unavailable here, so cores cannot be precached (use HTTPS or localhost).',
      fetch: 'Download',
      fetchAll: 'Download all',
      cached: 'Ready',
      ready: 'Offline ready',
      clear: 'Clear cache',
      cleared: 'Core cache cleared.',
      done: 'Cached {n} files ({size}).',
      failed: 'Precache did not finish. Check your network and retry.',
    },
  },

  'ja-JP': {
    app: {
      brand: 'LocalForge', search: 'ツールを検索', searchHint: 'ツールを検索 (Ctrl+K)', allTools: 'すべてのツール', all: 'すべて',
      localBadge: 'ローカル処理 · アップロードなし', lightMode: 'ライトモード', darkMode: 'ダークモード',
      toSidebar: 'サイドバーに切替', toTopbar: 'トップバーに戻す', closeMenu: 'メニューを閉じる', openMenu: 'メニューを開く',
      expandSidebar: 'サイドバーを展開', mainNav: 'メインナビ', quickNav: 'クイックナビ',
      searchPlaceholder: 'ツールを検索…（例：QR / zip / ocr）',
      noResults: '一致するツールがありません',
      keySelect: '選択',
      keyOpen: '開く',
      keyClose: '閉じる',
    },
    nav: {
      home: 'ホーム', zipCompress: 'ZIP に圧縮', zipCompressShort: '圧縮', zipExtract: 'ZIP を解凍', zipExtractShort: '解凍',
      archive: 'アーカイブツール', passwordRecovery: 'ZIP パスワード復元', repair: 'アーカイブ修復',
      mediaConvert: 'メディア変換', mediaConvertShort: 'メディア', mediaPro: 'メディア応用', imageConvert: '画像ツール', imageConvertShort: '画像',
      batch: 'バッチ処理', batchShort: 'バッチ', pdfTools: 'PDF ツール', pdfToolsShort: 'PDF', pdfPro: 'PDF 応用',
      qrCode: 'QR コードツール', qrCodeShort: 'QR', ocr: 'OCR 文字認識', ocrShort: 'OCR', hash: 'ハッシュ検証', hashShort: 'ハッシュ',
      exif: '写真プライバシー', text: 'テキスト / エンコード', docConvert: 'ドキュメント変換', docConvertShort: '文書', wechatArticle: 'WeChat 記事レイアウト', wechatArticleShort: 'WeChat',
      appIcon: 'App アイコン生成', appIconShort: 'App アイコン',
      shareFiles: 'P2P ファイル共有', about: '概要', privacy: 'プライバシー',
    },
    group: {
      common: 'よく使う', archive: '圧縮 / アーカイブ', media: 'メディア', image: '画像', pdf: 'PDF',
      qr: 'QR / 認識', verify: '検証 / プライバシー', share: '共有 / 安全', about: '概要',
    },
    home: {
      note: { lookup: '辞書・格律・詩文・中医古典——すべてオフライン检索できるローカル知識の原料です。ネットワークなしでもいつでも調べられます。' },
      badge: 'ブラウザ完結 · 素材は外に出ません', title: 'あなたのローカル工房', sub: 'ブラウザの中にあるローカル工房。ファイル・データ・知識はすべて素材で、56 の工程がローカルで鍛え上げて使える成果にします。素材を入れて成品を出す、すべて端末内で完結。',
      pillLocal: 'アップロードなし · 完全ローカル', pillThread: 'マルチスレッド鍛造', pillFormats: '200+ アーカイブ形式', pillP2p: 'P2P 直接転送',
      howtoTitle: '鍛造のはじめ方は 3 ステップ', howto1: '下から工程を選びます（例：ZIP に圧縮、画像ツール）。', howto2: '素材を投入エリアにドラッグ、または選択（アップロードされません）。', howto3: 'オプションを設定して「鍛造を開始」をクリックし、完成品をダウンロード。',
      howtoNote: 'すべてローカルで実行されます。下部の「セルフテスト」で各機能を一括検証できます。',
      recent: '最近の処理', clear: 'クリア', justNow: 'たった今', minAgo: '{n} 分前', hourAgo: '{n} 時間前', dayAgo: '{n} 日前',
      filterAll: 'すべて', filterImage: '画像', filterVideo: '動画', filterAudio: '音声', filterPdf: 'PDF', filterArchive: 'アーカイブ', filterText: 'テキスト/その他',
      recentEmpty: 'まだ記録がありません。ファイルを処理してダウンロードするとここに表示されます。',
    },
    footer: { note: '純フロントエンド · ファイルはブラウザ内で処理され、サーバーへ送信されません · zip.js · libarchive.js · ffmpeg.wasm 搭載' },
    wf: { nextStep: '次のステップ', sendTo: '送信先' },
    progress: { done: '完了' },
    offline: {
      title: 'オフラインコア', desc: 'WASM コアとデータパック（辞書・詩文・中医古典）をローカルにキャッシュすると、オフラインでも各ツールとデータが使えます。不要なら何もダウンロードされません（必要時に取得）。',
      unsupported: 'この環境では Service Worker が使えないため、コアの事前キャッシュができません（HTTPS または localhost でアクセスしてください）。',
      fetch: 'ダウンロード', fetchAll: 'すべてダウンロード', cached: '準備完了', ready: 'オフライン可', clear: 'キャッシュ削除', cleared: 'コアキャッシュを削除しました。',
      done: '{n} 個のファイルをキャッシュしました（{size}）。', failed: '事前キャッシュが完了しませんでした。ネットワークを確認して再試行してください。',
    },
  },

  'ko-KR': {
    app: {
      brand: 'LocalForge', search: '도구 검색', searchHint: '도구 검색 (Ctrl+K)', allTools: '모든 도구', all: '전체',
      localBadge: '로컬 처리 · 업로드 없음', lightMode: '라이트 모드', darkMode: '다크 모드',
      toSidebar: '사이드바로 전환', toTopbar: '상단 바로 복귀', closeMenu: '메뉴 닫기', openMenu: '메뉴 열기',
      expandSidebar: '사이드바 펼치기', mainNav: '메인 내비', quickNav: '빠른 내비',
      searchPlaceholder: '도구 검색… (예: QR / zip / ocr)',
      noResults: '일치하는 도구가 없습니다',
      keySelect: '선택',
      keyOpen: '열기',
      keyClose: '닫기',
    },
    nav: {
      home: '홈', zipCompress: 'ZIP 압축', zipCompressShort: '압축', zipExtract: 'ZIP 해제', zipExtractShort: '해제',
      archive: '아카이브 도구', passwordRecovery: 'ZIP 비밀번호 복구', repair: '아카이브 복구',
      mediaConvert: '미디어 변환', mediaConvertShort: '미디어', mediaPro: '미디어 고급', imageConvert: '이미지 도구', imageConvertShort: '이미지',
      batch: '일괄 처리', batchShort: '일괄', pdfTools: 'PDF 도구', pdfToolsShort: 'PDF', pdfPro: 'PDF 고급',
      qrCode: 'QR 코드 도구', qrCodeShort: 'QR', ocr: 'OCR 문자 인식', ocrShort: 'OCR', hash: '해시 검증', hashShort: '해시',
      exif: '사진 개인정보 정리', text: '텍스트 / 인코딩', docConvert: '문서 변환', docConvertShort: '문서', wechatArticle: 'WeChat 기사 레이아웃', wechatArticleShort: 'WeChat',
      appIcon: '앱 아이콘 생성기', appIconShort: '앱 아이콘',
      shareFiles: 'P2P 파일 공유', about: '정보', privacy: '개인정보',
    },
    group: {
      common: '자주 쓰는', archive: '압축 / 아카이브', media: '미디어', image: '이미지', pdf: 'PDF',
      qr: 'QR / 인식', verify: '검증 / 개인정보', share: '공유 / 보안', about: '정보',
    },
    home: {
      note: { lookup: '사전·격률·시문·한의학 고전 — 모두 오프라인에서 검색할 수 있는 로컬 지식 재료입니다. 네트워크 없이도 언제든 조회할 수 있습니다.' },
      badge: '브라우저 전용 · 재료는 밖으로 나가지 않음', title: '당신의 로컬 공방', sub: '브라우저 안에 들어 있는 로컬 공방입니다. 파일·데이터·지식은 모두 재료이고, 56개의 공정이 로컬에서 단련해 쓸 수 있는 결과로 만듭니다. 재료를 넣고 결과물을 꺼내며, 모든 일은 기기 안에서 끝납니다.',
      pillLocal: '업로드 없음 · 완전 로컬', pillThread: '멀티스레드 단조', pillFormats: '200+ 아카이브 형식', pillP2p: 'P2P 직접 전송',
      howtoTitle: '단조 시작하기 3단계', howto1: '아래에서 공정을 선택합니다(예: ZIP 압축, 이미지 도구).', howto2: '재료를 투입 영역에 끌어다 놓거나 선택하세요(업로드되지 않습니다).', howto3: '옵션을 설정하고 "단조 시작"을 누른 뒤 완성품을 다운로드하세요.',
      howtoNote: '모든 작업은 로컬에서 실행됩니다. 하단의 "자체 테스트"로 각 기능을 한 번에 검증할 수 있습니다.',
      recent: '최근 작업', clear: '지우기', justNow: '방금', minAgo: '{n}분 전', hourAgo: '{n}시간 전', dayAgo: '{n}일 전',
      filterAll: '전체', filterImage: '이미지', filterVideo: '동영상', filterAudio: '오디오', filterPdf: 'PDF', filterArchive: '압축', filterText: '텍스트/기타',
      recentEmpty: '기록이 없습니다. 파일을 처리하고 다운로드하면 여기에 표시됩니다.',
    },
    footer: { note: '순수 프런트엔드 · 파일은 브라우저에서 처리되며 서버로 전송되지 않습니다 · zip.js · libarchive.js · ffmpeg.wasm 기반' },
    wf: { nextStep: '다음 단계', sendTo: '보내기' },
    progress: { done: '완료' },
    offline: {
      title: '오프라인 코어', desc: 'WASM 코어와 데이터 팩(사전·시문·한의학 고전)을 로컬에 캐시하면 오프라인에서도 도구와 데이터를 사용할 수 있습니다. 요청하지 않으면 아무것도 다운로드되지 않습니다(필요 시 가져옵니다).',
      unsupported: '이 환경에서는 Service Worker를 사용할 수 없어 코어를 미리 캐시할 수 없습니다(HTTPS 또는 localhost로 접속하세요).',
      fetch: '다운로드', fetchAll: '전체 다운로드', cached: '준비됨', ready: '오프라인 가능', clear: '캐시 삭제', cleared: '코어 캐시를 삭제했습니다.',
      done: '{n}개 파일을 캐시했습니다({size}).', failed: '사전 캐시가 완료되지 않았습니다. 네트워크를 확인 후 다시 시도하세요.',
    },
  },

  'es-ES': {
    app: {
      brand: 'LocalForge', search: 'Buscar herramientas', searchHint: 'Buscar (Ctrl+K)', allTools: 'Todas las herramientas', all: 'Todas',
      localBadge: 'Local · sin subidas', lightMode: 'Modo claro', darkMode: 'Modo oscuro',
      toSidebar: 'Cambiar a barra lateral', toTopbar: 'Volver a la barra superior', closeMenu: 'Cerrar menú', openMenu: 'Abrir menú',
      expandSidebar: 'Expandir barra lateral', mainNav: 'Navegación principal', quickNav: 'Navegación rápida',
      searchPlaceholder: 'Buscar herramientas… (p. ej. QR / zip / ocr)',
      noResults: 'No hay herramientas coincidentes',
      keySelect: 'Seleccionar',
      keyOpen: 'Abrir',
      keyClose: 'Cerrar',
    },
    nav: {
      home: 'Inicio', zipCompress: 'Comprimir a ZIP', zipCompressShort: 'Comprimir', zipExtract: 'Extraer ZIP', zipExtractShort: 'Extraer',
      archive: 'Herramientas de archivo', passwordRecovery: 'Recuperar contraseña ZIP', repair: 'Reparar archivo',
      mediaConvert: 'Convertir medios', mediaConvertShort: 'Medios', mediaPro: 'Medios avanzado', imageConvert: 'Herramientas de imagen', imageConvertShort: 'Imagen',
      batch: 'Cola por lotes', batchShort: 'Lotes', pdfTools: 'Herramientas PDF', pdfToolsShort: 'PDF', pdfPro: 'PDF avanzado',
      qrCode: 'Herramientas QR', qrCodeShort: 'QR', ocr: 'OCR de texto', ocrShort: 'OCR', hash: 'Verificación hash', hashShort: 'Hash',
      exif: 'Privacidad de fotos', text: 'Texto / Codificación', docConvert: 'Convertir documento', docConvertShort: 'Doc', wechatArticle: 'Maquetación WeChat', wechatArticleShort: 'WeChat',
      appIcon: 'Generador de iconos', appIconShort: 'Iconos',
      shareFiles: 'Compartir P2P', about: 'Acerca de', privacy: 'Privacidad',
    },
    group: {
      common: 'Frecuentes', archive: 'Compresión / Archivo', media: 'Medios', image: 'Imagen', pdf: 'PDF',
      qr: 'QR / Reconocimiento', verify: 'Verificación / Privacidad', share: 'Compartir / Seguridad', about: 'Acerca de',
    },
    home: {
      note: { lookup: 'Diccionarios, métrica poética, poesía y clásicos de TCM: conocimiento local que se puede buscar sin conexión, siempre a mano y sin red.' },
      badge: 'Solo navegador · nada sale de tu equipo', title: 'Tu taller local', sub: 'Un taller dentro de tu navegador. Archivos, datos y conocimiento son la materia prima: 56 procesos locales los forjan en resultados útiles. Entra la materia, sale la pieza terminada, y nada abandona tu dispositivo.',
      pillLocal: 'Sin subidas · 100% local', pillThread: 'Forjado multihilo', pillFormats: 'Más de 200 formatos', pillP2p: 'Transferencia P2P',
      howtoTitle: '¿Listo para forjar? 3 pasos', howto1: 'Elige un proceso abajo (p. ej. "Comprimir a ZIP", "Imagen").', howto2: 'Arrastra la materia al área de carga o selecciónala (no se sube).', howto3: 'Configura las opciones, pulsa "Iniciar forjado" y descarga la pieza terminada.',
      howtoNote: 'Todo se ejecuta localmente; el "panel de autocomprobación" inferior verifica cada módulo con un clic.',
      recent: 'Actividad reciente', clear: 'Borrar', justNow: 'ahora mismo', minAgo: 'hace {n} min', hourAgo: 'hace {n} h', dayAgo: 'hace {n} d',
      filterAll: 'Todo', filterImage: 'Imagen', filterVideo: 'Vídeo', filterAudio: 'Audio', filterPdf: 'PDF', filterArchive: 'Comprimido', filterText: 'Texto/Otros',
      recentEmpty: 'Aún no hay registros. Procesa y descarga un archivo y aparecerá aquí.',
    },
    footer: { note: 'Solo front-end · Los archivos se procesan en tu navegador, nunca se suben · Con zip.js · libarchive.js · ffmpeg.wasm' },
    wf: { nextStep: 'Siguiente paso', sendTo: 'Enviar a' },
    progress: { done: 'Hecho' },
    offline: {
      title: 'Núcleos sin conexión', desc: 'Descarga estos núcleos WASM y paquetes de datos (diccionarios, poesía, clásicos de TCM) a la caché local para usar las herramientas y los datos sin conexión. No se descarga nada salvo que lo pidas.',
      unsupported: 'Service Worker no está disponible aquí, así que no se pueden precargar los núcleos (usa HTTPS o localhost).',
      fetch: 'Descargar', fetchAll: 'Descargar todo', cached: 'Listo', ready: 'Sin conexión', clear: 'Borrar caché', cleared: 'Caché de núcleos borrada.',
      done: 'Se almacenaron {n} archivos ({size}).', failed: 'La precarga no finalizó. Comprueba la red y reinténtalo.',
    },
  },
}

function detectLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved && messages[saved]) return saved
  } catch { /* ignore */ }
  const lang = (navigator.language || 'zh-CN').toLowerCase()
  if (lang.startsWith('zh')) return 'zh-CN'
  if (lang.startsWith('ja')) return 'ja-JP'
  if (lang.startsWith('ko')) return 'ko-KR'
  if (lang.startsWith('es')) return 'es-ES'
  return 'en'
}

export const locale = ref(detectLocale())

export const t = (key, params) => {
  const get = (loc) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), messages[loc])
  let s = get(locale.value)
  if (s == null) s = get('zh-CN')
  if (s == null) {
    if (import.meta.env?.DEV) console.warn('[i18n] missing key:', key)
    return key
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll('{' + k + '}', String(v))
  }
  return s
}

export const tr = (key, params) => computed(() => t(key, params))

export function setLocale(loc) {
  if (!messages[loc]) return
  locale.value = loc
  try { localStorage.setItem(LOCALE_KEY, loc) } catch { /* ignore */ }
  document.documentElement.setAttribute('lang', loc)
}

// 语言顺序 + 显示名（供顶栏切换按钮 / 语言选择器使用）
export const LOCALE_ORDER = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']
export const LOCALE_NAMES = {
  'zh-CN': '中文', 'en': 'English', 'ja-JP': '日本語', 'ko-KR': '한국어', 'es-ES': 'Español',
}
export const LOCALE_SHORT = { 'zh-CN': '中', 'en': 'EN', 'ja-JP': '日', 'ko-KR': '한', 'es-ES': 'ES' }

// 循环切换到下一种语言（兼容原有单按钮切换交互）
export function toggleLocale() {
  const avail = LOCALE_ORDER.filter((l) => messages[l])
  const i = avail.indexOf(locale.value)
  setLocale(avail[(i + 1) % avail.length])
  return locale.value
}

export function initLocale() {
  document.documentElement.setAttribute('lang', locale.value)
}

export const availableLocales = LOCALE_ORDER.filter((l) => messages[l])
