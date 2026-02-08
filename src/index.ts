import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile, rm } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'
import { glob } from 'glob'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Spec } from '@knighted/specifier'

type Ext = '.js' | '.mjs' | '.cjs'
type ParserLang = 'js' | 'ts' | 'jsx' | 'tsx'
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
type RegexMap = Record<string, string>
type Callback = (spec: Spec) => string | void
type UpdateError = Error
type Updater = Callback | RegexMap
interface SpecifierOptions {
  /**
   * Maps the key to the value if key equals a specifier.
   */
  map?: Record<string, string>
  /**
   * Maps one extension to another in specifiers and emitted filenames.
   * If you define a `writer` in addition to `extMap`, then the writer
   * operates on files already updated by the `extMap` default writer.
   */
  extMap?: Map<Extensions>
  handler?: Updater
  /**
   * If `true`, default writer will be used which rewrites the updated
   * code back to the original filename in `outDir`.
   *
   * Otherwise, a callback will be passed `BundleRecords`. The writer
   * defined here operates after any default writer from an `extMap`,
   * or `map` definition.
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

const getLang = (filename: string): ParserLang => {
  if (/\.(d\.)?(m|c)?ts$/i.test(filename)) {
    return 'ts'
  }

  if (/\.tsx$/i.test(filename)) {
    return 'tsx'
  }

  if (/\.jsx$/i.test(filename)) {
    return 'jsx'
  }

  return 'js'
}

const toCallback = (updater: Updater): Callback => {
  if (typeof updater === 'function') {
    return updater
  }

  const entries = Object.entries(updater)

  return ({ value }) => {
    for (const [pattern, replacement] of entries) {
      const regex = new RegExp(pattern)

      if (regex.test(value)) {
        return value.replace(regex, replacement)
      }
    }
  }
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

        try {
          const code = await specifier.updateSrc(src, getLang(id), toCallback(updater))

          return { code, map: null }
        } catch {
          return { code: src, map: null }
        }
      }

      return { code: src, map: null }
    },
    async writeBundle({ dir }, bundle) {
      if (hook === 'writeBundle') {
        const records: BundleRecords = {}
        const outDir = dir ?? join(cwd(), 'dist')
        const updater = extMap ? getExtMap(extMap) : handler ?? {}
        const callback = toCallback(updater)
        const dts = await glob(`${outDir}/**/*.d.ts`, {
          ignore: 'node_modules/**',
        })
        const files = Object.keys(bundle)
          .filter(filename => {
            return /\.(js|mjs|cjs)$/.test(filename)
          })
          .map(filename => join(outDir, filename))
          .concat(dts)

        for (const filename of files) {
          try {
            const code = await specifier.update(filename, callback)

            records[filename] = {
              code,
              error: undefined,
            }
          } catch (error) {
            records[filename] = {
              code: '',
              error:
                error instanceof Error ? error : new Error('Specifier update failed'),
            }
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
                const dual = await specifier.update(filename, ({ value }) => {
                  if (value.startsWith('./') || value.startsWith('../')) {
                    return value.replace(/(.+)\.(?:js|mjs|cjs)$/, `$1${targetExt}`)
                  }
                })

                await writeFile(
                  filename.replace(/\.d\.ts$/i, isCjs ? '.d.cts' : '.d.mts'),
                  dual,
                )

                await writeFile(
                  filename.replace(/\.d\.ts$/i, isCjs ? '.d.mts' : '.d.cts'),
                  code,
                )
              } else if (fileIsDec) {
                await writeFile(filename.replace(/\.d\.ts$/i, newExt), code)
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
              try {
                const code = await specifier.updateSrc(
                  records[filename].code,
                  getLang(filename),
                  ({ value }) => {
                    if (map.has(value)) {
                      return map.get(value)
                    }
                  },
                )

                const ext = extname(filename) as Ext
                const newExt = extMap ? extMap[ext] ?? false : false

                await writeFile(
                  newExt
                    ? filename.replace(new RegExp(`\\${ext}$`, 'i'), newExt)
                    : filename,
                  code,
                )
              } catch {
                continue
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
