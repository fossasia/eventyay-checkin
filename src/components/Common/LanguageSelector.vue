<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  GlobeAltIcon,
  MagnifyingGlassIcon,
  XMarkIcon
} from '@heroicons/vue/24/outline'
import { CheckIcon, ChevronDownIcon } from '@heroicons/vue/20/solid'
import { SUPPORTED_LOCALES, TRANSLATED_LOCALES } from '@/i18n/locales'
import { setLocale } from '@/i18n'

const props = defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (val) => ['default', 'compact', 'inline'].includes(val)
  }
})

const { locale, t } = useI18n()

const isOpen = ref(false)
const searchQuery = ref('')
const activeTab = ref('translated') // 'translated' | 'all'
const searchInputRef = ref(null)

const currentLocale = computed(() => {
  return (
    SUPPORTED_LOCALES.find((l) => l.code === locale.value) ||
    SUPPORTED_LOCALES[0]
  )
})

const translatedLocales = computed(() => TRANSLATED_LOCALES)

const filteredLocales = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    if (activeTab.value === 'translated') {
      return translatedLocales.value
    }
    return SUPPORTED_LOCALES
  }

  return SUPPORTED_LOCALES.filter(
    (l) =>
      l.name.toLowerCase().includes(query) ||
      l.nativeName.toLowerCase().includes(query) ||
      l.code.toLowerCase().includes(query)
  )
})

function toggleOpen() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    searchQuery.value = ''
    nextTick(() => {
      searchInputRef.value?.focus()
    })
  }
}

function close() {
  isOpen.value = false
  searchQuery.value = ''
}

function onSelectLocale(code) {
  setLocale(code)
  close()
}

watch(isOpen, (val) => {
  if (val && typeof document !== 'undefined') {
    // Prevent body scrolling on mobile sheet
    if (window.innerWidth < 640) {
      document.body.style.overflow = 'hidden'
    }
  } else if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <div class="relative inline-block text-left">
    <!-- Trigger Button -->
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-medium text-body shadow-sm transition hover:bg-surface-muted hover:text-body focus:outline-none focus:ring-2 focus:ring-primary/20"
      :class="props.variant === 'compact' ? 'px-2 py-1.5' : ''"
      :aria-label="t('navbar.select_language')"
      :aria-expanded="isOpen"
      @click="toggleOpen"
    >
      <GlobeAltIcon class="h-4 w-4 shrink-0 text-body-muted" aria-hidden="true" />
      <span
        v-if="props.variant !== 'compact'"
        class="max-w-[7rem] truncate text-xs font-medium"
      >
        {{ currentLocale.nativeName }}
      </span>
      <ChevronDownIcon class="h-3.5 w-3.5 shrink-0 text-body-muted" aria-hidden="true" />
    </button>

    <!-- Desktop Dropdown Menu (>= 640px) -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-40 hidden sm:block"
      @click="close"
    />

    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <div
        v-if="isOpen"
        class="absolute right-0 z-50 mt-1 hidden w-72 origin-top-right rounded-2xl border border-surface-border bg-surface p-2 shadow-xl focus:outline-none sm:block"
      >
        <!-- Search bar -->
        <div class="relative mb-2">
          <MagnifyingGlassIcon
            class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-body-muted"
          />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            :placeholder="t('common.search') + '…'"
            class="w-full rounded-lg border border-surface-border bg-surface-muted py-1.5 pl-8 pr-7 text-xs text-body placeholder:text-body-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-body-muted hover:text-body"
            @click="searchQuery = ''"
          >
            <XMarkIcon class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- Filter tabs when not searching -->
        <div v-if="!searchQuery" class="mb-2 flex rounded-lg bg-surface-muted p-0.5 text-[11px]">
          <button
            type="button"
            class="flex-1 rounded-md py-1 font-medium transition"
            :class="
              activeTab === 'translated'
                ? 'bg-surface text-primary shadow-xs'
                : 'text-body-muted hover:text-body'
            "
            @click="activeTab = 'translated'"
          >
            Translated ({{ translatedLocales.length }})
          </button>
          <button
            type="button"
            class="flex-1 rounded-md py-1 font-medium transition"
            :class="
              activeTab === 'all'
                ? 'bg-surface text-primary shadow-xs'
                : 'text-body-muted hover:text-body'
            "
            @click="activeTab = 'all'"
          >
            All ({{ SUPPORTED_LOCALES.length }})
          </button>
        </div>

        <!-- Locales list -->
        <div class="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
          <button
            v-for="item in filteredLocales"
            :key="item.code"
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition"
            :class="[
              item.code === locale ? 'bg-primary/10 font-semibold text-primary' : 'text-body hover:bg-surface-muted'
            ]"
            @click="onSelectLocale(item.code)"
          >
            <div class="flex flex-col">
              <span class="leading-tight">{{ item.nativeName }}</span>
              <span class="text-[10px] text-body-muted leading-tight">
                {{ item.name }}
                <span v-if="!item.hasTranslations" class="ml-1 text-[9px] text-amber-500 font-normal">
                  (Weblate)
                </span>
              </span>
            </div>
            <CheckIcon
              v-if="item.code === locale"
              class="h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          </button>

          <p
            v-if="filteredLocales.length === 0"
            class="py-4 text-center text-xs text-body-muted"
          >
            No language found
          </p>
        </div>
      </div>
    </transition>

    <!-- Mobile Sheet / Modal (< 640px) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs sm:hidden"
        @click.self="close"
      >
        <div
          class="flex max-h-[85dvh] w-full flex-col rounded-t-3xl border-t border-surface-border bg-surface p-4 shadow-2xl"
        >
          <!-- Header -->
          <div class="mb-3 flex items-center justify-between pb-2 border-b border-surface-border">
            <div class="flex items-center gap-2">
              <GlobeAltIcon class="h-5 w-5 text-primary" />
              <h3 class="text-sm font-bold text-body">
                {{ t('navbar.select_language') }}
              </h3>
            </div>
            <button
              type="button"
              class="rounded-full p-1.5 text-body-muted hover:bg-surface-muted hover:text-body"
              @click="close"
            >
              <XMarkIcon class="h-5 w-5" />
            </button>
          </div>

          <!-- Mobile search input -->
          <div class="relative mb-3">
            <MagnifyingGlassIcon
              class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-body-muted"
            />
            <input
              v-model="searchQuery"
              type="search"
              :placeholder="t('common.search') + '…'"
              class="w-full rounded-xl border border-surface-border bg-surface-muted py-2 pl-9 pr-8 text-sm text-body placeholder:text-body-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-body-muted hover:text-body"
              @click="searchQuery = ''"
            >
              <XMarkIcon class="h-4 w-4" />
            </button>
          </div>

          <!-- Filter tabs on mobile -->
          <div v-if="!searchQuery" class="mb-3 flex rounded-xl bg-surface-muted p-1 text-xs">
            <button
              type="button"
              class="flex-1 rounded-lg py-1.5 font-medium transition"
              :class="
                activeTab === 'translated'
                  ? 'bg-surface text-primary shadow-xs'
                  : 'text-body-muted'
              "
              @click="activeTab = 'translated'"
            >
              Translated ({{ translatedLocales.length }})
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg py-1.5 font-medium transition"
              :class="
                activeTab === 'all'
                  ? 'bg-surface text-primary shadow-xs'
                  : 'text-body-muted'
              "
              @click="activeTab = 'all'"
            >
              All ({{ SUPPORTED_LOCALES.length }})
            </button>
          </div>

          <!-- Scrollable Languages List -->
          <div class="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1 pb-4">
            <button
              v-for="item in filteredLocales"
              :key="item.code"
              type="button"
              class="flex w-full items-center justify-between rounded-xl p-3 text-left transition active:scale-[0.99]"
              :class="[
                item.code === locale
                  ? 'border border-primary/30 bg-primary/10 font-bold text-primary'
                  : 'border border-transparent bg-surface hover:bg-surface-muted text-body'
              ]"
              @click="onSelectLocale(item.code)"
            >
              <div class="flex flex-col">
                <span class="text-sm">{{ item.nativeName }}</span>
                <span class="text-xs text-body-muted">
                  {{ item.name }}
                  <span v-if="!item.hasTranslations" class="ml-1 text-[10px] text-amber-500 font-normal">
                    (Weblate)
                  </span>
                </span>
              </div>
              <CheckIcon
                v-if="item.code === locale"
                class="h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            </button>

            <p
              v-if="filteredLocales.length === 0"
              class="py-6 text-center text-sm text-body-muted"
            >
              No language found
            </p>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>
