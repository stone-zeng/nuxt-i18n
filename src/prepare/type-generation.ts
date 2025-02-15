import { relative, resolve } from 'pathe'
import { addServerHandler, addTypeTemplate, updateTemplates, useNitro } from '@nuxt/kit'

import type { Nuxt } from '@nuxt/schema'
import type { I18nOptions } from 'vue-i18n'
import type { I18nNuxtContext } from '../context'

/**
 * Simplifies messages object to properties of an interface
 */
function generateInterface(obj: Record<string, unknown>, indentLevel = 1) {
  const indent = '  '.repeat(indentLevel)
  let str = ''

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue

    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      str += `${indent}"${key}": {\n`
      str += generateInterface(obj[key] as Record<string, unknown>, indentLevel + 1)
      str += `${indent}};\n`
    } else {
      // str += `${indent}/**\n`
      // str += `${indent} * ${JSON.stringify(obj[key])}\n`
      // str += `${indent} */\n`
      let propertyType = Array.isArray(obj[key]) ? 'unknown[]' : typeof obj[key]
      if (propertyType === 'function') {
        propertyType = '() => string'
      }
      str += `${indent}"${key}": ${propertyType};\n`
    }
  }
  return str
}

const MERGED_OPTIONS_ENDPOINT = '__nuxt_i18n/merged'

export function prepareTypeGeneration(
  { resolver, options, localeInfo, vueI18nConfigPaths, isDev }: I18nNuxtContext,
  nuxt: Nuxt
) {
  if (options.experimental.typedOptionsAndMessages === false || !isDev) return

  addServerHandler({
    route: '/' + MERGED_OPTIONS_ENDPOINT,
    // @ts-ignore
    handler: resolver.resolve('./runtime/server/api/merged-options.get')
  })

  let res: Pick<I18nOptions, 'messages' | 'numberFormats' | 'datetimeFormats'>

  const fetchMergedOptions = () => fetch(nuxt.options.devServer.url + MERGED_OPTIONS_ENDPOINT, { cache: 'no-cache' })

  /**
   * We use a runtime server endpoint to retrieve and merge options,
   * to reuse existing options/message loading logic
   *
   * These hooks have been the most reliable way to fetch on startup when the endpoint is ready
   */
  nuxt.hooks.hookOnce('vite:serverCreated', () => {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const afterEachFn = useNitro().hooks.afterEach(async e => {
      if (e.name === 'dev:reload') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          res = await (await fetchMergedOptions()).json()
          await updateTemplates({ filter: template => template.filename === 'types/i18n-messages.d.ts' })
          afterEachFn()
        } catch {
          // console.log('fetching merged options endpoint failed')
        }
      }
    })
  })

  addTypeTemplate({
    filename: 'types/i18n-messages.d.ts',
    getContents: () => {
      // console.log(res)
      if (res == null) return ''

      return `// generated by @nuxtjs/i18n
import type { DateTimeFormatOptions, NumberFormatOptions, SpecificNumberFormatOptions, CurrencyNumberFormatOptions } from '@intlify/core'

interface GeneratedLocaleMessage {
  ${generateInterface(res.messages || {}).trim()}
}

interface GeneratedDateTimeFormat {
  ${Object.keys(res.datetimeFormats || {})
    .map(k => `${k}: DateTimeFormatOptions;`)
    .join(`\n  `)}
}

interface GeneratedNumberFormat {
  ${Object.entries(res.numberFormats || {})
    .map(([k]) => `${k}: NumberFormatOptions;`)
    .join(`\n  `)}
}

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends GeneratedLocaleMessage {}
  export interface DefineDateTimeFormat extends GeneratedDateTimeFormat {}
  export interface DefineNumberFormat extends GeneratedNumberFormat {}
}

declare module '@intlify/core' {
  export interface DefineCoreLocaleMessage extends GeneratedLocaleMessage {}
}

export {}`
    }
  })

  // watch locale files for changes and update template
  // TODO: consider conditionally checking absolute paths for Nuxt 4
  const localePaths = localeInfo.flatMap(x => x.files.map(f => relative(nuxt.options.srcDir, f.path)))
  nuxt.hook('builder:watch', async (_, path) => {
    // compatibility see https://nuxt.com/docs/getting-started/upgrade#absolute-watch-paths-in-builderwatch
    // TODO: consider conditionally checking absolute paths for Nuxt 4
    path = relative(nuxt.options.srcDir, resolve(nuxt.options.srcDir, path))

    if (!localePaths.includes(path) && !vueI18nConfigPaths.some(x => x.absolute.includes(path))) return
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    res = await (await fetchMergedOptions()).json()
    await updateTemplates({ filter: template => template.filename === 'types/i18n-messages.d.ts' })
  })
}
