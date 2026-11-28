<script setup>
import { ref } from 'vue'
import { T } from '../lib/i18n.dev.js'

const props = defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: 'bi-info-circle' },
  open: { type: Boolean, default: false },
  tone: { type: String, default: 'info' }, // info | warn | tip
})
const show = ref(props.open)
</script>

<template>
  <div class="helptip" :class="[tone, { open: show }]">
    <button class="ht-head" type="button" @click="show = !show">
      <i class="bi" :class="icon"></i>
      <span class="ht-title">{{ title || T('ui.helptip.defaultTitle') }}</span>
      <i class="bi ht-caret" :class="show ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
    </button>
    <div v-show="show" class="ht-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.helptip {
  border: 1px solid var(--line, #2a3447);
  border-radius: 12px;
  background: var(--panel-2, rgba(28,37,60,.6));
  margin: 14px 0;
  overflow: hidden;
  backdrop-filter: blur(8px);
}
.ht-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 14px;
  background: transparent;
  border: none;
  color: var(--txt, #e6ebf2);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.ht-head i:first-child { color: var(--accent, #38bdf8); font-size: 16px; }
.ht-title { flex: 1; }
.ht-caret { color: var(--muted, #93a2bd); font-size: 13px; transition: .15s; }
.helptip.open .ht-caret { transform: rotate(0deg); }
.ht-body {
  padding: 2px 16px 14px 16px;
  color: var(--muted, #93a2bd);
  font-size: 13px;
  line-height: 1.7;
}
.helptip.warn { border-color: rgba(251,191,36,.4); }
.helptip.warn .ht-head i:first-child { color: var(--warn, #fbbf24); }
.helptip.tip .ht-head i:first-child { color: var(--accent-2, #34d399); }
.ht-body :deep(ul), .ht-body :deep(ol) { margin: 6px 0; padding-left: 18px; }
.ht-body :deep(li) { margin: 3px 0; }
.ht-body :deep(b) { color: var(--txt, #e6ebf2); }
.ht-body :deep(code) { font-family: var(--mono, monospace); background: rgba(120,150,200,.12); padding: 1px 6px; border-radius: 5px; font-size: 12px; }
</style>
