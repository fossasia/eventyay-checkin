export function getEventDisplayName(event) {
  if (typeof event?.name === 'string') {
    return event.name
  }

  if (event?.name && typeof event.name === 'object') {
    return event.name.en || Object.values(event.name)[0] || event.slug || 'Unnamed Event'
  }

  return event?.slug || 'Unnamed Event'
}

export function formatEventDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
