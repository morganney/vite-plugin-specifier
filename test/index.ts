import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { cwd } from 'node:process'
import { existsSync } from 'node:fs'

import { build } from 'vite'
import type {
  PluginContext,
  TransformPluginContext,
  NormalizedOutputOptions,
  OutputBundle,
} from 'rollup'

import viteSpecifier from '../src/index.js'
import { specifier } from '@knighted/specifier'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixtures = resolve(__dirname, '__fixtures__')
const dist = join(fixtures, 'dist')
const tsc = join(cwd(), 'node_modules', '.bin', 'tsc')

describe('vite-plugin-specifier', () => {
  it('maps specifiers', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts'],
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
      },
      plugins: [
        viteSpecifier({
          map: {
            './foo.js': './baz.mjs',
            './bar.js': './qux.cjs',
          },
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const file = (await readFile(join(dist, 'file.js'))).toString()
    const foo = (await readFile(join(dist, 'foo.js'))).toString()

    assert.ok(file.indexOf('./baz.mjs') > -1)
    assert.ok(foo.indexOf('./qux.cjs') > -1)
  })

  it('remaps extensions and specifiers', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts'],
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
      },
      plugins: [
        viteSpecifier({
          extMap: {
            '.js': '.mjs',
          },
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const fileMjs = (await readFile(join(dist, 'file.mjs'))).toString()
    const fileCjs = (await readFile(join(dist, 'file.cjs'))).toString()

    assert.ok(fileMjs.indexOf('./foo.mjs') > -1)
    assert.ok(fileCjs.indexOf('./foo.cjs') > -1)
  })

  it('supports a handler and default writer', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts'],
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
      },
      plugins: [
        viteSpecifier({
          handler() {
            return 'test-specifier'
          },
          writer: true,
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const file = (await readFile(join(dist, 'file.js'))).toString()
    const matches = file.match(/test-specifier/g)

    assert.equal(matches?.length, 2)
  })

  it('supports dual builds with .d.ts in an extMap', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    const { status } = spawnSync(tsc, ['-p', 'test/__fixtures__/tsconfig.json'], {
      stdio: 'inherit',
    })

    assert.equal(status, 0)

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts'],
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
        emptyOutDir: false,
      },
      plugins: [
        viteSpecifier({
          extMap: {
            '.js': '.mjs',
            '.d.ts': 'dual',
          },
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 75))

    const file = (await readFile(join(dist, 'file.mjs'))).toString()
    const fileMts = (await readFile(join(dist, 'file.d.mts'))).toString()
    const fileCts = (await readFile(join(dist, 'file.d.cts'))).toString()

    assert.ok(file.indexOf('./foo.mjs') > -1)
    assert.ok(file.indexOf('./bar.mjs') > -1)
    assert.ok(fileMts.indexOf('./foo.mjs') > -1)
    assert.ok(fileCts.indexOf('./foo.cjs') > -1)
    assert.ok(!existsSync(join(dist, 'file.d.ts')))
  })

  it('supports .d.ts updates', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    const { status } = spawnSync(tsc, ['-p', 'test/__fixtures__/tsconfig.json'], {
      stdio: 'inherit',
    })

    assert.equal(status, 0)

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts'],
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
        emptyOutDir: false,
      },
      plugins: [
        viteSpecifier({
          extMap: {
            '.js': '.mjs',
            '.d.ts': '.d.mts',
          },
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 75))

    const file = (await readFile(join(dist, 'file.mjs'))).toString()
    const fileMts = (await readFile(join(dist, 'file.d.mts'))).toString()

    assert.ok(file.indexOf('./foo.mjs') > -1)
    assert.ok(file.indexOf('./bar.mjs') > -1)
    assert.ok(fileMts.indexOf('./foo.mjs') > -1)
    assert.ok(fileMts.indexOf('./bar.mjs') > -1)
  })

  it('can run during the transform hook', async t => {
    t.after(async () => {
      await rm(dist, { force: true, recursive: true })
    })

    await build({
      root: join(__dirname, '__fixtures__'),
      build: {
        lib: {
          entry: ['file.ts', 'bar.ts', 'foo.ts', 'test.ts', 'baz.ts'],
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            exports: 'named',
          },
        },
      },
      plugins: [
        viteSpecifier({
          hook: 'transform',
          handler({ value }) {
            if (value === './test.js') {
              return './baz.js'
            }
          },
        }),
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const file = (await readFile(join(dist, 'file.js'))).toString()

    assert.ok(file.indexOf('./baz.js') > -1)
  })

  it('covers transform language detection and error recovery', async () => {
    const plugin = viteSpecifier({
      hook: 'transform',
      handler: {},
    })

    const transformHook = plugin.transform
    const transform =
      typeof transformHook === 'function' ? transformHook : transformHook?.handler

    assert.ok(transform)

    const tsxSource = 'export const el = <div />'
    const jsxSource = 'export const el = <div />'

    const transformContext = {} as unknown as TransformPluginContext
    const tsxResult = await transform.call(
      transformContext,
      tsxSource,
      join(__dirname, 'inline.tsx'),
    )
    const jsxResult = await transform.call(
      transformContext,
      jsxSource,
      join(__dirname, 'inline.jsx'),
    )

    const tsxCode = typeof tsxResult === 'string' ? tsxResult : tsxResult?.code
    const jsxCode = typeof jsxResult === 'string' ? jsxResult : jsxResult?.code

    assert.equal(tsxCode, tsxSource)
    assert.equal(jsxCode, jsxSource)

    const originalUpdateSrc = specifier.updateSrc

    specifier.updateSrc = async () => {
      throw new Error('transform-failure')
    }

    const errorResult = await transform.call(
      transformContext,
      'export const x = 1',
      join(__dirname, 'err.js'),
    )

    const errorCode = typeof errorResult === 'string' ? errorResult : errorResult?.code

    assert.equal(errorCode, 'export const x = 1')

    specifier.updateSrc = originalUpdateSrc
  })

  it('handles update failures, map errors, and writer callbacks', async t => {
    const tmpDir = join(fixtures, 'tmp-write-bundle')
    const originalUpdate = specifier.update
    const originalUpdateSrc = specifier.updateSrc

    t.after(async () => {
      await rm(tmpDir, { force: true, recursive: true })
      specifier.update = originalUpdate
      specifier.updateSrc = originalUpdateSrc
    })

    await rm(tmpDir, { force: true, recursive: true })
    await mkdir(tmpDir, { recursive: true })

    await writeFile(
      join(tmpDir, 'ok.js'),
      `import './foo.js'
  export const ok = 1`,
    )
    await writeFile(
      join(tmpDir, 'fail-map.js'),
      `import './foo.js'
  export const fail = 1`,
    )
    await writeFile(join(tmpDir, 'throws.js'), 'export const bad = 1')

    let writerCalled = false

    specifier.update = async (filename, callback) => {
      if (filename.endsWith('throws.js')) {
        throw new Error('update-failure')
      }

      if (filename.endsWith('fail-map.js')) {
        return 'throw-map'
      }

      return originalUpdate(filename, callback)
    }

    specifier.updateSrc = async (code, lang, callback) => {
      if (code.includes('throw-map')) {
        throw new Error('map-failure')
      }

      return originalUpdateSrc(code, lang, callback)
    }

    const plugin = viteSpecifier({
      extMap: {
        '.js': '.mjs',
      },
      map: {
        './foo.mjs': './bar.mjs',
      },
      writer: async () => {
        writerCalled = true
      },
    })

    const writeBundleHook = plugin.writeBundle
    const writeBundle =
      typeof writeBundleHook === 'function' ? writeBundleHook : writeBundleHook?.handler

    const writeBundleContext = {} as unknown as PluginContext
    const outputOptions = { dir: tmpDir } as unknown as NormalizedOutputOptions
    const outputBundle = {
      'ok.js': {},
      'fail-map.js': {},
      'throws.js': {},
    } as unknown as OutputBundle

    await writeBundle?.call(writeBundleContext, outputOptions, outputBundle)

    assert.ok(writerCalled)
    assert.ok(existsSync(join(tmpDir, 'ok.mjs')))

    const okContent = (await readFile(join(tmpDir, 'ok.mjs'))).toString()

    assert.ok(okContent.includes('./bar.mjs'))
  })
})
