import { useAttendeesStore } from '@/stores/attendees'
import { useCameraStore } from '@/stores/camera'
import { useEventsStore } from '@/stores/events'
import { usePasswordModalStore } from '@/stores/passwordModal'
import { usePrintModalStore } from '@/stores/printModal'
import { useSessionsStore } from '@/stores/sessions'
import { useStationLockStore } from '@/stores/stationLock'
import { useStationsStore } from '@/stores/stations'
import { useStationSelectorStore } from '@/stores/stationSelector'
import { useTicketsStore } from '@/stores/tickets'
import { useUserStore } from '@/stores/user'

export default function clearStores() {
  const attendeesStore = useAttendeesStore()
  const cameraStore = useCameraStore()
  const eventsStore = useEventsStore()
  const passwordModalStore = usePasswordModalStore()
  const printModalStore = usePrintModalStore()
  const sessionsStore = useSessionsStore()
  const stationLockStore = useStationLockStore()
  const stationsStore = useStationsStore()
  const stationSelectorStore = useStationSelectorStore()
  const ticketsStore = useTicketsStore()
  const userStore = useUserStore()

  attendeesStore.$reset()
  cameraStore.$reset()
  eventsStore.$reset()
  passwordModalStore.$reset()
  printModalStore.$reset()
  sessionsStore.$reset()
  stationLockStore.$reset()
  stationsStore.$reset()
  stationSelectorStore.$reset()
  ticketsStore.$reset()
  userStore.$reset()
}
