import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile, rm } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'
import { glob } from 'glob'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Callback, RegexMap, UpdateError, Spec } from '@knighted/specifier'

type Ext = '.js' | '.mjs' | '.cjs' | '.d.ts'
interface Extensions {
  '.js': '.mjs' | '.cjs'
  '.mjs': '.js'
  '.cjs': '.js'
  '.jsx': '.js' | '.mjs' | '.cjs'
  '.ts': '.js' | '.mjs' | '.cjs'
  '.mts': '.mjs' | '.js'
  '.cts': '.cjs' | '.js'
  '.tsx': '.js' | '.mjs' | '.cjs'
  '.d.ts': '.d.mts' | '.d.cts' | 'dual'
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
        const outDir = dir ?? join(cwd(), 'dist')
        const updater = extMap ? getExtMap(extMap) : handler ?? {}
        const dts = await glob(`${outDir}/**/*.d.ts`, {
          ignore: 'node_modules/**',
        })
        const files = Object.keys(bundle)
          .filter(filename => {
            return /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/.test(filename)
          })
          .map(filename => join(outDir, filename))
          .concat(dts)

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
            const fileIsDec = /\.d\.ts$/.test(filename)
            const fileExt = fileIsDec ? '.d.ts' : (extname(filename) as Ext)
            const newExt = extMap[fileExt] ?? ''
            const { code, error } = records[filename]

            if (!error && newExt) {
              // Check for .d.ts files being converted to .d.mts and .d.cts
              if (newExt === 'dual') {
                await writeFile(filename.replace(/\.d\.ts$/i, '.d.mts'), code)
                await writeFile(filename.replace(/\.d\.ts$/i, '.d.cts'), code)
              } else {
                await writeFile(
                  filename.replace(
                    new RegExp(
                      `${fileIsDec ? fileExt.split('.').join('\\.') : `\\${fileExt}`}$`,
                      'i',
                    ),
                    newExt,
                  ),
                  code,
                )
              }

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
