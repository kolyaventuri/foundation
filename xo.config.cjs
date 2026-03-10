module.exports = {
  space: 2,
  prettier: true,
  ignores: ['apps/web/dist/**', 'coverage/**', 'node_modules/**'],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
    'import/extensions': 'off',
    'import/no-extraneous-dependencies': 'off',
    'n/file-extension-in-import': 'off',
    'unicorn/prefer-top-level-await': 'off',
    'unicorn/prefer-module': 'off',
  },
};
