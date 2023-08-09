import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile, rm } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Callback, RegexMap, UpdateError, Spec } from '@knighted/specifier'

type Ext = '.js' | '.mjs' | '.cjs' | '.jsx' | '.ts' | '.mts' | '.cts' | '.tsx'
interface Extensions {
  '.js': Ext
  '.mjs': Ext
  '.cjs': Ext
  '.jsx': Ext
  '.ts': Ext
  '.mts': Ext
  '.cts': Ext
  '.tsx': Ext
}
type Map<Exts> = {
  [P in keyof Exts]?: Exts[P]
}
type BundleRecords = Record<string, { error: UpdateError | undefined; code: string }>
interface SpecifierOptions {
  /**
   * Maps one extension to another in specifiers and emitted filenames.
   * Use of `extMap` superscedes `handler` or `writer` if either is defined.
   */
  extMap?: Map<Extensions>
  handler?: Callback | RegexMap
  /**
   * If `true`, default writer will be used which rewrites the updated
   * code back to the original filename in `outDir`.
   *
   * Otherwise, a callback will be passed BundleRecords.
   */
  writer?: ((records: BundleRecords) => Promise<void>) | boolean
  hook?: 'writeBundle' | 'transform'
}

const getExtMap = (extMap: Map<Extensions>): RegexMap => {
  const map: RegexMap = {}

  Object.keys(extMap).forEach(ext => {
    // Map relative specifiers ending in `ext` to their defined mapping extension
    map[`^(\\.\\.?\\/)(.+)\\${ext}$`] = `$1$2${extMap[ext as Ext]}`
  })

  return map
}
export default function (options: SpecifierOptions): Plugin {
  const { handler, extMap, hook = 'writeBundle', writer = false } = options

  return {
    name: 'specifier',
    enforce: 'post',
    async transform(src, id) {
      if (hook === 'transform') {
        const updater = extMap ? getExtMap(extMap) : handler ?? {}
        const { code, error, map } = await specifier.updateSrc(src, updater, {
          sourceMap: true,
          dts: /\.d\.[mc]?ts$/.test(id),
        })

        if (code && map && !error) {
          return { code, map }
        }
      }

      return { code: src, map: null }
    },
    async writeBundle({ dir }, bundle) {
      if (hook === 'writeBundle') {
        const records: BundleRecords = {}
        const updater = extMap ? getExtMap(extMap) : handler ?? {}
        const files = Object.keys(bundle)
          .filter(filename => {
            return /\.js|\.mjs|\.cjs|\.jsx|\.ts|\.mts|\.cts|\.tsx/.test(extname(filename))
          })
          .map(filename => join(dir ?? `${join(cwd(), 'dist')}`, filename))

        for (const filename of files) {
          const update = await specifier.update(filename, updater)

          records[filename] = {
            code: update.code ?? '',
            error: update.error,
          }
        }

        if (extMap) {
          const files = Object.keys(records)

          for (const filename of files) {
            const fileExt = extname(filename) as Ext
            const newExt = extMap[fileExt] ?? ''
            const { code, error } = records[filename]

            if (!error && newExt) {
              await writeFile(
                filename.replace(new RegExp(`\\${fileExt}$`, 'i'), newExt),
                code,
              )
              await rm(filename, { force: true })
            }
          }
        } else {
          if (writer === true) {
            const files = Object.keys(records)

            for (const filename of files) {
              if (!records[filename].error) {
                await writeFile(filename, records[filename].code)
              }
            }
          }

          if (typeof writer === 'function') {
            await writer(records)
          }
        }
      }
    },
  }
}

export type { SpecifierOptions, Spec, RegexMap, Callback, UpdateError, BundleRecords }
