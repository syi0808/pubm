<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>


<h1 align="center">pubm</h1>

<p align="center">
<strong>Ein Befehl. Jede Registry.</strong><br>
Veroffentliche nach npm, jsr, crates.io und private Registries in einem Schritt.<br>
Wenn etwas fehlschlaegt, macht pubm Versionsbump, Tag und Commit automatisch rueckgaengig.
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

## Warum pubm?

Die meisten Release-Tools gehen von genau einer Registry aus. pubm ist fur Projekte gebaut, die wachsen.

- **npm + jsr**: mit einem Befehl in beide JavaScript-Registries veroffentlichen
- **JS + Rust**: `package.json` und `Cargo.toml` in einer Pipeline veroffentlichen
- **Monorepos**: Pakete werden in Abhangigkeitsreihenfolge veroffentlicht, ohne manuelles Sequencing
- **Automatisches Rollback**: wenn eine Registry fehlschlaegt, macht pubm Versionsbump, Tag und Commit rueckgaengig
- **Keine Konfiguration**: Registries werden automatisch aus deinen Manifesten erkannt

Starte nur mit npm. Fuge naechsten Monat jsr hinzu. Wechsle naechstes Jahr ins Monorepo. Dein Release-Befehl bleibt derselbe: `pubm`.

Wenn du nur ein einzelnes npm-Paket nach npm veroffentlichst, reichen `np` oder `release-it` aus. pubm ist fur Situationen gedacht, in denen du dein Release-Setup nicht bei jedem Wachstum des Projekts neu bauen willst.

## So funktioniert es

### Keine Konfiguration

pubm liest deine Manifest-Dateien und erkennt daraus die passenden Registries.

| Manifest | Registry |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `deno.json` / `deno.jsonc` | jsr |
| `Cargo.toml` | crates.io |

Du hast sowohl `package.json` als auch `jsr.json`? pubm veroffentlicht in einem Release an beide. Keine Config notwendig.

### Automatisches Rollback

Registry lehnt dein Paket ab? pubm macht Versionsbump, git tag und Commit rueckgaengig. Kein halb veroffentlichter Zustand, kein manuelles Aufraeumen.

### Preflight-Checks

Branch, Working Tree, Remote-Sync, Login-Status und Publish-Berechtigungen werden **bevor** pubm etwas aendert geprueft. Im CI-Modus validiert pubm Tokens und fuehrt Publish-Dry-Runs durch, um Probleme vor der eigentlichen Veroeffentlichung zu erkennen:

```bash
pubm --phase prepare
```

### Gleicher Befehl, lokal und in CI

Interaktive Prompts im Terminal, voll headless in CI. Keine separate Konfiguration, keine Flags zum Merken.

### Monorepo-nativ

Erkennt pnpm-, yarn-, npm-, bun-, deno- und Cargo-Workspaces automatisch. Veroffentlicht in Abhangigkeitsreihenfolge. Unterstuetzt independent versioning, fixed versioning und linked groups.

### Multi-Ecosystem

JavaScript und Rust in derselben Pipeline. Gemischte JS + Rust-Workspaces funktionieren ohne Zusatzaufwand.

## Schnellstart

```bash
# npm
npm i -g pubm

# Homebrew
brew tap syi0808/pubm
brew install pubm

# Interaktiver Setup-Assistent - erkennt Pakete, konfiguriert Registries, CI und mehr
pubm init

# Einfach pubm ausfuehren
pubm

# Optional: Skills fur Coding Agents installieren (Claude Code, Codex, Gemini)
pubm setup-skills
```

Danach fuehrt dich pubm durch den Rest:

```
  $ pubm
    │
    ├─ Version waehlen         ── patch, minor oder major
    ├─ Preflight-Checks        ── Branch, Working Tree, Remote-Sync
    ├─ Registry-Validierung    ── Auth, Berechtigungen, Verfuegbarkeit
    ├─ Test & Build            ── fuehrt deine npm-Skripte aus
    ├─ Versionsbump            ── aktualisiert Manifeste, erstellt git Commit + Tag
    ├─ Publish                 ── an alle Registries gleichzeitig
    ├─ Nachbereitung           ── pusht Tags, erstellt GitHub Release
    │
    └─ Bei Fehler → alles rollbacken
```

## Dokumentation

- [Schnellstart](https://syi0808.github.io/pubm/de/guides/quick-start/)
- [Konfiguration](https://syi0808.github.io/pubm/de/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/de/guides/changesets/)
- [Monorepo](https://syi0808.github.io/pubm/de/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/de/guides/ci-cd/)
- [CLI-Referenz](https://syi0808.github.io/pubm/de/reference/cli/)
- [Plugin-API](https://syi0808.github.io/pubm/de/reference/plugins/)

## FAQ

### Wie werden Registry-Tokens gespeichert?

pubm speichert Tokens uber `@napi-rs/keyring` im nativen Keychain deines Betriebssystems (macOS Keychain, Windows Credential Manager, Linux Secret Service). Umgebungsvariablen haben immer Vorrang. Mit `--no-save-token` wirst du bei jedem Lauf erneut gefragt.

## Datenschutz

pubm sammelt keine Telemetrie-, Analyse- oder Nutzungsdaten.

- **Token-Speicherung** - Registry-Tokens werden im nativen Keychain deines Betriebssystems gespeichert (macOS Keychain, Windows Credential Manager, Linux Secret Service) mit einem AES-256-CBC-verschlusselten Fallback unter `~/.pubm/`
- **Netzwerk** - pubm kommuniziert ausschliesslich mit den von dir konfigurierten Registries (npm, jsr, crates.io) und GitHub fur die Release-Erstellung
- **Update-Check** - Fragt die oeffentliche npm-Registry nach neueren Versionen ab (nur lokal, in CI deaktiviert)

---

## Mitwirken

Beitraege sind willkommen. Bitte lies vor einem Pull Request den [Contributing Guide](CONTRIBUTING.md).

## Lizenz

Dieses Projekt steht unter der Apache License 2.0. Details findest du in [LICENSE](LICENSE).

## Autor

**Yein Sung** - [GitHub](https://github.com/syi0808)
