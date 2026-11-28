<script setup>
import { ref, computed } from 'vue'
import { T } from '../lib/i18n.dev.js'

const props = defineProps({
  multiple: { type: Boolean, default: true },
  accept: { type: String, default: '' },
  directory: { type: Boolean, default: false },
  hint: { type: String, default: '' },
  formats: { type: String, default: '' }, // 例如 "ZIP / RAR / 7Z / TAR…"
  single: { type: String, default: '' }, // 用于占位文案，如 "图片"
})
const emit = defineEmits(['files'])

const dragging = ref(false)
const inputRef = ref(null)

const formatsText = computed(() => props.formats || (props.accept ? props.accept.split(',').filter(Boolean).join(' / ').replace(/\./g, '').toUpperCase() : ''))

function gather(e) {
  const files = Array.from(e.target.files)
  if (files.length) emit('files', files)
  e.target.value = '' // 允许重复选择同一文件
}
function onDrop(e) {
  dragging.value = false
  const files = Array.from(e.dataTransfer.files)
  if (files.length) emit('files', files)
}
function onSelect(e) {
  gather(e)
}
function pick() {
  inputRef.value && inputRef.value.click()
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ drag: dragging }"
    @dragover.prevent="dragging = true"
    @dragenter.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="pick"
    role="button"
    tabindex="0"
    @keydown.enter.prevent="pick"
  >
    <i class="bi bi-cloud-arrow-up"></i>
    <p class="dz-main">
      {{ hint || T('ui.dropzone.defaultHint') }}
    </p>
    <p class="dz-sub">
      {{ T('ui.dropzone.or') }} <span class="link">{{ T('ui.dropzone.pick', { name: single || T('ui.dropzone.file') }) }}</span>
      <span v-if="directory">{{ T('ui.dropzone.keepTree') }}</span>
    </p>
    <div v-if="formatsText" class="dz-formats">{{ T('ui.dropzone.formats', { list: formatsText }) }}</div>
    <slot />
    <input
      ref="inputRef"
      type="file"
      :multiple="multiple"
      :accept="accept"
      :webkitdirectory="directory ? true : undefined"
      hidden
      @change="onSelect"
    />
  </div>
</template>

<style scoped>
.dropzone { cursor: pointer; user-select: none; }
.dropzone:focus-visible { outline: 2px solid var(--accent, #38bdf8); outline-offset: 3px; }
.dz-main { margin: 0; font-size: 14.5px; color: var(--txt, #e8edf7); }
.dz-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted, #93a2bd); }
.dz-sub .link { color: var(--accent, #38bdf8); font-weight: 600; }
.dropzone.drag .dz-main { color: var(--accent, #38bdf8); }
</style>
