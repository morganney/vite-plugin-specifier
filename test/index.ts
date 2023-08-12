import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { cwd } from 'node:process'
import { existsSync } from 'node:fs'

import { build } from 'vite'

import viteSpecifier from '../src/index.js'

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
})
