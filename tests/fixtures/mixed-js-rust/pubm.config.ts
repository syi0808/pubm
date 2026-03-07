import { defineConfig } from '../../../src/config/types.js'

export default defineConfig({
  versioning: 'independent',
  packages: [
    { path: '.', registries: ['npm', 'jsr'] },
    { path: 'rust/crates/my-crate', registries: ['crates'] },
    { path: 'rust/crates/my-crate-cli', registries: ['crates'] },
  ],
})
