import nextTs from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'next-build/**',
    'out/**',
    'build/**',
    'dist/**',
    'release/**',
    'updater-runtime/**',
    'worker-bin/**',
    '.pyinstaller/**',
    '.superpowers/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);

export default eslintConfig;
