// defineConfig is an identity function, so a plain object works fine
export default {
  packages: [
    {
      path: ".",
      registries: ["npm", "jsr", "crates"],
    },
  ],
  branch: "main",
};
