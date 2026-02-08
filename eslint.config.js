import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const languageOptions = {
  ecmaVersion: 2023,
  sourceType: 'module',
  globals: {
    ...globals.es2021,
    ...globals.node,
  },
}

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'coverage/**', 'test/__fixtures__/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions,
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    languageOptions: {
      ...languageOptions,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'error',
    },
  },
]
