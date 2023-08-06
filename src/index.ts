import { cwd } from 'node:process'
import { extname, join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { specifier } from '@knighted/specifier'

import type { Plugin } from 'vite' assert { 'resolution-mode': 'import' }
import type { Callback, RegexMap, UpdateError, Spec } from '@knighted/specifier'

interface SpecifierOptions {
  handler: Callback | RegexMap
  writer?: boolean | ((code: string | UpdateError, filename: string) => Promise<void>)
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
        const files = Object.keys(bundle)
          .filter(filename => {
            return /\.js|\.mjs|\.cjs|\.jsx|\.ts|\.mts|\.cts|\.tsx/.test(extname(filename))
          })
          .map(filename => join(dir ?? `${join(cwd(), 'dist')}`, filename))

        for (const filename of files) {
          const code = await specifier.update(filename, handler)

          if (typeof code === 'string') {
            if (writer === true) {
              try {
                await writeFile(filename, code)
              } catch (err) {
                if (err instanceof Error) {
                  // eslint-disable-next-line no-console
                  console.log(`Unable to write filename ${filename}: ${err.message}`)
                }
              }
            }

            if (typeof writer === 'function') {
              await writer(code, filename)
            }
          }
        }
      }
    },
  }
}

export type { SpecifierOptions, Spec, RegexMap, Callback, UpdateError }
