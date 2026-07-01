<script setup>
import { onMounted } from 'vue'
import { useTagStore } from '@/stores/tags'
import { storeToRefs } from 'pinia'

defineProps({
  modelValue: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const tagStore = useTagStore()
const { availableTags, currentTags, inputValue } = storeToRefs(tagStore)

onMounted(() => {
  tagStore.fetchTags()
})

function syncModelValue() {
  emit('update:modelValue', currentTags.value)
}

function handleInput(event) {
  tagStore.handleInputChange(event.target.value)
  syncModelValue()
}

function handleKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    tagStore.commitInput()
    syncModelValue()
    return
  }

  if (event.key === 'Backspace' && !inputValue.value && currentTags.value.length > 0) {
    tagStore.removeTag(currentTags.value.length - 1)
    syncModelValue()
  }
}

function addExistingTag(tag) {
  tagStore.addTag(tag)
  syncModelValue()
}

function removeTag(index) {
  tagStore.removeTag(index)
  syncModelValue()
}
</script>

<template>
  <div class="w-full">
    <div class="mb-2 flex flex-wrap gap-2">
      <div
        v-for="(tag, index) in currentTags"
        :key="index"
        class="items-center rounded-full bg-primary px-2 py-1 text-sm text-white hover:bg-danger"
        @click="removeTag(index)"
      >
        {{ tag }}
      </div>
    </div>

    <div class="mb-2 flex flex-wrap gap-2">
      <button
        v-for="tag in availableTags.filter((t) => !currentTags.includes(t))"
        :key="tag"
        type="button"
        class="rounded-full border px-2 py-1 text-sm text-black hover:bg-secondary hover:text-white"
        @click="addExistingTag(tag)"
      >
        + {{ tag }}
      </button>
    </div>

    <input
      :value="inputValue"
      type="text"
      class="w-full rounded border p-2"
      placeholder="Tags"
      aria-label="Tags"
      @input="handleInput"
      @keydown="handleKeydown"
      @focus="tagStore.fetchTags()"
    />
  </div>
</template>
