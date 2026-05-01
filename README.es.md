<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>


<h1 align="center">pubm</h1>

<p align="center">
<strong>Un comando. Todos los registros.</strong><br>
Publica en npm, jsr, crates.io y registros privados en un solo paso.<br>
Si algo falla, pubm revierte automaticamente el cambio de version, el tag y el commit.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.zh-cn.md">简体中文</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.es.md">Español</a>
</p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## Por que pubm?

La mayoria de herramientas de release asumen un solo registro. pubm esta hecho para proyectos que crecen.

- **npm + jsr**: publica en ambos registros de JavaScript con un solo comando
- **JS + Rust**: publica `package.json` y `Cargo.toml` en un mismo pipeline
- **Monorepos**: publica paquetes segun dependencias, sin secuenciacion manual
- **Rollback automatico**: si un registro falla, pubm deshace el cambio de version, el tag y el commit
- **Cero configuracion**: detecta registros automaticamente desde los manifests

Puedes empezar solo con npm, agregar jsr el proximo mes y pasar a monorepo el ano que viene. Tu comando de release sigue siendo el mismo: `pubm`.

Si solo publicas un paquete en npm, `np` o `release-it` te serviran bien. pubm es para cuando no quieres rehacer tu setup de release cada vez que el proyecto crece.

## Como funciona

### Cero configuracion

pubm lee tus manifests y deduce los registros.

| Manifest | Registro |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `deno.json` / `deno.jsonc` | jsr |
| `Cargo.toml` | crates.io |

Tienes `package.json` y `jsr.json`? pubm publica en ambos dentro de una sola release. Sin configuracion adicional.

### Rollback automatico

Si un registro rechaza tu paquete, pubm deshace el cambio de version, el git tag y el commit. Sin estado a medias ni limpieza manual.

### Preflight checks

Rama, working tree, sincronizacion remota, estado de login y permisos de publicacion se verifican **antes** de que pubm toque nada. En modo CI, pubm valida tokens y ejecuta publish dry-runs para detectar problemas antes de la publicacion real:

```bash
pubm --mode ci --phase prepare
```

### El mismo comando en local y CI

Prompts interactivos en la terminal y ejecucion totalmente headless en CI. Sin configuracion separada ni flags para memorizar.

### Monorepo nativo

Detecta automaticamente workspaces de pnpm, yarn, npm, bun, deno y Cargo. Publica segun dependencias. Soporta independent versioning, fixed versioning y linked groups.

### Multi-ecosistema

JavaScript y Rust en el mismo pipeline. Los workspaces mixtos JS + Rust funcionan desde el inicio.

## Inicio rapido

```bash
# npm
npm i -g pubm

# Homebrew
brew tap syi0808/pubm
brew install pubm

# Asistente interactivo de configuracion - detecta paquetes, configura registros, CI y mas
pubm init

# Solo ejecuta pubm
pubm

# Opcional: instala skills para coding agents (Claude Code, Codex, Gemini)
pubm setup-skills
```

Luego pubm te guia por el resto:

```
  $ pubm
    │
    ├─ Elegir version          ── patch, minor o major
    ├─ Preflight checks        ── rama, working tree, sincronizacion remota
    ├─ Validacion de registro  ── auth, permisos, disponibilidad
    ├─ Test y build            ── ejecuta tus scripts npm
    ├─ Cambio de version       ── actualiza manifests, crea git commit + tag
    ├─ Publicacion             ── todos los registros a la vez
    ├─ Post-publicacion        ── push de tags, crea GitHub Release
    │
    └─ Si falla → rollback total
```

## Documentacion

- [Inicio rapido](https://syi0808.github.io/pubm/es/guides/quick-start/)
- [Configuracion](https://syi0808.github.io/pubm/es/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/es/guides/changesets/)
- [Monorepo](https://syi0808.github.io/pubm/es/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/es/guides/ci-cd/)
- [Referencia CLI](https://syi0808.github.io/pubm/es/reference/cli/)
- [API de plugins](https://syi0808.github.io/pubm/es/reference/plugins/)

## FAQ

### Como se guardan los tokens de registro?

pubm guarda los tokens en el llavero nativo del sistema operativo (macOS Keychain, Windows Credential Manager, Linux Secret Service) mediante `@napi-rs/keyring`. Las variables de entorno siempre tienen prioridad. Usa `--no-save-token` si prefieres introducir el token cada vez.

## Privacidad

pubm no recopila telemetria, datos de analisis ni datos de uso.

- **Almacenamiento de tokens** - Los tokens de registro se almacenan en el llavero nativo del sistema operativo (macOS Keychain, Windows Credential Manager, Linux Secret Service) con un respaldo cifrado AES-256-CBC en `~/.pubm/`
- **Red** - pubm solo se comunica con los registros que configures (npm, jsr, crates.io) y GitHub para la creacion de releases
- **Verificacion de actualizaciones** - Consulta el registro publico de npm para nuevas versiones (solo en local, desactivado en CI)

---

## Contribuir

Las contribuciones son bienvenidas. Lee la [Contributing Guide](CONTRIBUTING.md) antes de enviar un pull request.

## Licencia

Este proyecto esta bajo Apache License 2.0. Consulta [LICENSE](LICENSE) para mas detalles.

## Autor

**Yein Sung** - [GitHub](https://github.com/syi0808)
