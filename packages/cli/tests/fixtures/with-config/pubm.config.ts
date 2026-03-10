export default {
  versioning: "independent" as const,
  packages: [
    {
      path: "packages/my-lib",
      registries: ["npm", "jsr"],
    },
    {
      path: "crates/my-crate",
      registries: ["crates"],
    },
  ],
  branch: "main",
};
