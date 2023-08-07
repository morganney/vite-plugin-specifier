# [`vite-plugin-specifier`](https://www.npmjs.com/package/vite-plugin-specifier)

![CI](https://github.com/morganney/vite-plugin-specifier/actions/workflows/ci.yml/badge.svg)
[![NPM version](https://img.shields.io/npm/v/vite-plugin-specifier.svg)](https://www.npmjs.com/package/vite-plugin-specifier)

Vite plugin to update your ESM and CJS specifiers.

## Why would I need this?

Maybe you're running vite in [library mode](https://vitejs.dev/guide/build.html#library-mode), or using a plugin like [`vite-plugin-no-bundle`](https://github.com/ManBearTM/vite-plugin-no-bundle), and **you want to be able to change the default specifier and file extensions** generated by vite. This plugin allows you to do that using whatever `type` you want in your package.json.

## Example

Given an ESM-first (`"type": "module"`) project with this structure:

```
.
├── src/
│   ├── index.ts
│   └── file.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

You can [build a library](https://vitejs.dev/guide/build.html#library-mode) in both ESM and CJS [`build.lib.formats`](https://vitejs.dev/config/build-options.html#build-lib), _but use **`.mjs`** extensions for the ESM build_, by defining the following vite.config.ts:

```ts
import { defineConfig } from 'vite'
import specifier from 'vite-plugin-specifier'

export default defineConfig(({
  build: {
    lib: {
      formats: ['es', 'cjs'],
      entry: ['src/index.ts', 'src/file.ts'],
    },
  },
  plugins: [
    specifier({
      extMap: {
        '.js': '.mjs',
      },
    }),
  ],
}))
```

After running the vite build, all **relative** specifiers ending in `.js` would be updated to end in `.mjs`, and your `dist` would contain the following:

```
.
├── dist/
│   ├── index.cjs
│   ├── index.mjs
│   ├── file.cjs
│   └── file.mjs
├── src/
│   ├── index.ts
│   └── file.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

You can do the same for a CJS-first project and change the extensions to `.cjs`.

If you need more fine-grained control than `extMap` offers, you can use the `handler` and `writer` [options](#options) to update specifier and file extensions any way you see fit.

### Advanced

As an example of how to use `handler` and `writer`, they can be used to create the same build as above done with `extMap`.

The updated vite.config.ts:

```diff
import { writeFile, rm } from 'node:fs/promises'

import { defineConfig } from 'vite'
import specifier from 'vite-plugin-specifier'

export default defineConfig(({
  build: {
    lib: {
      formats: ['cjs', 'es'],
      entry: ['src/index.ts', 'src/file.ts'],
    },
  },
  plugins: [
    specifier({
      extMap: {
        '.js': '.mjs',
      },
      handler({ value }) {
        if (value.startsWith('./') || value.startsWith('../')) {
          return value.replace(/([^.]+)\.js$/, '$1.mjs')
        }
      },
      async writer(records) {
        const files = Object.keys(records)

        for (const filename of files) {
          if (typeof records[filename] === 'string' && filename.endsWith('.js')) {
            await writeFile(filename.replace(/\.js$/, '.mjs'), records[filename])
            await rm(filename, { force: true })
          }
        }
      },
    }),
  ],
}))
```

As you can see, it's much simpler to just use `extMap` which does this for you. However, if you want to modify file extensions and/or specifiers in general (not just relative ones) after a vite build, then `handler` and `writer` are what you want.

## Options

You probably won't need to use any of these except `extMap`, nevertheless, here they are. To make anything happen you need to define either `extMap`, `handler`, or `writer`.

### `hook`

**type**
```ts
type Hook = 'writeBundle' | 'transform'
```

Determines what [vite build hook](https://vitejs.dev/guide/api-plugin.html#universal-hooks) this plugin runs under. By default, this plugin runs after the vite build is finished writing files, during the [`writeBundle`](https://rollupjs.org/plugin-development/#writebundle) hook.

I'm not sure why you would ever need to run this plugin under [`transform`](https://rollupjs.org/plugin-development/#transform), but if you do you will most likely need to include some sort of `resolve.alias` configuration to remap the changed specifier extensions. For example, running the example above under `transform` would require this added to the vite.config.ts:

```ts
resolve: {
  alias: [
    {
      find: /(.+)\.mjs$/,
      replacement: '$1.js'
    }
  ]
},
```

### `extMap`

**type**
```ts
type ExtMap = Map<{
  '.js': Ext
  '.mjs': Ext
  '.cjs': Ext
  '.jsx': Ext
  '.ts': Ext
  '.mts': Ext
  '.cts': Ext
  '.tsx': Ext
}>
type Ext = '.js' | '.mjs' | '.cjs' | '.jsx' | '.ts' | '.mts' | '.cts' | '.tsx'
type Map<Exts> = {
  [Property in keyof Exts]?: Ext
}
```

An object of common file extensions mapping one extension to another. Using this option allows you to easily change one extension into another for relative specifiers and their associated files.


### `handler`

**type**
```ts
type Handler = Callback | RegexMap
type Callback = (spec: Spec) => string
interface RegexMap {
  [regex: string]: string
}
interface Spec {
  type: 'StringLiteral' | 'TemplateLiteral' | 'BinaryExpression' | 'NewExpression'
  start: number
  end: number
  value: string
  loc: SourceLocation
}
```

Allows updating of specifiers on a per-file basis, using a callback or regular expression map to determine the updated specifier values. The `Spec` used in the callback is essentially a portion of an AST node. If using a callback, the returned string determines the new specifier value.

### `writer`

**type**
```ts
type Writer = boolean | ((records: Record<string, string | UpdateError>) => Promise<void>)
interface UpdateError {
  error: boolean
  msg: string
  filename?: string
  syntaxError?: {
    code: string
    reasonCode: string
    pos: number
    loc: Position
  }
}
```

Used to modify the emitted build files, for instance to change their file extensions. Receives a record `{ [filename: string]: string | UpdateError }` mapping the filenames from the emitted build, to their updated source code string, or an object describing an error that occured.
