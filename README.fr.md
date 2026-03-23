<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pubm">
    <img src="https://img.shields.io/npm/v/pubm" alt="npm version" />
  </a>
  <a href="https://jsr.io/@pubm/pubm">
    <img src="https://jsr.io/badges/@pubm/pubm/score" alt="jsr version" />
  </a>
</p>

<h1 align="center">pubm</h1>

<p align="center">
<strong>Une commande. Tous les registres.</strong><br>
Publiez vers npm, jsr, crates.io et des registres prives en une seule etape.<br>
Si quelque chose echoue, pubm annule automatiquement le bump de version, le tag et le commit.
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

## Pourquoi pubm ?

La plupart des outils de release partent du principe qu'il n'y a qu'un seul registre. pubm est concu pour les projets qui grandissent.

- **npm + jsr** : publiez vers les deux registres JavaScript avec une seule commande
- **JS + Rust** : publiez `package.json` et `Cargo.toml` dans un meme pipeline
- **Monorepos** : publication dans l'ordre des dependances, sans sequencement manuel
- **Rollback automatique** : si un registre echoue, pubm annule le bump de version, le tag et le commit
- **Zero config** : les registres sont detectes automatiquement depuis vos manifests

Commencez avec npm uniquement. Ajoutez jsr le mois prochain. Passez au monorepo l'annee prochaine. Votre commande de release reste la meme : `pubm`.

Si vous ne publiez qu'un seul package npm sur npm, `np` ou `release-it` vous suffiront. pubm sert surtout quand vous ne voulez pas refaire votre setup de release a chaque fois que votre projet grossit.

## Fonctionnement

### Zero config

pubm lit vos manifests et determine les registres cibles.

| Manifest | Registre |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `Cargo.toml` | crates.io |

Vous avez `package.json` et `jsr.json` ? pubm publie vers les deux dans une seule release. Aucun fichier de config n'est necessaire.

### Rollback automatique

Un registre refuse votre package ? pubm annule le bump de version, le git tag et le commit. Pas d'etat a moitie publie, pas de nettoyage manuel.

### Verifications prealables

Branche, working tree, synchro distante, etat de connexion et permissions de publication sont verifies **avant** toute action. Vous pouvez aussi dry-run tout votre pipeline CI en local :

```bash
pubm --mode ci --phase prepare
```

### La meme commande en local et en CI

Prompts interactifs dans le terminal, execution totalement headless en CI. Pas de config separee, pas de flags a memoriser.

### Monorepo natif

Detection automatique des workspaces pnpm, yarn, npm, bun, deno et Cargo. Publication dans l'ordre des dependances. Support de l'independent versioning, du fixed versioning et des linked groups.

### Multi-ecosysteme

JavaScript et Rust dans le meme pipeline. Les workspaces mixtes JS + Rust fonctionnent sans adaptation.

## Demarrage rapide

```bash
npm i -g pubm

# Assistant de configuration interactif - detecte les packages, configure les registres, la CI, etc.
pubm init

# Lancez simplement pubm
pubm

# Optionnel : installer les skills pour coding agents (Claude Code, Codex, Gemini)
pubm setup-skills
```

Ensuite, pubm vous guide dans la suite :

```
  $ pubm
    │
    ├─ Choisir une version     ── patch, minor ou major
    ├─ Verifications           ── branche, working tree, synchro distante
    ├─ Validation registres    ── auth, permissions, disponibilite
    ├─ Test & Build            ── execute vos scripts npm
    ├─ Bump de version         ── met a jour les manifests, cree commit + tag git
    ├─ Publication             ── tous les registres a la fois
    ├─ Post-publication        ── push des tags, creation d'une GitHub Release
    │
    └─ En cas d'echec → rollback complet
```

## Documentation

- [Demarrage rapide](https://syi0808.github.io/pubm/fr/guides/quick-start/)
- [Configuration](https://syi0808.github.io/pubm/fr/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/fr/guides/changesets/)
- [Monorepo](https://syi0808.github.io/pubm/fr/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/fr/guides/ci-cd/)
- [Reference CLI](https://syi0808.github.io/pubm/fr/reference/cli/)
- [API des plugins](https://syi0808.github.io/pubm/fr/reference/plugins/)

## FAQ

### Comment les tokens de registre sont-ils stockes ?

pubm stocke les tokens dans le trousseau natif de votre OS (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`. Les variables d'environnement restent prioritaires. Utilisez `--no-save-token` pour etre invite a chaque execution.

---

## Contribution

Les contributions sont bienvenues. Merci de lire le [Contributing Guide](CONTRIBUTING.md) avant de soumettre une pull request.

## Licence

Ce projet est distribue sous licence Apache 2.0. Voir [LICENSE](LICENSE) pour les details.

## Auteur

**Yein Sung** — [GitHub](https://github.com/syi0808)
