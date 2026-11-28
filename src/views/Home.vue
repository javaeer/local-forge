<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { TOOLS } from '../lib/formats.js'
import { NAV, navByPath, navTitle } from '../lib/nav.js'
import { getHistory, clearHistory } from '../lib/history.js'
import { listResume, clearResume } from '../lib/resume.js'
import { typeOfName, TYPE_META, FILTER_ORDER, FILTER_LABEL_KEY } from '../lib/filetype.js'
import { t, tr, locale } from '../lib/i18n.js'
import { T } from '../lib/i18n.dev.js'
import { APP_COMMANDS_KEY } from '../lib/app-commands.js'
import SelfTestPanel from '../components/SelfTestPanel.vue'
import OfflineCores from '../components/OfflineCores.vue'
import TaskBoard from '../components/TaskBoard.vue'

const router = useRouter()
// 复用 App.vue 通过 Symbol key 暴露的全局命令；TaskBoard 只 emit，不自建面板。
const appCommands = inject(APP_COMMANDS_KEY, {})
function openPalette() { appCommands.openPalette?.() }
const recent = ref([])
const resumable = ref([])
const filter = ref('all')

async function loadRecent() {
  try {
    const list = await getHistory()
    // 兼容老记录：缺失 type 时按文件名推断
    recent.value = list.map((r) => ({ ...r, type: r.type || typeOfName(r.name) }))
  } catch { recent.value = [] }
  // 可恢复任务：仅列出仍有效的快照（resume.js 已按 TTL 过滤）
  try { resumable.value = listResume() } catch { resumable.value = [] }
}
async function clearRecent() {
  await clearHistory()
  recent.value = []
}
async function clearAllResume() {
  clearResume()
  resumable.value = []
}
function resumeTo(r) { if (r && r.route) router.push(r.route) }
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
    <span class="hero-badge"><i class="bi bi-hammer"></i> {{ t('home.badge') }}</span>
    <h1 class="hero-title">{{ t('home.title') }} <span class="grad">LocalForge</span></h1>
    <p class="hero-sub">{{ t('home.sub') }}</p>
    <div class="hero-pills">
      <span class="tag"><i class="bi bi-hdd-network"></i> {{ t('home.pillLocal') }}</span>
      <span class="tag"><i class="bi bi-lightning-charge"></i> {{ t('home.pillThread') }}</span>
      <span class="tag"><i class="bi bi-collection"></i> {{ t('home.pillFormats') }}</span>
      <span class="tag"><i class="bi bi-phone"></i> {{ t('home.pillP2p') }}</span>
    </div>

    <p class="hero-hint"><i class="bi bi-signpost-split"></i> {{ t('home.howto1') }}</p>
  </section>

  <!-- Pro 宣传入口：价值先行，首屏直达外部购买页（不含任何本地授权逻辑） -->
  <a href="https://dodo.pe/localforge" target="_blank" rel="noopener noreferrer" class="pro-banner" data-testid="pro-banner" :title="T('proPromo.title')">
    <div class="pb-icon"><i class="bi bi-stars"></i></div>
    <div class="pb-body">
      <span class="pb-eyebrow">{{ T('proPromo.tag') }}</span>
      <h2>{{ T('proPromo.hero') }}</h2>
      <p>{{ T('proPromo.sub') }}</p>
    </div>
    <span class="pb-cta">{{ T('proPromo.cta') }} <i class="bi bi-arrow-right"></i></span>
  </a>

  <!-- 任务入口层：从「想做什么」直达工序；全部工序折叠在后，老路径不丢 -->
  <TaskBoard @open-palette="openPalette" />

  <!-- 工具分组（默认折叠，展开后与原首页完全一致） -->
  <details id="all-tools" class="all-tools">
    <summary><i class="bi bi-grid"></i> {{ T('task.allTools') }}</summary>
  <div v-for="g in TOOLS" :key="g.groupKey || g.group" class="cat">
    <h2 class="cat-title"><i class="bi bi-collection"></i> {{ T(g.groupKey) }}</h2>
    <p v-if="g.noteKey" class="cat-note">{{ T(g.noteKey) }}</p>
    <div class="tools">
      <RouterLink v-for="item in g.items" :key="item.to" :to="item.to" class="tool-card">
        <i class="bi" :class="item.icon"></i>
        <h3>{{ T(item.titleKey) }}</h3>
        <p>{{ T(item.descKey) }}</p>
      </RouterLink>
    </div>
  </div>
  </details>

  <!-- 可恢复任务（条件出现：仅在存在有效快照时显示；与"最近使用"分离） -->
  <div v-if="resumable.length" id="resumable" class="panel resumable">
    <div class="recent-head">
      <h3 style="margin:0"><i class="bi bi-arrow-repeat"></i> {{ T('task.resumeTitle') }}</h3>
      <button class="btn ghost sm" @click="clearAllResume">
        <i class="bi bi-eraser"></i> {{ T('task.resumeClear') }}
      </button>
    </div>
    <div class="recent-list">
      <button v-for="r in resumable" :key="r.id" class="recent-item" @click="resumeTo(r)">
        <i class="bi" :class="iconOf(r.route)"></i>
        <span class="recent-title">{{ titleOf(r.route) }}</span>
        <span class="resume-progress" v-if="r.progress > 0 && r.progress < 1">{{ Math.round(r.progress * 100) }}%</span>
        <i class="bi bi-arrow-right-short step-arrow"></i>
      </button>
    </div>
  </div>

  <!-- 最近处理（纯本地，IndexedDB；支持按文件类型筛选；位置由底部上移至任务层之后） -->
  <div id="recent" class="panel recent">
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
    <h3 style="margin-top:0"><i class="bi bi-cpu"></i> {{ T('ui.home.techTitle') }}</h3>
    <ul style="color:var(--muted);font-size:13px;line-height:1.9;margin:6px 0 0" v-html="T('ui.home.techList')"></ul>
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
  color: var(--accent, #e8954a);
  border: 1px solid rgba(232,149,74,.35);
  background: rgba(232,149,74,.08);
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
.hero-hint { display: flex; align-items: center; gap: 7px; margin: 14px 0 0; font-size: 12.5px; color: var(--muted, #93a2bd); }
.hero-hint i { color: var(--accent, #e8954a); }

/* Pro 首屏价值横幅（外链，无本地授权逻辑） */
.pro-banner {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin: 18px 0 22px; padding: 18px 20px;
  border: 1px solid rgba(232,149,74,.38);
  border-radius: 14px;
  background: linear-gradient(110deg, rgba(240,160,75,.14), rgba(184,70,46,.10) 60%, rgba(48,38,28,.5));
  text-decoration: none; color: inherit;
  box-shadow: 0 6px 24px rgba(184,70,46,.12);
  transition: .18s;
}
.pro-banner:hover { transform: translateY(-2px); border-color: var(--accent, #e8954a); box-shadow: 0 10px 30px rgba(184,70,46,.22); }
.pro-banner:focus-visible { outline: 2px solid var(--accent, #e8954a); outline-offset: 2px; }
.pb-icon {
  width: 48px; height: 48px; flex: none; display: grid; place-items: center;
  border-radius: 13px; color: #fff; font-size: 23px;
  background: var(--grad, linear-gradient(120deg,#e8954a,#b8462e));
  box-shadow: 0 4px 14px rgba(184,70,46,.35);
}
.pb-body { flex: 1; min-width: 220px; }
.pb-eyebrow {
  display: inline-block; font-size: 10.5px; font-weight: 800; letter-spacing: 1.2px;
  color: var(--accent, #e8954a); text-transform: uppercase;
}
.pb-body h2 { font-size: clamp(17px, 3vw, 21px); margin: 4px 0 5px; line-height: 1.25; }
.pb-body p { color: var(--muted, #93a2bd); font-size: 12.5px; line-height: 1.6; margin: 0; max-width: 620px; }
.pb-cta {
  display: inline-flex; align-items: center; gap: 7px; flex: none;
  padding: 10px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
  color: #fff; background: var(--grad, linear-gradient(120deg,#e8954a,#b8462e));
  border: 1px solid rgba(255,255,255,.18);
  box-shadow: 0 3px 12px rgba(184,70,46,.3);
  transition: .15s;
}
.pro-banner:hover .pb-cta { filter: brightness(1.1); gap: 11px; }
@media (max-width: 620px) {
  .pro-banner { padding: 15px; gap: 12px; }
  .pb-icon { width: 40px; height: 40px; font-size: 20px; }
  .pb-cta { width: 100%; justify-content: center; }
}
.all-tools {
  margin: 0 0 22px;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  border-radius: 12px;
  background: rgba(127,127,127,.04);
  padding: 0 12px 12px;
}
.all-tools > summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 8px;
  padding: 12px 4px; font-size: 13px; font-weight: 600;
  color: var(--muted, #93a2bd);
}
.all-tools > summary::-webkit-details-marker { display: none; }
.all-tools > summary:hover { color: var(--accent, #e8954a); }
.all-tools[open] > summary { border-bottom: 1px solid var(--line, rgba(120,150,200,.16)); margin-bottom: 12px; }
.all-tools > summary i { color: var(--accent, #e8954a); }
.all-tools > summary:focus-visible { outline: 2px solid var(--accent, #e8954a); outline-offset: 2px; }

.recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }.recent-head h3 { font-size: 15px; display: flex; align-items: center; gap: 8px; }
.recent-head h3 i { color: var(--accent, #38bdf8); }
.recent-filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 999px; cursor: pointer; font-size: 12.5px;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--muted, #93a2bd);
  transition: .15s;
}
.chip:hover { border-color: rgba(232,149,74,.45); color: var(--txt, #e8edf7); }
.chip.active {
  border-color: rgba(232,149,74,.5); color: var(--accent, #38bdf8);
  background: var(--grad-soft, rgba(232,149,74,.12));
}
.chip i { font-size: 13px; }
.recent-list { display: flex; flex-direction: column; gap: 6px; }
.recent-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 9px 11px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--line, rgba(120,150,200,.16)); background: var(--panel-2, rgba(28,37,60,.55));
  color: var(--txt, #e8edf7); font-size: 13px; transition: .15s;
}
.recent-item:hover { border-color: rgba(232,149,74,.45); background: var(--grad-soft, rgba(232,149,74,.1)); }
.recent-item i { color: var(--accent, #38bdf8); font-size: 15px; width: 18px; text-align: center; }
.recent-title { font-weight: 600; flex: none; }
.recent-name { color: var(--muted, #93a2bd); font-family: var(--mono, monospace); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.recent-type { flex: none; display: inline-flex; }
.recent-type i { width: auto; font-size: 14px; }
.recent-time { margin-left: auto; color: var(--faint, #6b7a96); font-size: 12px; flex: none; }
.recent-empty { color: var(--faint, #6b7a96); font-size: 13px; margin: 4px 0 0; }
.resumable { border-color: rgba(232,149,74,.32); }
.resumable .recent-head h3 i { color: var(--accent, #e8954a); }
.resume-progress { color: var(--accent, #e8954a); font-size: 12px; font-family: var(--mono, monospace); }
.resumable .step-arrow { margin-left: auto; color: var(--faint, #6b7a96); }
.btn.sm { padding: 6px 11px; font-size: 12.5px; }
</style>
