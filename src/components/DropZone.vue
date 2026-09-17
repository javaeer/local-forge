<script setup>
import { ref } from 'vue'

const props = defineProps({
  multiple: { type: Boolean, default: true },
  accept: { type: String, default: '' },
  directory: { type: Boolean, default: false },
  hint: { type: String, default: '拖放文件到此处，或点击选择' }
})
const emit = defineEmits(['files'])

const dragging = ref(false)
const inputRef = ref(null)

function gather(e) {
  const files = Array.from(e.target.files)
  if (files.length) emit('files', files)
}
function onDrop(e) {
  dragging.value = false
  const files = Array.from(e.dataTransfer.files)
  if (files.length) emit('files', files)
}
function onSelect(e) {
  // 文件夹选择时 files 已带 webkitRelativePath
  gather(e)
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ drag: dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <i class="bi bi-cloud-arrow-up"></i>
    <p>
      {{ hint }}，或
      <label class="link">
        点击选择
        <input
          ref="inputRef"
          type="file"
          :multiple="multiple"
          :accept="accept"
          :webkitdirectory="directory ? true : undefined"
          hidden
          @change="onSelect"
        />
      </label>
    </p>
    <slot />
  </div>
</template>
