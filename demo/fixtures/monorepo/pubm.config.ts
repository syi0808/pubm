// defineConfig is an identity function, so a plain object works fine
export default {
  versioning: "independent",
  branch: "main",
  packages: [
    {
      path: "packages/core",
      registries: ["npm", "jsr"],
    },
    {
      path: "packages/cli",
      registries: ["npm"],
    },
    {
      path: "packages/rust-lib",
      registries: ["crates"],
    },
  ],
};
