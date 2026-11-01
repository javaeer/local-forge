<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { TOOLS } from '../lib/formats.js'
import { NAV, navByPath, navTitle } from '../lib/nav.js'
import { getHistory, clearHistory } from '../lib/history.js'
import { typeOfName, TYPE_META, FILTER_ORDER, FILTER_LABEL_KEY } from '../lib/filetype.js'
import { t, tr, locale } from '../lib/i18n.js'
import { T } from '../lib/i18n.dev.js'
import SelfTestPanel from '../components/SelfTestPanel.vue'
import OfflineCores from '../components/OfflineCores.vue'
import HelpTip from '../components/HelpTip.vue'

const router = useRouter()
const recent = ref([])
const filter = ref('all')

async function loadRecent() {
  try {
    const list = await getHistory()
    // 兼容老记录：缺失 type 时按文件名推断
    recent.value = list.map((r) => ({ ...r, type: r.type || typeOfName(r.name) }))
  } catch { recent.value = [] }
}
async function clearRecent() {
  await clearHistory()
  recent.value = []
}
function iconOf(path) { return (navByPath(path) || {}).icon || 'bi-clock-history' }
function titleOf(path) { return navTitle(navByPath(path)) || path }
function ago(ts) {
  const s = Math.floor((Date.now() - (ts || 0)) / 1000)
  if (s < 60) return t('home.justNow')
  if (s < 3600) return t('home.minAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return t('home.hourAgo', { n: Math.floor(s / 3600) })
  return t('home.dayAgo', { n: Math.floor(s / 86400) })
}

const filters = computed(() => {
  const present = new Set(recent.value.map((r) => r.type))
  return FILTER_ORDER.filter((f) => f === 'all' || present.has(f))
})
const filteredRecent = computed(() =>
  filter.value === 'all' ? recent.value : recent.value.filter((r) => r.type === filter.value))
const metaOf = (type) => TYPE_META[type] || TYPE_META.other
const filterLabel = (f) => t(FILTER_LABEL_KEY[f] || f)

onMounted(loadRecent)
</script>

<template>
  <!-- 英雄区 -->
  <section class="hero">
    <span class="hero-badge"><i class="bi bi-shield-lock"></i> {{ t('home.badge') }}</span>
    <h1 class="hero-title">{{ t('home.title') }} <span class="grad">LocalForge</span></h1>
    <p class="hero-sub">{{ t('home.sub') }}</p>
    <div class="hero-pills">
      <span class="tag"><i class="bi bi-hdd-network"></i> {{ t('home.pillLocal') }}</span>
      <span class="tag"><i class="bi bi-lightning-charge"></i> {{ t('home.pillThread') }}</span>
      <span class="tag"><i class="bi bi-collection"></i> {{ t('home.pillFormats') }}</span>
      <span class="tag"><i class="bi bi-phone"></i> {{ t('home.pillP2p') }}</span>
    </div>

    <HelpTip :title="t('home.howtoTitle')" icon="bi-signpost-split" open>
      <ol class="howto">
        <li>{{ t('home.howto1') }}</li>
        <li>{{ t('home.howto2') }}</li>
        <li>{{ t('home.howto3') }}</li>
      </ol>
      <p style="margin:8px 0 0">{{ t('home.howtoNote') }}</p>
    </HelpTip>
  </section>

  <!-- 工具分组 -->
  <div v-for="g in TOOLS" :key="g.groupKey || g.group" class="cat">
    <h2 class="cat-title"><i class="bi bi-collection"></i> {{ T(g.groupKey) }}</h2>
    <div class="tools">
      <RouterLink v-for="item in g.items" :key="item.to" :to="item.to" class="tool-card">
        <i class="bi" :class="item.icon"></i>
        <h3>{{ T(item.titleKey) }}</h3>
        <p>{{ T(item.descKey) }}</p>
      </RouterLink>
    </div>
  </div>

  <!-- 最近处理（纯本地，IndexedDB；支持按文件类型筛选） -->
  <div class="panel recent">
    <div class="recent-head">
      <h3 style="margin:0"><i class="bi bi-clock-history"></i> {{ t('home.recent') }}</h3>
      <button v-if="recent.length" class="btn ghost sm" @click="clearRecent">
        <i class="bi bi-eraser"></i> {{ t('home.clear') }}
      </button>
    </div>

    <div v-if="recent.length" class="recent-filters">
      <button
        v-for="f in filters" :key="f" type="button"
        class="chip" :class="{ active: filter === f }" @click="filter = f"
      >
        <i v-if="f !== 'all'" class="bi" :class="metaOf(f).icon"></i>
        {{ filterLabel(f) }}
      </button>
    </div>

    <div v-if="filteredRecent.length" class="recent-list">
      <button v-for="r in filteredRecent" :key="r.id" class="recent-item" @click="router.push(r.path)">
        <i class="bi" :class="iconOf(r.path)"></i>
        <span class="recent-title">{{ titleOf(r.path) }}</span>
        <span class="recent-name" v-if="r.name">{{ r.name }}</span>
        <span class="recent-type" :style="{ color: metaOf(r.type).color }" :title="filterLabel(r.type)">
          <i class="bi" :class="metaOf(r.type).icon"></i>
        </span>
        <span class="recent-time">{{ ago(r.t) }}</span>
      </button>
    </div>

    <p v-else class="recent-empty">{{ t('home.recentEmpty') }}</p>
  </div>

  <!-- 离线内核（A-3：按需预缓存，真·离线可用） -->
  <OfflineCores />

  <div class="panel">
    <h3 style="margin-top:0"><i class="bi bi-cpu"></i> 技术选型（相对 ezyzip.pro 的改进）</h3>
    <ul style="color:var(--muted);font-size:13px;line-height:1.9;margin:6px 0 0">
      <li><b style="color:var(--txt)">zip.js 2.15</b> + 多线程 + AES-256（原版 2.8.34，且真正启用多线程与分卷）</li>
      <li><b style="color:var(--txt)">libarchive.js</b> 开源 WASM 写/读引擎，覆盖 ZIP/7Z/TAR/ISO/RAR/APK/DMG… 200+ 格式</li>
      <li><b style="color:var(--txt)">@ffmpeg/ffmpeg 多线程内核</b>（SharedArrayBuffer）补齐网页端音视频转换</li>
      <li><b style="color:var(--txt)">upng-js（类 TinyPNG）量化</b>图片有损压缩 + 保透明，全程零上传</li>
      <li><b style="color:var(--txt)">WebRTC</b> 点对点文件直传（P2P 分享，手动信令，无需服务器）</li>
      <li>
        <b style="color:var(--txt)">二维码双向能力</b>：生成用 <b style="color:var(--txt)">qrcode</b>,
        识别用 <b style="color:var(--txt)">zxing-wasm</b>（ZXing-C++ WASM 本地打包，原生 BarcodeDetector 优先）——
        取代已停更的 jsQR / html5-qrcode，覆盖 QR · DataMatrix · Aztec · EAN · Code128 · PDF417 等 20+ 码制
      </li>
      <li><b style="color:var(--txt)">COOP/COEP 跨源隔离头</b>真正启用，发挥多线程与 WASM 性能</li>
    </ul>
  </div>

  <SelfTestPanel />
</template>

<style scoped>
.hero {
  position: relative;
  padding: 14px 0 6px;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--accent-2, #34d399);
  border: 1px solid rgba(52,211,153,.35);
  background: rgba(52,211,153,.08);
  padding: 5px 12px;
  border-radius: 999px;
  margin-bottom: 14px;
}
.hero-title {
  font-size: clamp(26px, 7vw, 34px);
  line-height: 1.2;
  margin: 0 0 12px;
  font-weight: 800;
  letter-spacing: .2px;
}
.hero-title .grad {
  background: var(--grad, linear-gradient(120deg,#38bdf8,#a78bfa));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-sub {
  color: var(--muted, #93a2bd);
  font-size: 15px;
  line-height: 1.75;
  max-width: 640px;
  margin: 0 0 16px;
}
.hero-pills { display: flex; flex-wrap: wrap; gap: 9px; }

.recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }
.recent-head h3 { font-size: 15px; display: flex; align-items: center; gap: 8px; }
.recent-head h3 i { color: var(--accent, #38bdf8); }
.recent-filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 999px; cursor: pointer; font-size: 12.5px;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--muted, #93a2bd);
  transition: .15s;
}
.chip:hover { border-color: rgba(56,189,248,.45); color: var(--txt, #e8edf7); }
.chip.active {
  border-color: rgba(56,189,248,.5); color: var(--accent, #38bdf8);
  background: var(--grad-soft, rgba(56,189,248,.12));
}
.chip i { font-size: 13px; }
.recent-list { display: flex; flex-direction: column; gap: 6px; }
.recent-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 9px 11px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--line, rgba(120,150,200,.16)); background: var(--panel-2, rgba(28,37,60,.55));
  color: var(--txt, #e8edf7); font-size: 13px; transition: .15s;
}
.recent-item:hover { border-color: rgba(56,189,248,.45); background: var(--grad-soft, rgba(56,189,248,.1)); }
.recent-item i { color: var(--accent, #38bdf8); font-size: 15px; width: 18px; text-align: center; }
.recent-title { font-weight: 600; flex: none; }
.recent-name { color: var(--muted, #93a2bd); font-family: var(--mono, monospace); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.recent-type { flex: none; display: inline-flex; }
.recent-type i { width: auto; font-size: 14px; }
.recent-time { margin-left: auto; color: var(--faint, #6b7a96); font-size: 12px; flex: none; }
.recent-empty { color: var(--faint, #6b7a96); font-size: 13px; margin: 4px 0 0; }
.btn.sm { padding: 6px 11px; font-size: 12.5px; }
</style>
