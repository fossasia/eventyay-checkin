import { useEventyayApi } from '@/stores/eventyayapi'
import { createAuthorizedExhibitorApi, exhibitorApiPath } from '@/utils/serverUrl'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTagStore = defineStore('tags', () => {
  const availableTags = ref([])
  const currentTags = ref([])
  const inputValue = ref('')

  async function fetchTags() {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()

    const url = processApi.url
    const apitoken = processApi.apitoken
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug
    const exikey = processApi.exikey

    if (!url || !apitoken || !organizer || !eventSlug || !exikey) {
      return
    }

    try {
      const api = createAuthorizedExhibitorApi(url, apitoken, exikey)
      const response = await api.get(exhibitorApiPath(organizer, eventSlug, 'tags'))
      if (response.success) {
        availableTags.value = response.tags
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    }
  }

  function addTag(tag) {
    const trimmedTag = tag.trim()
    if (trimmedTag && !currentTags.value.includes(trimmedTag)) {
      currentTags.value = [...currentTags.value, trimmedTag]
    }
  }

  function removeTag(index) {
    currentTags.value = currentTags.value.filter((_, i) => i !== index)
  }

  function handleCommaInput(value) {
    if (value.endsWith(',')) {
      const tag = value.slice(0, -1).trim()
      if (tag) {
        addTag(tag)
        inputValue.value = ''
      }
    } else {
      inputValue.value = value
    }
  }

  function reset() {
    currentTags.value = []
    inputValue.value = ''
  }

  return {
    availableTags,
    currentTags,
    inputValue,
    fetchTags,
    addTag,
    removeTag,
    handleCommaInput,
    reset
  }
})
