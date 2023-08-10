import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile, rm } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'
import { glob } from 'glob'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Callback, RegexMap, UpdateError, Spec } from '@knighted/specifier'

type Ext = '.js' | '.mjs' | '.cjs'
interface Extensions {
  '.js': '.mjs' | '.cjs'
  '.mjs': '.js'
  '.cjs': '.js'
  '.jsx': '.js' | '.mjs' | '.cjs'
  '.ts': '.js' | '.mjs' | '.cjs'
  '.mts': '.mjs' | '.js'
  '.cts': '.cjs' | '.js'
  '.tsx': '.js' | '.mjs' | '.cjs'
  '.d.ts': '.mjs' | '.cjs' | 'dual'
}
type Map<Exts> = {
  [P in keyof Exts]?: Exts[P]
}
type BundleRecords = Record<string, { error: UpdateError | undefined; code: string }>
interface SpecifierOptions {
  /**
   * Maps the key to the value if key equals a specifier.
   */
  map?: Record<string, string>
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
    if (!/\.d\.ts$/i.test(ext)) {
      // Map relative specifiers ending in `ext` to their defined mapping extension
      map[`^(\\.\\.?\\/)(.+)\\${ext}$`] = `$1$2${extMap[ext as Ext]}`
    }
  })

  return map
}
export default function (options: SpecifierOptions): Plugin {
  const {
    handler,
    extMap,
    map: specifierMap,
    hook = 'writeBundle',
    writer = false,
  } = options

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
              // Check for .d.ts files being converted to .d.mts and .d.cts.
              if (newExt === 'dual') {
                const isCjs = extMap['.js'] === '.mjs'
                const targetExt = isCjs ? '.cjs' : '.mjs'
                const { code: dual } = await specifier.update(filename, ({ value }) => {
                  if (value.startsWith('./') || value.startsWith('../')) {
                    return value.replace(/(.+)\.(?:js|mjs|cjs)$/, `$1${targetExt}`)
                  }
                })

                if (dual) {
                  await writeFile(
                    filename.replace(/\.d\.ts$/i, isCjs ? '.d.cts' : '.d.mts'),
                    dual,
                  )
                }

                await writeFile(
                  filename.replace(/\.d\.ts$/i, isCjs ? '.d.mts' : '.d.cts'),
                  code,
                )
              } else if (fileIsDec) {
                const update = await specifier.update(filename, ({ value }) => {
                  if (value.startsWith('./') || value.startsWith('../')) {
                    return value.replace(/(.+)\.(?:js|mjs|cjs)$/, `$1${newExt}`)
                  }
                })

                if (update.code) {
                  await writeFile(
                    filename.replace(
                      /\.d\.ts$/i,
                      newExt === '.mjs' ? '.d.mts' : '.d.cts',
                    ),
                    update.code,
                  )
                }
              } else {
                await writeFile(
                  filename.replace(new RegExp(`\\${fileExt}$`, 'i'), newExt),
                  code,
                )
              }

              await rm(filename, { force: true })
            }
          }
        }

        if (specifierMap) {
          const map = new Map(Object.entries(specifierMap))

          for (const filename of files) {
            if (!records[filename].error) {
              const { code, error } = await specifier.updateSrc(
                records[filename].code,
                ({ value }) => {
                  if (map.has(value)) {
                    return map.get(value)
                  }
                },
              )

              if (code && !error) {
                const ext = extname(filename) as Ext
                const newExt = extMap ? extMap[ext] ?? false : false

                await writeFile(
                  newExt
                    ? filename.replace(new RegExp(`\\${ext}$`, 'i'), newExt)
                    : filename,
                  code,
                )
              }
            }
          }
        }

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
    },
  }
}

export type { SpecifierOptions, Spec, RegexMap, Callback, UpdateError, BundleRecords }
