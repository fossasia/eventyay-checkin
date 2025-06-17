import { defineStore } from 'pinia'
import { ref } from 'vue'

let idCounter = 0

export const useNotificationStore = defineStore('notification', () => {
  const list = ref([])

  function addNotification(messages, type, duration = 3000) {
    // Remove existing identical notifications
    list.value = list.value.filter(
      (n) => n.messages.join('') !== messages.join('') || n.type !== type
    )

    const id = idCounter++
    const notification = { id, messages, type }
    list.value.push(notification)

    // Auto-remove after duration
    setTimeout(() => {
      removeNotification(id)
    }, duration)
  }

  function removeNotification(id) {
    list.value = list.value.filter((n) => n.id !== id)
  }

  function clearNotifications() {
    list.value = []
  }

  return { list, addNotification, removeNotification, clearNotifications }
})
