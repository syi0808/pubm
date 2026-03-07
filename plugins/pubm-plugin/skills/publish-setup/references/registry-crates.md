# crates.io Registry Constraints

## Cargo.toml Template (from package.json)

```toml
[package]
name = "<name, with @scope/ stripped>"
version = "<version>"
edition = "2021"
description = "<from description>"
license = "<from license>"
repository = "<from repository.url>"
authors = ["<from author>"]
```

## Name Mapping

Strip `@scope/` prefix from `package.json` name:
- `@myorg/my-crate` → `my-crate`
- `my-crate` → `my-crate` (no change)

## Crate Type

If neither `src/lib.rs` nor `src/main.rs` exists, ask the user whether this is a library or binary crate, then create the corresponding file:
- Library: `src/lib.rs`
- Binary: `src/main.rs`

## Authentication

- **Local**: Run `cargo login` to authenticate. Token stored in `~/.cargo/credentials.toml`.
- **CI**: Set `CARGO_REGISTRY_TOKEN` environment variable. Create token at crates.io > Account Settings > API Tokens.
