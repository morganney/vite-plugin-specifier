import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Callback, RegexMap, UpdateError, Spec } from '@knighted/specifier'

interface SpecifierOptions {
  handler: Callback | RegexMap
  /**
   * If `true`, default writer will be used which rewrites the updated
   * code back to the original filename in `outDir`.
   * 
   * Otherwise, a callback will be passed a Record<string, string> of
   * { [filename: string]: updatedCode }.
   */
  writer?: boolean | ((records: Record<string, string>) => Promise<void>)
  hook?: 'writeBundle' | 'transform'
}

export default function (options: SpecifierOptions): Plugin {
  const { handler, hook = 'writeBundle', writer = false } = options

  return {
    name: 'specifier',
    enforce: 'post',
    async transform(code: string) {
      if (hook === 'transform') {
        const update = await specifier.updateSrc(code, handler)

        if (!update.error) {
          return { code: update.code, map: update.map }
        }
      }

      return { code, map: null }
    },
    async writeBundle({ dir }, bundle) {
      if (hook === 'writeBundle') {
        const records: Record<string, string> = {}
        const files = Object.keys(bundle)
          .filter(filename => {
            return /\.js|\.mjs|\.cjs|\.jsx|\.ts|\.mts|\.cts|\.tsx/.test(extname(filename))
          })
          .map(filename => join(dir ?? `${join(cwd(), 'dist')}`, filename))

        for (const filename of files) {
          const codeOrError = await specifier.update(filename, handler)

          if (typeof codeOrError === 'string') {
            records[filename] = codeOrError
          }
        }

        if (writer === true) {
          const files = Object.keys(records)

          for (const filename of files) {
            try {
              await writeFile(filename, records[filename])
            } catch (err) {
              if (err instanceof Error) {
                // eslint-disable-next-line no-console
                console.log(`Unable to write filename ${filename}: ${err.message}`)
              }
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

export type { SpecifierOptions, Spec, RegexMap, Callback, UpdateError }
