export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', 'node_modules/**', 'coverage/**'],
  rules: {
    'declaration-block-single-line-max-declarations': 1,
    'selector-class-pattern': '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
    'selector-id-pattern': '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
  },
};
