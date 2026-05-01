<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>


<h1 align="center">pubm</h1>

<p align="center">
<strong>一条命令。所有仓库。</strong><br>
一步发布到 npm、jsr、crates.io 和私有仓库。<br>
只要有任何一步失败，pubm 就会自动撤销版本变更、tag 和提交。
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

## 为什么选择 pubm？

大多数发布工具默认只面对一个仓库。pubm 是为会持续增长的项目准备的。

- **npm + jsr**：一条命令同时发布到两个 JavaScript 仓库
- **JS + Rust**：在同一条流水线里同时发布 `package.json` 和 `Cargo.toml`
- **Monorepo**：按依赖顺序发布包，不需要手工排顺序
- **自动回滚**：任一仓库失败，pubm 都会撤销版本变更、tag 和提交
- **零配置**：从清单文件自动识别仓库

你可以现在先只发 npm，下个月再加 jsr，明年再迁到 monorepo。发布命令始终不变，还是 `pubm`。

如果你只是把一个 npm 包发布到 npm，那么 `np` 或 `release-it` 已经足够。pubm 适合的是那种不想在项目增长时反复重做发布流程的人。

## 工作方式

### 零配置

pubm 会读取你的清单文件并判断该发布到哪些仓库。

| 清单文件 | 仓库 |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `deno.json` / `deno.jsonc` | jsr |
| `Cargo.toml` | crates.io |

如果同时存在 `package.json` 和 `jsr.json`，pubm 会在一次 release 中同时发布到两边，不需要额外配置。

### 自动回滚

仓库拒绝包时，pubm 会撤销版本变更、git tag 和提交。不会留下半发布状态，也不用手工清理。

### 预检查

分支、工作区、远端同步、登录状态和发布权限，都会在 pubm **真正动手前** 检查完成。

```bash
pubm --phase prepare
```

### Release workflows

| 路径 | 命令 | 适用场景 |
|------|------|----------|
| Direct Release | `pubm` | 由可信的本地环境或受控任务运行完整发布 |
| Split CI Release | 本地 `pubm --phase prepare`，然后 CI `pubm --phase publish` | 本地完成准备，把包发布和 GitHub Releases 交给 CI |

### 原生支持 monorepo

自动识别 pnpm、yarn、npm、bun、deno 和 Cargo workspaces。按依赖顺序发布，并支持 independent versioning、fixed versioning 和 linked groups。

### 多生态支持

JavaScript 和 Rust 可以放在同一条流水线中。混合 JS + Rust 的 workspace 也能直接工作。

## 快速开始

```bash
# npm
npm i -g pubm

# Homebrew
brew tap syi0808/pubm
brew install pubm

# 交互式初始化向导 - 检测包、配置仓库、CI 等
pubm init

# 直接运行 pubm 就行
pubm
```

可选命令：

```bash
# 可选：安装 coding agent skills（Claude Code、Codex、Gemini）
pubm setup-skills
```

之后 pubm 会带你走完整个流程：

```
  $ pubm
    │
    ├─ 选择版本             ── patch、minor 或 major
    ├─ 预检查               ── 分支、工作区、远端同步
    ├─ 仓库校验             ── 认证、权限、可用性
    ├─ 测试与构建           ── 执行 npm scripts
    ├─ 版本更新             ── 更新清单文件，创建 git commit + tag
    ├─ 发布                 ── 同时发到所有仓库
    ├─ 发布后处理           ── push tag，创建 GitHub Release
    │
    └─ 失败时 → 全部回滚
```

## 文档

- [快速开始](https://syi0808.github.io/pubm/zh-cn/guides/quick-start/)
- [发布工作流](https://syi0808.github.io/pubm/zh-cn/guides/release-workflows/)
- [配置](https://syi0808.github.io/pubm/zh-cn/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/zh-cn/guides/changesets/)
- [Monorepo](https://syi0808.github.io/pubm/zh-cn/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/zh-cn/guides/ci-cd/)
- [CLI 参考](https://syi0808.github.io/pubm/zh-cn/reference/cli/)
- [插件 API](https://syi0808.github.io/pubm/zh-cn/reference/plugins/)

## FAQ

### 仓库 token 是怎么保存的？

pubm 通过 `@napi-rs/keyring` 把 token 存进操作系统原生密钥链中（macOS Keychain、Windows Credential Manager、Linux Secret Service）。环境变量始终优先。如果你希望每次都手动输入，可使用 `--no-save-token`。

## 隐私

pubm 不收集遥测数据、分析数据或使用数据。

- **Token 存储** - 注册表 token 存储在操作系统密钥链中（macOS Keychain、Windows Credential Manager、Linux Secret Service），并以 AES-256-CBC 加密方式回退到 `~/.pubm/`
- **网络** - pubm 仅与你配置的注册表（npm、jsr、crates.io）和 GitHub Release 创建进行通信
- **更新检查** - 查询 npm 公共注册表以获取新版本（仅限本地，CI 中禁用）

---

## 贡献

欢迎贡献。在提交 pull request 之前，请先阅读 [Contributing Guide](CONTRIBUTING.md)。

## 许可证

本项目采用 Apache License 2.0。详情见 [LICENSE](LICENSE)。

## 作者

**Yein Sung** - [GitHub](https://github.com/syi0808)
