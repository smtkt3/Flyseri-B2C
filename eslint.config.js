import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.figma/**', '**/coverage/**'] },
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-debugger': 'error',
      'no-constant-condition': 'error',
    },
  },
);
