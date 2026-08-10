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
    const trimmedTag = String(tag || '').trim()
    if (trimmedTag && !currentTags.value.includes(trimmedTag)) {
      currentTags.value = [...currentTags.value, trimmedTag]
    }
  }

  function removeTag(index) {
    currentTags.value = currentTags.value.filter((_, i) => i !== index)
  }

  function commitSegments(segments) {
    for (const segment of segments) {
      addTag(segment)
    }
  }

  function handleInputChange(value) {
    const rawValue = String(value ?? '')

    if (!rawValue.includes(',')) {
      inputValue.value = rawValue
      return
    }

    const segments = rawValue.split(',')
    const endsWithComma = rawValue.endsWith(',')

    if (endsWithComma) {
      commitSegments(segments)
      inputValue.value = ''
      return
    }

    const remainder = segments.pop() ?? ''
    commitSegments(segments)
    inputValue.value = remainder
  }

  function commitInput() {
    const rawValue = String(inputValue.value ?? '').trim()
    if (!rawValue) {
      return
    }

    if (rawValue.includes(',')) {
      commitSegments(rawValue.split(','))
    } else {
      addTag(rawValue)
    }

    inputValue.value = ''
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
    handleInputChange,
    commitInput,
    reset
  }
})
