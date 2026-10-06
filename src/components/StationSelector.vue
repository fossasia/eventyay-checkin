<script setup>
import { onBeforeMount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventsStore } from '@/stores/events'
import { useStationsStore } from '@/stores/stations'
import { useStationSelectorStore } from '@/stores/stationSelector'
import { useRouter } from 'vue-router'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import ListboxSelector from '@/components/Common/ListboxSelector.vue'
import StandardButton from '@/components/Common/StandardButton.vue'

const { t } = useI18n()

// stores
const eventsStore = useEventsStore()
const stationsStore = useStationsStore()
const stationSelectorStore = useStationSelectorStore()
const loadingStore = useLoadingStore()
const notificationStore = useNotificationStore()
loadingStore.contentLoading()

// router
const router = useRouter()

onBeforeMount(async () => {
  await eventsStore.getEvents().catch(() => {
    // if error, kick user to login page
    router.replace({
      name: 'userAuth'
    })
  })
  loadingStore.contentLoaded()
})

async function createStation() {
  const stationType = stationSelectorStore.selectedType.id
  // find station type's type from stationTypes
  const stationTypeObj = stationsStore.stationTypes.find((type) => type.id === stationType)
  let payload = {
    data: {
      attributes: {
        'station-name': stationSelectorStore.newStationName,
        //  registration | daily | check in | check out
        'station-type': stationTypeObj.type
      },
      relationships: {
        event: {
          data: {
            type: 'event',
            id: stationSelectorStore.selectedEvent.id
          }
        }
      },
      type: 'station'
    }
  }

  if (!stationSelectorStore.isRegisterDailyStations) {
    // but if station type is not registration/daily, use location name
    payload.data.attributes['station-name'] = stationSelectorStore.selectedStation.name
    // add microlocation data to relationships in payload
    payload.data.relationships.microlocation = {
      data: {
        id: stationSelectorStore.selectedStation.id,
        type: 'microlocation'
      }
    }
  }

  try {
    await stationSelectorStore.createStation(payload)
  } catch (error) {
    // show notification error
    loadingStore.contentLoaded()
    notificationStore.addNotification([t('common.error'), t('stationSelector.error_create_station')], 'error')
  }
}

function completeSelection() {
  let routerObj = {
    name: stationSelectorStore.selectedType.href,
    params: {
      eventId: stationSelectorStore.selectedEvent.id,
      // statopmId is microlocation in not checkin/checkout
      stationId: stationSelectorStore.selectedStation.id
    }
  }

  if (stationSelectorStore.isRegisterStations) {
    // remove the scannerType
    delete routerObj.params.scannerType
    routerObj.params.registrationType = stationSelectorStore.selectedType.id
  } else {
    // remove registrationType
    delete routerObj.params.registrationType
    routerObj.params.scannerType = stationSelectorStore.selectedType.id
  }

  // clear store before redirect
  stationSelectorStore.$reset()
  router.push(routerObj)
}

async function submitForm() {
  loadingStore.contentLoading()

  if (
    stationSelectorStore.isRegisterDailyStations &&
    stationSelectorStore.selectedStation.id === 'create-new'
  ) {
    await createStation()
  }

  // front end to lock only one station for checkin and checkout
  // station, check if station exist else create
  if (stationSelectorStore.selectedType.id === 'check-in') {
    if (stationsStore.checkInStations.length < 1) {
      // means station not created
      await createStation()
    }
  }

  if (stationSelectorStore.selectedType.id === 'checkout') {
    if (stationsStore.checkOutStations.length < 1) {
      // means station not created
      await createStation()
    }
  }

  completeSelection()
}
</script>

<template>
  <div class="-mt-16 flex h-screen flex-col justify-center">
    <div class="my-auto sm:mx-auto sm:w-full sm:max-w-sm">
      <h2 class="text-center">{{ t('stationSelector.select_event_title') }}</h2>
      <form class="mt-10 space-y-3" @submit.prevent="submitForm">
        <ListboxSelector
          :select-text="t('stationSelector.select_event_placeholder')"
          :label="t('stationSelector.event_label')"
          :data="eventsStore.userEvents"
          :selected-option="stationSelectorStore.selectedEvent"
          @update-selected="(n) => stationSelectorStore.$patch({ selectedEvent: n })"
        ></ListboxSelector>
        <!-- select booth type -->
        <ListboxSelector
          v-if="stationSelectorStore.selectedEvent.id"
          :select-text="t('stationSelector.select_type_placeholder')"
          :label="t('stationSelector.type_label')"
          :data="stationsStore.stationTypes"
          :selected-option="stationSelectorStore.selectedType"
          @update-selected="(n) => stationSelectorStore.$patch({ selectedType: n })"
        ></ListboxSelector>
        <!-- allow user to select booth or give a new field to store booth -->
        <!-- for session checkin and checkout, only retrieve locations from api and not able to create new -->
        <ListboxSelector
          v-if="stationSelectorStore.isStationType"
          :select-text="t('stationSelector.select_station_placeholder')"
          :label="t('stationSelector.station_label')"
          :data="stationSelectorStore.availableStations"
          :selected-option="stationSelectorStore.selectedStation"
          @update-selected="(n) => stationSelectorStore.$patch({ selectedStation: n })"
        ></ListboxSelector>
        <!-- allow user to select microlocation or give a new field to store microlocation -->
        <!-- for microlocation checkin and checkout, only retrieve locations from api and not able to create new -->
        <ListboxSelector
          v-if="
            !stationSelectorStore.isStationType && stationSelectorStore.isStationType !== undefined
          "
          :select-text="t('stationSelector.select_microlocation_placeholder')"
          :label="t('stationSelector.microlocation_label')"
          :data="eventsStore.eventMicrolocations"
          :selected-option="stationSelectorStore.selectedStation"
          @update-selected="(n) => stationSelectorStore.$patch({ selectedStation: n })"
        ></ListboxSelector>

        <!-- display if create new booth is selected -->
        <div v-if="stationSelectorStore.isCreateNewStation">
          <label for="station">{{ t('stationSelector.station_name_label') }}</label>
          <div class="mt-2">
            <input
              id="station"
              v-model="stationSelectorStore.newStationName"
              name="station"
              type="text"
              required="true"
              :placeholder="t('stationSelector.enter_station_name')"
              class="block w-full"
            />
          </div>
        </div>

        <div>
          <StandardButton
            :disabled="!stationSelectorStore.validation"
            :type="'submit'"
            :text="t('common.go')"
            class="btn-primary mt-6 w-full justify-center"
          />
        </div>
      </form>
    </div>
  </div>
</template>
