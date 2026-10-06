<script setup>
import { ref } from 'vue'
import { DialogTitle } from '@headlessui/vue'
import { useI18n } from 'vue-i18n'
import { PrinterIcon } from '@heroicons/vue/24/outline'
import { usePrintModalStore } from '@/stores/printModal'
import { useNotificationStore } from '@/stores/notification'
import ModalBaseTemplate from '@/components/Modals/ModalBaseTemplate.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import MultiListSelector from '@/components/Common/MultiListSelector.vue'

const { t } = useI18n()
const printModalStore = usePrintModalStore()
const notificationStore = useNotificationStore()

const disableButton = ref(false)
function printDelay(delayHideModal, delayPrint) {
  setTimeout(() => (printModalStore.showPrintModal = false), delayHideModal)
  setTimeout(() => {
    notificationStore.addNotification(
      [t('printModal.successfully_printed'), t('printModal.collect_ticket')],
      'success'
    )
    disableButton.value = false
    printModalStore.$reset()
  }, delayPrint)
}

function print() {
  printModalStore.printingText = true
  disableButton.value = true
  const stringFields = printModalStore.selectedOptions.map((element) => element.id).join(',')

  printModalStore.getPDF(stringFields)
  printDelay(3000, 3200)
}
</script>

<template>
  <ModalBaseTemplate :show="printModalStore.showPrintModal">
    <div>
      <!--Icons-->
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-info-light">
        <PrinterIcon class="h-6 w-6 text-info" aria-hidden="true" />
      </div>
      <!--Title-->
      <div class="mt-3 sm:mt-5">
        <div v-if="printModalStore.hasOptions">
          <DialogTitle as="h3" class="text-center">{{ t('printModal.select_fields_title') }}</DialogTitle>

          <!--Checklist-->
          <fieldset v-if="printModalStore.printOptions.length > 0">
            <div class="mt-3 space-x-3">
              <StandardButton
                :text="t('printModal.select_all')"
                class="bg-primary"
                @click="printModalStore.selectAll"
              />
              <StandardButton
                :text="t('printModal.deselect_all')"
                class="bg-secondary"
                @click="printModalStore.selectedOptions = []"
              />
            </div>
            <MultiListSelector
              :data="printModalStore.printOptions"
              :is-single="false"
              :selected-options="printModalStore.selectedOptions"
              @update-selected="(n) => (printModalStore.selectedOptions = n)"
            ></MultiListSelector>
          </fieldset>
          <p v-else class="text-center">{{ t('printModal.no_fields_to_select') }}</p>
          <p v-if="printModalStore.printingText" class="my-3 text-center">{{ t('printModal.printing_pass') }}</p>
        </div>
        <div v-else>
          <DialogTitle as="h3" class="text-center">{{ t('printModal.no_fields_title') }}</DialogTitle>
        </div>
      </div>
    </div>
    <!--  -->
    <iframe id="printFrame" class="hidden"> </iframe>
    <!--Print button-->
    <div class="mt-3">
      <div :class="[printModalStore.hasOptions ? 'grid-cols-2' : '', 'grid gap-3']">
        <StandardButton
          :type="'button'"
          :text="t('common.close')"
          class="btn-secondary w-full justify-center"
          @click="printModalStore.showPrintModal = false"
        />
        <StandardButton
          v-if="printModalStore.hasOptions"
          :text="t('common.print')"
          :disabled="disableButton"
          :class="[
            disableButton && 'cursor-not-allowed opacity-20',
            'w-full justify-center bg-primary text-white'
          ]"
          @click="print"
        />
      </div>
    </div>
  </ModalBaseTemplate>
</template>
