const js = require('@eslint/js')
const globals = require('globals')
const prettier = require('eslint-config-prettier')

module.exports = [
  { ignores: ['node_modules/**', '*.vsix'] },
  js.configs.recommended,
  {
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      complexity: ['warn', 12],
      'id-length': ['error', { min: 2, properties: 'never' }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'error',
      'no-param-reassign': 'error',
      'no-nested-ternary': 'warn',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // Scripts clássicos do webview compartilham o escopo global entre arquivos.
    files: ['media/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, acquireVsCodeApi: 'readonly' },
    },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off' },
  },
  prettier,
]
