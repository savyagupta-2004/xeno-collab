import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  { ignores: ['node_modules/', '.next/', 'out/', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals'),
  prettier,
];

export default eslintConfig;
