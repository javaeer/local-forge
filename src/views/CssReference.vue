<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { D, CATEGORY_ORDER, getVisual, hlCSS } from '../lib/cssref.js'
import { T } from '../lib/i18n.dev.js'

const search = ref('')
const activeCat = ref('all')
const detail = ref(null)

// 按分类顺序构建视图数据，并按搜索词过滤属性
const categories = computed(() => {
  const q = search.value.trim().toLowerCase()
  return CATEGORY_ORDER.map((key) => {
    const cat = D[key]
    const props = Object.keys(cat.props).filter((p) => {
      if (!q) return true
      const [desc] = cat.props[p]
      return p.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    })
    // 分类名走 i18n（cssref.js 的 label 是「中文 · English」双语兜底，非当前语言）
    return { key, label: T('css.cat.' + key), color: cat.color, props }
  }).filter((c) => c.props.length > 0)
})

const totalMatch = computed(() => categories.value.reduce((n, c) => n + c.props.length, 0))

function openDetail(prop, catKey) {
  const cat = D[catKey]
  const [desc, code] = cat.props[prop]
  detail.value = {
    prop,
    catKey,
    catColor: cat.color,
    catLabel: T('css.cat.' + catKey),
    desc,
    code,
    vis: getVisual(prop, catKey),
  }
}
function closeDetail() { detail.value = null }
function copyCode() {
  if (!detail.value) return
  navigator.clipboard && navigator.clipboard.writeText(detail.value.code)
}

// 键盘：Esc 关闭详情
function onKey(e) { if (e.key === 'Escape') closeDetail() }
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKey)
  // 路由切换后及时解绑全局监听，避免 SPA 中监听器泄漏
  onUnmounted(() => window.removeEventListener('keydown', onKey))
}
</script>

<template>
  <h1 class="page-title">{{ T('css.title') }}</h1>
  <p class="page-sub">
    {{ T('css.subtitle') }}
  </p>

  <!-- 搜索 + 分类切换 -->
  <div class="panel css-ref-bar">
    <div class="search-row">
      <i class="bi bi-search"></i>
      <input
        v-model="search" type="text" class="css-input"
        :placeholder="T('css.searchPh')"
      />
      <span v-if="search" class="match-count">{{ T('css.matchCount', { n: totalMatch }) }}</span>
    </div>
    <div class="cat-pills">
      <button
        type="button" class="cat-pill" :class="{ on: activeCat === 'all' }"
        @click="activeCat = 'all'"
      >{{ T('css.all') }}</button>
      <button
        v-for="c in categories" :key="c.key" type="button"
        class="cat-pill" :class="{ on: activeCat === c.key }"
        :style="{ '--cc': c.color }" @click="activeCat = c.key"
      >{{ c.label }}</button>
    </div>
  </div>

  <!-- 分类区块 -->
  <section v-for="c in categories" v-show="activeCat === 'all' || activeCat === c.key" :key="c.key" class="cat css-cat">
    <h2 class="cat-title"><i class="bi bi-collection"></i> {{ c.label }} <span class="cnt">{{ T('css.count', { n: c.props.length }) }}</span></h2>
    <div class="props">
      <button
        v-for="p in c.props" :key="p" type="button" class="tag prop-chip"
        :style="{ '--cc': c.color }" @click="openDetail(p, c.key)"
      >{{ p }}</button>
    </div>
  </section>

  <!-- 详情弹层 -->
  <div v-if="detail" class="css-overlay" @click.self="closeDetail">
    <div class="css-modal">
      <div class="css-modal-head">
        <div>
          <div class="css-prop" :style="{ color: detail.catColor }">{{ detail.prop }}</div>
          <div class="css-cat-label">{{ detail.catLabel }}</div>
        </div>
        <button class="css-x" type="button" @click="closeDetail"><i class="bi bi-x-lg"></i></button>
      </div>

      <p class="css-desc">{{ detail.desc }}</p>

      <div class="css-sub">{{ T('css.visual') }}</div>
      <!-- getVisual 输出的是受控的内联 HTML（源数据来自本仓库，安全） -->
      <div class="css-vis" v-html="detail.vis"></div>

      <div class="css-sub">{{ T('css.sampleCode') }}</div>
      <div class="cblk css-code">
        <button class="cpbtn" type="button" @click="copyCode">
          <i class="bi bi-clipboard"></i> {{ T('css.copy') }}
        </button>
        <code v-html="hlCSS(detail.code)"></code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.css-ref-bar { padding: 16px; }
.search-row { display: flex; align-items: center; gap: 10px; position: relative; }
.search-row .bi-search { color: var(--faint, #6b7a96); font-size: 15px; }
.css-input {
  flex: 1; background: var(--panel-solid, #121a2c); border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  color: var(--txt, #e8edf7); border-radius: 10px; padding: 9px 11px; font-size: 13.5px; outline: none; transition: .15s;
}
.css-input:focus { border-color: var(--accent, #38bdf8); box-shadow: 0 0 0 3px rgba(56,189,248,.15); }
.match-count { font-size: 12px; color: var(--faint, #6b7a96); white-space: nowrap; }
.cat-pills { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.cat-pill {
  padding: 6px 13px; border-radius: 999px; cursor: pointer; font-size: 12.5px;
  border: 1px solid var(--line, rgba(120,150,200,.16)); background: var(--panel-2, rgba(28,37,60,.55));
  color: var(--muted, #93a2bd); transition: .15s;
}
.cat-pill:hover { border-color: rgba(56,189,248,.45); color: var(--txt, #e8edf7); }
.cat-pill.on { border-color: var(--cc, #38bdf8); color: var(--cc, #38bdf8); background: var(--grad-soft, rgba(56,189,248,.12)); }

.css-cat .cnt { color: var(--faint, #6b7a96); font-size: 13px; font-weight: 400; }
.props { display: flex; flex-wrap: wrap; gap: 8px; }
.prop-chip {
  --cc: var(--accent, #38bdf8);
  cursor: pointer; user-select: none; white-space: nowrap;
  border: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--muted, #93a2bd);
}
.prop-chip:hover { border-color: var(--cc); color: var(--cc); background: color-mix(in srgb, var(--cc) 12%, transparent); }

.css-overlay {
  position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.5);
  display: flex; align-items: flex-end; justify-content: center;
}
.css-modal {
  width: 100%; max-width: 720px; max-height: 86vh; overflow-y: auto;
  background: var(--panel-solid, #121a2c); border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  border-radius: 20px 20px 0 0; padding: 16px 20px 28px; box-shadow: 0 -10px 40px rgba(0,0,0,.5);
}
.css-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.css-prop { font-size: 20px; font-weight: 700; font-family: var(--mono, monospace); }
.css-cat-label { font-size: 11px; color: var(--faint, #6b7a96); margin-top: 2px; }
.css-x {
  border: none; background: var(--panel-2, rgba(28,37,60,.55)); color: var(--muted, #93a2bd);
  width: 32px; height: 32px; border-radius: 9px; cursor: pointer; font-size: 15px; flex: none;
}
.css-x:hover { color: var(--txt, #e8edf7); }
.css-desc { font-size: 13px; color: var(--muted, #93a2bd); line-height: 1.7; margin: 14px 0 16px; }
.css-sub { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint, #6b7a96); margin: 14px 0 8px; font-weight: 600; }
.css-code { margin: 0; }
</style>

<!-- 非 scoped：供 v-html 注入的可视化 / 代码高亮内容使用 -->
<style>
.css-vis,
.cblk {
  background: var(--panel-solid, #121a2c);
  border: 1px solid var(--line, rgba(120,150,200,.16));
  border-radius: 10px;
}
.cblk { padding: 14px 16px; font-family: var(--mono, monospace); font-size: 12px; line-height: 1.65; color: var(--muted, #93a2bd); white-space: pre-wrap; word-break: break-all; position: relative; }
.cblk .kw { color: #c084fc; }
.cblk .cm { color: var(--faint, #6b7a96); font-style: italic; }
.cpbtn {
  position: absolute; top: 8px; right: 8px; padding: 4px 9px; border-radius: 6px; font-size: 10px;
  background: var(--panel-2, rgba(28,37,60,.7)); color: var(--muted, #93a2bd);
  border: 1px solid var(--line-strong, rgba(120,150,200,.32)); cursor: pointer; transition: .15s;
}
.cpbtn:hover { color: var(--accent, #38bdf8); border-color: var(--accent, #38bdf8); }

/* ===== Visual Preview (移植自 css.html) ===== */
.vp-wrap { padding: 14px; overflow: hidden; min-height: 60px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; }
.vp-box { width: 36px; height: 36px; background: rgba(129,140,248,0.2); border: 2px solid #818cf8; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #818cf8; flex-shrink: 0; }
.vp-box.g { border-color: #34d399; background: rgba(52,211,153,0.2); color: #34d399; }
.vp-box.p { border-color: #f472b6; background: rgba(244,114,182,0.2); color: #f472b6; }
.vp-box.y { border-color: #fbbf24; background: rgba(251,191,36,0.2); color: #fbbf24; }
.vp-box.o { border-color: #fb923c; background: rgba(249,115,22,0.2); color: #fb923c; }
.vp-txt { color: var(--txt, #e8edf7); font-size: 13px; line-height: 1.5; }
.vp-arrow { color: var(--faint, #6b7a96); font-size: 10px; }
@keyframes vp-fade { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes vp-slide { 0% { transform: translateY(10px); } 100% { transform: translateY(0); } }
@keyframes vp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
@keyframes vp-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes vp-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes vp-grow { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
@keyframes vp-color { 0% { background: #818cf8; } 50% { background: #f97316; } 100% { background: #818cf8; } }
@keyframes vp-move { 0% { transform: translateX(0); } 50% { transform: translateX(30px); } 100% { transform: translateX(0); } }
</style>
