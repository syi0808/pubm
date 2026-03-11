import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  branch: 'native-third-party',
  registries: ['npm'],
  contents: JSON.stringify(defaultExclude),
});
