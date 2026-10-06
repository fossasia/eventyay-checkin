#!/usr/bin/env node

/**
 * CI/Pre-commit validation script for Eventyay Check-in i18n and Weblate compatibility.
 *
 * Checks:
 * 1. .weblate.json exists and is valid JSON.
 * 2. Base locale (en.json) exists, is valid JSON, and has keys.
 * 3. All translated locales (14 locales: en, es, fr, de, hi, zh, zh_Hans, ar, pt, pt_BR, ru, ja, vi, th)
 *    have 100% key parity with en.json.
 * 4. Placeholder parameter matching: {param} variables in translations match base keys.
 * 5. All other Weblate locale files in src/locales/*.json are valid JSON (empty {} or partially translated).
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const LOCALES_DIR = resolve(ROOT, 'src/locales')
const WEBLATE_CONFIG = resolve(ROOT, '.weblate.json')

// The fully supported core translated locales
const CORE_TRANSLATED_LOCALES = new Set([
  'en',
  'es',
  'fr',
  'de',
  'hi',
  'zh',
  'zh_Hans',
  'ar',
  'pt',
  'pt_BR',
  'ru',
  'ja',
  'vi',
  'th'
])

function flattenKeys(obj, prefix = '') {
  let keys = []
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      keys = keys.concat(flattenKeys(val, fullPath))
    } else {
      keys.push({ key: fullPath, value: String(val) })
    }
  }
  return keys
}

function extractParams(str) {
  const matches = str.match(/\{([^}]+)\}/g) || []
  return matches.map((m) => m.slice(1, -1).trim()).sort()
}

function runCheck() {
  console.log('--- Checking i18n & Weblate Compliance ---')
  let hasErrors = false

  // 1. Verify .weblate.json (optional)
  if (existsSync(WEBLATE_CONFIG)) {
    try {
      JSON.parse(readFileSync(WEBLATE_CONFIG, 'utf-8'))
      console.log('✅ .weblate.json is valid.')
    } catch (err) {
      console.error('❌ Error: .weblate.json is not valid JSON:', err.message)
      hasErrors = true
    }
  }

  // 2. Verify base locale en.json
  const enPath = resolve(LOCALES_DIR, 'en.json')
  if (!existsSync(enPath)) {
    console.error('❌ Error: Base locale file src/locales/en.json is missing.')
    process.exit(1)
  }

  let enContent
  try {
    enContent = JSON.parse(readFileSync(enPath, 'utf-8'))
  } catch (err) {
    console.error('❌ Error: src/locales/en.json contains invalid JSON:', err.message)
    process.exit(1)
  }

  const enKeyItems = flattenKeys(enContent)
  const enKeys = new Set(enKeyItems.map((k) => k.key))
  const enParamMap = new Map(enKeyItems.map((k) => [k.key, extractParams(k.value)]))
  console.log(`✅ Base locale (en) loaded with ${enKeys.size} translation keys.`)

  // 3. Scan all locale files
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'))
  let translatedCount = 0
  let pendingCount = 0

  for (const file of files.sort()) {
    const localeCode = basename(file, '.json')
    const filePath = resolve(LOCALES_DIR, file)

    let content
    try {
      content = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      console.error(`❌ Error in ${file}: Invalid JSON (${err.message})`)
      hasErrors = true
      continue
    }

    const isCore = CORE_TRANSLATED_LOCALES.has(localeCode)
    const keyItems = flattenKeys(content)
    const keys = new Set(keyItems.map((k) => k.key))

    if (isCore) {
      translatedCount++
      const missingKeys = [...enKeys].filter((k) => !keys.has(k))
      const extraKeys = [...keys].filter((k) => !enKeys.has(k))

      if (missingKeys.length > 0) {
        console.error(`❌ [${localeCode}] Missing ${missingKeys.length} keys:`, missingKeys.slice(0, 5))
        hasErrors = true
      }
      if (extraKeys.length > 0) {
        console.error(`❌ [${localeCode}] Extraneous ${extraKeys.length} keys:`, extraKeys.slice(0, 5))
        hasErrors = true
      }

      // Check placeholder parameter matching
      for (const item of keyItems) {
        const expectedParams = enParamMap.get(item.key) || []
        const actualParams = extractParams(item.value)
        if (expectedParams.join(',') !== actualParams.join(',')) {
          console.error(
            `❌ [${localeCode}] Param mismatch in "${item.key}": expected {${expectedParams.join(', ')}}, found {${actualParams.join(', ')}}`
          )
          hasErrors = true
        }
      }

      if (missingKeys.length === 0 && extraKeys.length === 0) {
        console.log(`✅ [${localeCode}] 100% key match (${keys.size} keys).`)
      }
    } else {
      pendingCount++
    }
  }

  console.log(`\n📊 Summary: ${translatedCount} fully translated locales, ${pendingCount} pending Weblate locales (${files.length} total files).`)

  if (hasErrors) {
    console.error('❌ i18n validation failed.')
    process.exit(1)
  }

  console.log('🎉 All i18n locales are valid, in sync, and Weblate-compliant!\n')
}

runCheck()
