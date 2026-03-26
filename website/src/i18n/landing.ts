import type { SiteLocale } from "./site";

export interface LandingDictionary {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    docs: string;
    github: string;
    cta: string;
  };
  hero: {
    badge: string;
    titleLine1: string;
    titleLine2: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
  };
  registry: {
    badge: string;
    title: string;
    titleAccent: string;
    description: string;
    statuses: {
      connected: string;
      ready: string;
      private: string;
      enterprise: string;
    };
  };
  features: {
    title: string;
    description: string;
    items: Array<{ title: string; description: string }>;
  };
  workflow: {
    badge: string;
    title: string;
    titleAccent: string;
    description: string;
    steps: Array<{ title: string; description: string }>;
  };
  install: {
    title: string;
    description: string;
    readDocs: string;
    viewGithub: string;
    copyLabel: string;
    terminalTitle: string;
  };
  footer: {
    tagline: string;
    docs: string;
  };
  why?: {
    badge: string;
    title: string;
    description: string;
    items: Array<{ heading: string; body: string }>;
  };
}

export const landingCopy: Record<SiteLocale, LandingDictionary> = {
  en: {
    meta: {
      title: "pubm: Publish to every registry with one command",
      description:
        "Publish to npm, jsr, crates.io, and private registries in one step. Automatic rollback if anything fails.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Get Started" },
    hero: {
      badge: "v0.4.11 available",
      titleLine1: "One command.",
      titleLine2: "Every registry.",
      description:
        "npm, jsr, crates.io, private registries. One step. If anything fails, pubm undoes the version bump, tag, and commit. Your repo stays clean.",
      primaryCta: "Get Started",
      secondaryCta: "Star on GitHub",
    },
    registry: {
      badge: "Zero Config",
      title: "Drop in your manifest,",
      titleAccent: "pubm does the rest.",
      description:
        "package.json → npm. jsr.json → jsr. Cargo.toml → crates.io. pubm reads your project and figures out the registries. No config file needed.",
      statuses: {
        connected: "Connected",
        ready: "Ready",
        private: "Private",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Releases that don't break things",
      description:
        "Every step is validated before it runs. If something goes wrong, everything rolls back. No half-published packages.",
      items: [
        {
          title: "All your registries, one command",
          description:
            "npm, jsr, crates.io, private registries. Monorepos publish in dependency order. No scripts to chain.",
        },
        {
          title: "Automatic rollback",
          description:
            "Registry rejected your package? pubm undoes the version bump, git tag, and commit. No half-published state, no manual cleanup.",
        },
        {
          title: "Preflight checks",
          description:
            "Branch, working tree, remote sync, login status, publish permissions. All verified before pubm touches anything.",
        },
        {
          title: "Same command, local and CI",
          description:
            "Interactive prompts in your terminal, fully headless in CI. No separate config, no flags to remember.",
        },
      ],
    },
    workflow: {
      badge: "How It Works",
      title: "Run `pubm`.",
      titleAccent: "That's it.",
      description:
        "Version prompts, preflight checks, tests, builds, multi-registry publish. One command handles the entire pipeline.",
      steps: [
        {
          title: "Pick a version",
          description:
            "Run `pubm`. Choose patch, minor, or major. That's the only decision you make.",
        },
        {
          title: "Preflight checks",
          description:
            "pubm verifies your branch, working tree, remote sync, and registry credentials before changing anything.",
        },
        {
          title: "Test, build, tag",
          description:
            "Your test suite runs, the build executes, then pubm bumps the version and creates a git commit + tag.",
        },
        {
          title: "Publish everywhere",
          description:
            "All registries receive your package at once. If any registry fails, every change rolls back automatically.",
        },
      ],
    },
    install: {
      title: "Install once. Then just `pubm`.",
      description:
        "New project or existing one. pubm auto-detects your registries from day one. No migration needed later.",
      readDocs: "Read the Docs",
      viewGithub: "View on GitHub",
      copyLabel: "Copy commands",
      terminalTitle: "bash - install",
    },
    footer: { tagline: "One command, every registry", docs: "Docs" },
    why: {
      badge: "Why pubm?",
      title: "Start right. Never migrate.",
      description:
        "Most release tools lock you into a setup. pubm grows with your project. Add registries, packages, or ecosystems without changing your workflow.",
      items: [
        {
          heading: "No migration tax",
          body: "Start with npm only. Add jsr or crates.io when you're ready. Your workflow doesn't change.",
        },
        {
          heading: "JS + Rust, one pipeline",
          body: "Publishing a Rust crate alongside an npm package? pubm reads both package.json and Cargo.toml and ships everything together.",
        },
        {
          heading: "Monorepo-ready from day one",
          body: "One package today, ten tomorrow. pubm publishes in dependency order. No broken releases from wrong sequencing.",
        },
      ],
    },
  },
  ko: {
    meta: {
      title: "pubm - 하나의 명령으로 모든 레지스트리에 배포",
      description:
        "npm, jsr, crates.io, 사설 레지스트리까지 하나의 명령으로 배포하고, 실패 시 자동으로 롤백합니다.",
    },
    nav: { docs: "문서", github: "GitHub", cta: "시작하기" },
    hero: {
      badge: "v0.4.11 사용 가능",
      titleLine1: "명령은 하나.",
      titleLine2: "배포 대상은 전부.",
      description:
        "npm, jsr, crates.io, 사설 레지스트리까지 한 번에 배포합니다. 중간에 실패하면 pubm이 전체 변경을 자동으로 되돌립니다.",
      primaryCta: "시작하기",
      secondaryCta: "GitHub에서 스타 주기",
    },
    registry: {
      badge: "설정 불필요",
      title: "매니페스트만 두면,",
      titleAccent: "나머지는 pubm이 처리합니다.",
      description:
        "package.json은 npm, jsr.json은 jsr, Cargo.toml은 crates.io로 연결됩니다. pubm이 프로젝트를 읽고 레지스트리를 판단하므로 설정 파일이 필요 없습니다.",
      statuses: {
        connected: "연결됨",
        ready: "준비됨",
        private: "비공개",
        enterprise: "엔터프라이즈",
      },
    },
    features: {
      title: "깨지지 않는 릴리스",
      description:
        "모든 단계는 실행 전에 검증됩니다. 문제가 생기면 전체가 롤백됩니다. 반쯤만 배포된 패키지는 남지 않습니다.",
      items: [
        {
          title: "모든 레지스트리, 하나의 명령",
          description:
            "npm, jsr, crates.io, 사설 레지스트리를 한 번에 처리합니다. 모노레포는 의존 순서대로 배포됩니다. 이어 붙일 스크립트가 필요 없습니다.",
        },
        {
          title: "자동 롤백",
          description:
            "레지스트리에서 패키지를 거부하더라도 pubm이 버전 변경, git 태그, 커밋을 되돌립니다. 반쯤 배포된 상태도, 수동 정리도 없습니다.",
        },
        {
          title: "사전 점검",
          description:
            "브랜치, 워킹 트리, 원격 동기화, 로그인 상태, 배포 권한까지 pubm이 실제 변경 전에 모두 확인합니다.",
        },
        {
          title: "같은 명령, 로컬과 CI 모두",
          description:
            "터미널에서는 대화형 프롬프트로, CI에서는 완전 무인으로 동작합니다. 별도 설정도, 외울 플래그도 없습니다.",
        },
      ],
    },
    workflow: {
      badge: "릴리스 파이프라인",
      title: "하나의 명령이",
      titleAccent: "전부 처리합니다.",
      description:
        "`pubm`을 실행하면 버전 선택, 사전 점검, 테스트, 빌드, 멀티 레지스트리 배포까지 이어서 처리합니다.",
      steps: [
        {
          title: "버전 선택",
          description:
            "인자 없이 `pubm`을 실행하고 patch, minor, major 중 다음 버전을 선택합니다.",
        },
        {
          title: "사전 점검과 인증",
          description:
            "브랜치, 워킹 트리, 원격 동기화, 레지스트리 자격 증명을 먼저 확인합니다.",
        },
        {
          title: "테스트, 빌드, 태그",
          description:
            "테스트와 빌드를 실행하고 버전을 올린 뒤 git 커밋과 태그를 원자적으로 생성합니다.",
        },
        {
          title: "모든 곳에 배포",
          description:
            "모든 레지스트리에 동시에 배포하며, 실패 시 전체 변경을 자동으로 롤백합니다.",
        },
      ],
    },
    install: {
      title: "한 번 설치하고, 이후엔 `pubm`만 실행하세요.",
      description:
        "새 프로젝트든 기존 프로젝트든 바로 시작할 수 있습니다. pubm은 첫날부터 레지스트리를 자동 감지하므로 나중에 마이그레이션할 필요가 없습니다.",
      readDocs: "문서 읽기",
      viewGithub: "GitHub 보기",
      copyLabel: "명령 복사",
      terminalTitle: "bash - 설치",
    },
    footer: { tagline: "하나의 명령, 모든 레지스트리", docs: "문서" },
    why: {
      badge: "왜 pubm인가?",
      title: "처음부터 제대로. 마이그레이션은 없습니다.",
      description:
        "대부분의 릴리스 도구는 특정 셋업에 묶이게 만듭니다. pubm은 프로젝트가 커져도 워크플로우를 바꾸지 않고 레지스트리, 패키지, 생태계를 확장할 수 있습니다.",
      items: [
        {
          heading: "마이그레이션 비용 없음",
          body: "지금은 npm만으로 시작하고 준비되면 jsr이나 crates.io를 추가하세요. 워크플로우는 바뀌지 않습니다.",
        },
        {
          heading: "JS + Rust, 하나의 파이프라인",
          body: "npm 패키지와 Rust crate를 함께 배포하나요? pubm은 package.json과 Cargo.toml을 모두 읽고 전부 함께 릴리스합니다.",
        },
        {
          heading: "첫날부터 모노레포 대응",
          body: "오늘은 패키지 하나, 내일은 열 개여도 괜찮습니다. pubm은 의존 순서대로 배포해 순서 문제로 릴리스가 깨지지 않습니다.",
        },
      ],
    },
  },
  "zh-cn": {
    meta: {
      title: "pubm - 一条命令发布到所有仓库",
      description:
        "用一条命令发布到 npm、jsr、crates.io 和私有仓库，失败时自动回滚。",
    },
    nav: { docs: "文档", github: "GitHub", cta: "开始使用" },
    hero: {
      badge: "v0.4.11 已可用",
      titleLine1: "一条命令。",
      titleLine2: "所有仓库。",
      description:
        "一步发布到 npm、jsr、crates.io 和私有仓库。任何一步失败时，pubm 会自动回滚全部变更。",
      primaryCta: "开始使用",
      secondaryCta: "在 GitHub 上加星",
    },
    registry: {
      badge: "零配置",
      title: "放入你的清单文件，",
      titleAccent: "剩下的交给 pubm。",
      description:
        "package.json 对应 npm，jsr.json 对应 jsr，Cargo.toml 对应 crates.io。pubm 会读取项目并判断该发布到哪些仓库，不需要额外配置文件。",
      statuses: {
        connected: "已连接",
        ready: "就绪",
        private: "私有",
        enterprise: "企业",
      },
    },
    features: {
      title: "不会把发布搞坏",
      description:
        "每一步都会先验证再执行。出了问题就整体回滚，不会留下只发布一半的包。",
      items: [
        {
          title: "所有仓库，一条命令",
          description:
            "npm、jsr、crates.io、私有仓库都用同一条命令。monorepo 会按依赖顺序发布，不需要再串脚本。",
        },
        {
          title: "自动回滚",
          description:
            "仓库拒绝包时，pubm 会撤销版本变更、git tag 和提交。不会留下半发布状态，也不用手工清理。",
        },
        {
          title: "预检查",
          description:
            "分支、工作区、远端同步、登录状态和发布权限，都会在 pubm 动手前先检查完成。",
        },
        {
          title: "同一条命令，兼顾本地与 CI",
          description:
            "终端里是交互式提示，CI 里是完全无头执行。不需要单独配置，也不用记额外参数。",
        },
      ],
    },
    workflow: {
      badge: "发布流水线",
      title: "一条命令完成",
      titleAccent: "全部流程。",
      description:
        "运行 `pubm` 后，它会完成版本选择、预检查、测试、构建和多仓库发布。",
      steps: [
        {
          title: "选择版本",
          description: "直接运行 `pubm`，选择 patch、minor 或 major 版本。",
        },
        {
          title: "预检查与认证",
          description: "在真正修改前，先验证分支、工作区、远端同步和仓库凭证。",
        },
        {
          title: "测试、构建、打标签",
          description:
            "运行测试和构建，更新版本，并原子化创建 git 提交与 tag。",
        },
        {
          title: "发布到所有仓库",
          description: "并发发布到所有仓库。任何一步失败时，全部自动回滚。",
        },
      ],
    },
    install: {
      title: "安装一次，然后只需运行 `pubm`。",
      description:
        "无论是新项目还是已有项目，都可以直接开始。pubm 从第一天起就会自动识别仓库，后面不需要再迁移。",
      readDocs: "阅读文档",
      viewGithub: "查看 GitHub",
      copyLabel: "复制命令",
      terminalTitle: "bash - 安装",
    },
    footer: { tagline: "一条命令，所有仓库", docs: "文档" },
    why: {
      badge: "为什么选择 pubm？",
      title: "一开始就走对路。以后不用迁移。",
      description:
        "大多数发布工具会把你锁进某种固定做法。pubm 会随着项目一起增长，新增仓库、包或生态时都不用改工作流。",
      items: [
        {
          heading: "没有迁移成本",
          body: "现在先只发 npm，准备好了再加 jsr 或 crates.io。你的工作流不用变。",
        },
        {
          heading: "JS + Rust，一条流水线",
          body: "要同时发布 Rust crate 和 npm 包？pubm 会读取 package.json 和 Cargo.toml，把它们一起发出去。",
        },
        {
          heading: "从第一天就适配 monorepo",
          body: "今天一个包，明天十个也没问题。pubm 会按依赖顺序发布，不会因为顺序错误把发布搞坏。",
        },
      ],
    },
  },
  fr: {
    meta: {
      title: "pubm - Une commande pour tous les registres",
      description:
        "Publiez vers npm, jsr, crates.io et des registres privés avec rollback automatique en cas d'échec.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Commencer" },
    hero: {
      badge: "v0.4.11 disponible",
      titleLine1: "Une commande.",
      titleLine2: "Tous les registres.",
      description:
        "Publiez vers npm, jsr, crates.io et vos registres privés en une seule étape. En cas d'échec, pubm annule tout automatiquement.",
      primaryCta: "Commencer",
      secondaryCta: "Ajouter une étoile",
    },
    registry: {
      badge: "Zéro config",
      title: "Ajoutez vos manifests,",
      titleAccent: "pubm gère le reste.",
      description:
        "package.json pour npm, jsr.json pour jsr, Cargo.toml pour crates.io. pubm lit votre projet et détecte les registres sans fichier de config.",
      statuses: {
        connected: "Connecté",
        ready: "Prêt",
        private: "Privé",
        enterprise: "Entreprise",
      },
    },
    features: {
      title: "Des releases qui ne cassent rien",
      description:
        "Chaque étape est vérifiée avant exécution. Si quelque chose rate, tout est annulé. Aucun package à moitié publié.",
      items: [
        {
          title: "Tous vos registres, une commande",
          description:
            "npm, jsr, crates.io, registres privés. Les monorepos publient dans l'ordre des dépendances. Aucun script à enchaîner.",
        },
        {
          title: "Rollback automatique",
          description:
            "Un registre refuse votre package ? pubm annule le bump de version, le tag git et le commit. Pas d'état à moitié publié, pas de nettoyage manuel.",
        },
        {
          title: "Vérifications préalables",
          description:
            "Branche, working tree, synchro distante, état de connexion et permissions de publication sont vérifiés avant toute action.",
        },
        {
          title: "La même commande en local et en CI",
          description:
            "Prompts interactifs dans le terminal, exécution totalement headless en CI. Pas de config séparée, pas de flags à mémoriser.",
        },
      ],
    },
    workflow: {
      badge: "Pipeline de release",
      title: "Une commande fait",
      titleAccent: "tout.",
      description:
        "Lancez `pubm` et il gère le reste : version, preflight, tests, build et publication multi-registres.",
      steps: [
        {
          title: "Choisir la version",
          description:
            "Exécutez `pubm` sans argument et choisissez la prochaine version patch, minor ou major.",
        },
        {
          title: "Preflight et auth",
          description:
            "pubm vérifie la branche, le working tree, la synchro distante et les credentials avant toute modification.",
        },
        {
          title: "Tester, builder, tagger",
          description:
            "Les tests et le build s'exécutent puis le commit git et le tag sont créés de façon atomique.",
        },
        {
          title: "Publier partout",
          description:
            "Tous les registres reçoivent le package en parallèle. En cas d'échec, tout est restauré.",
        },
      ],
    },
    install: {
      title: "Installez une fois. Ensuite, lancez simplement `pubm`.",
      description:
        "Nouveau projet ou projet existant, démarrez tout de suite. pubm détecte vos registres dès le premier jour, sans migration plus tard.",
      readDocs: "Lire la doc",
      viewGithub: "Voir sur GitHub",
      copyLabel: "Copier les commandes",
      terminalTitle: "bash - installation",
    },
    footer: { tagline: "Une commande, tous les registres", docs: "Docs" },
    why: {
      badge: "Pourquoi pubm ?",
      title: "Bien démarrer. Ne jamais migrer.",
      description:
        "La plupart des outils de release vous enferment dans un setup. pubm grandit avec votre projet : ajoutez registres, packages ou écosystèmes sans changer de workflow.",
      items: [
        {
          heading: "Aucun coût de migration",
          body: "Commencez avec npm seulement. Ajoutez jsr ou crates.io quand vous êtes prêt. Votre workflow ne change pas.",
        },
        {
          heading: "JS + Rust, un seul pipeline",
          body: "Vous publiez une crate Rust en même temps qu'un package npm ? pubm lit package.json et Cargo.toml et livre tout ensemble.",
        },
        {
          heading: "Prêt pour le monorepo dès le premier jour",
          body: "Un package aujourd'hui, dix demain. pubm publie dans l'ordre des dépendances, sans release cassé à cause d'un mauvais séquencement.",
        },
      ],
    },
  },
  de: {
    meta: {
      title: "pubm - Ein Befehl für alle Registries",
      description:
        "Mit einem Befehl nach npm, jsr, crates.io und private Registries veröffentlichen, mit automatischem Rollback bei Fehlern.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Loslegen" },
    hero: {
      badge: "v0.4.11 verfügbar",
      titleLine1: "Ein Befehl.",
      titleLine2: "Jede Registry.",
      description:
        "Veröffentliche in einem Schritt nach npm, jsr, crates.io und private Registries. Wenn etwas fehlschlägt, rollt pubm alles automatisch zurück.",
      primaryCta: "Loslegen",
      secondaryCta: "Auf GitHub markieren",
    },
    registry: {
      badge: "Keine Konfiguration",
      title: "Manifest ablegen,",
      titleAccent: "pubm erledigt den Rest.",
      description:
        "package.json für npm, jsr.json für jsr, Cargo.toml für crates.io. pubm liest dein Projekt und erkennt die Registries selbst. Keine Config-Datei erforderlich.",
      statuses: {
        connected: "Verbunden",
        ready: "Bereit",
        private: "Privat",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Releases, die nichts kaputt machen",
      description:
        "Jeder Schritt wird vor der Ausführung validiert. Wenn etwas schiefgeht, wird alles zurückgerollt. Keine halb veröffentlichten Pakete.",
      items: [
        {
          title: "Alle Registries, ein Befehl",
          description:
            "npm, jsr, crates.io, private Registries. Monorepos veröffentlichen in Abhängigkeitsreihenfolge. Keine Scripts zum Verketten.",
        },
        {
          title: "Automatisches Rollback",
          description:
            "Registry lehnt dein Paket ab? pubm macht Versionsbump, Git-Tag und Commit rückgängig. Kein halb veröffentlichter Zustand, kein manuelles Aufräumen.",
        },
        {
          title: "Preflight-Checks",
          description:
            "Branch, Working Tree, Remote-Sync, Login-Status und Publish-Berechtigungen werden geprüft, bevor pubm etwas anfasst.",
        },
        {
          title: "Gleicher Befehl, lokal und in CI",
          description:
            "Interaktive Prompts im Terminal, voll headless in CI. Keine separate Konfiguration, keine Flags zum Merken.",
        },
      ],
    },
    workflow: {
      badge: "Release-Pipeline",
      title: "Ein Befehl erledigt",
      titleAccent: "alles.",
      description:
        "`pubm` übernimmt Versionswahl, Preflight-Checks, Tests, Build und Veröffentlichung über alle Registries.",
      steps: [
        {
          title: "Version wählen",
          description:
            "Starte `pubm` ohne Argumente und wähle Patch, Minor oder Major aus.",
        },
        {
          title: "Preflight und Auth",
          description:
            "Vor Änderungen prüft pubm Branch, Working Tree, Remote-Sync und Zugangsdaten.",
        },
        {
          title: "Testen, bauen, taggen",
          description:
            "Tests und Build laufen, dann werden Version, Git-Commit und Tag atomar erzeugt.",
        },
        {
          title: "Überall veröffentlichen",
          description:
            "Alle Registries erhalten das Paket parallel. Bei Fehlern wird alles zurückgesetzt.",
        },
      ],
    },
    install: {
      title: "Einmal installieren. Danach einfach `pubm` ausführen.",
      description:
        "Neues oder bestehendes Projekt: pubm erkennt deine Registries von Anfang an automatisch. Spätere Migrationen sind nicht nötig.",
      readDocs: "Docs lesen",
      viewGithub: "Auf GitHub ansehen",
      copyLabel: "Befehle kopieren",
      terminalTitle: "bash - installation",
    },
    footer: { tagline: "Ein Befehl, jede Registry", docs: "Docs" },
    why: {
      badge: "Warum pubm?",
      title: "Richtig anfangen. Nie migrieren.",
      description:
        "Die meisten Release-Tools sperren dich in ein Setup ein. pubm wächst mit deinem Projekt: weitere Registries, Pakete oder Ökosysteme kommen dazu, ohne dass sich dein Workflow ändert.",
      items: [
        {
          heading: "Keine Migrationskosten",
          body: "Starte erst nur mit npm. Füge jsr oder crates.io hinzu, wenn du bereit bist. Dein Workflow bleibt gleich.",
        },
        {
          heading: "JS + Rust, eine Pipeline",
          body: "Du veröffentlichst ein Rust-Crate zusammen mit einem npm-Paket? pubm liest package.json und Cargo.toml und liefert alles gemeinsam aus.",
        },
        {
          heading: "Von Tag eins an monorepo-tauglich",
          body: "Heute ein Paket, morgen zehn. pubm veröffentlicht in Abhängigkeitsreihenfolge, damit Releases nicht an falscher Sequenzierung scheitern.",
        },
      ],
    },
  },
  es: {
    meta: {
      title: "pubm - Un comando para todos los registros",
      description:
        "Publica en npm, jsr, crates.io y registros privados con un solo comando y rollback automatico si algo falla.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Empezar" },
    hero: {
      badge: "v0.4.11 disponible",
      titleLine1: "Un comando.",
      titleLine2: "Todos los registros.",
      description:
        "Publica en npm, jsr, crates.io y registros privados en un solo paso. Si algo falla, pubm revierte todos los cambios automaticamente.",
      primaryCta: "Empezar",
      secondaryCta: "Dar estrella en GitHub",
    },
    registry: {
      badge: "Cero configuracion",
      title: "Deja tus manifests,",
      titleAccent: "pubm hace el resto.",
      description:
        "package.json va a npm, jsr.json a jsr y Cargo.toml a crates.io. pubm lee tu proyecto y detecta los registros sin archivo de configuracion.",
      statuses: {
        connected: "Conectado",
        ready: "Listo",
        private: "Privado",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Releases que no rompen nada",
      description:
        "Cada paso se valida antes de ejecutarse. Si algo sale mal, todo vuelve atras. No quedan paquetes publicados a medias.",
      items: [
        {
          title: "Todos tus registros, un comando",
          description:
            "npm, jsr, crates.io y registros privados con una sola orden. Los monorepos publican segun dependencias. Sin scripts encadenados.",
        },
        {
          title: "Rollback automatico",
          description:
            "Si un registro rechaza el paquete, pubm deshace el cambio de version, el tag y el commit. Sin estado a medias ni limpieza manual.",
        },
        {
          title: "Preflight checks",
          description:
            "Rama, working tree, sincronizacion remota, estado de login y permisos de publicacion se revisan antes de tocar nada.",
        },
        {
          title: "El mismo comando en local y CI",
          description:
            "Prompts interactivos en la terminal y ejecucion totalmente headless en CI. Sin configuracion separada ni flags para memorizar.",
        },
      ],
    },
    workflow: {
      badge: "Pipeline de release",
      title: "Un comando hace",
      titleAccent: "todo.",
      description:
        "Ejecuta `pubm` y se encarga del resto: versionado, preflight, tests, build y publicacion en todos los registros.",
      steps: [
        {
          title: "Elegir version",
          description:
            "Ejecuta `pubm` sin argumentos y elige patch, minor o major.",
        },
        {
          title: "Preflight y auth",
          description:
            "Antes de cambiar nada, pubm valida rama, working tree, sincronizacion remota y credenciales.",
        },
        {
          title: "Test, build y tag",
          description:
            "Se ejecutan tests y build, y luego se crean commit y tag de git de forma atomica.",
        },
        {
          title: "Publicar en todas partes",
          description:
            "Todos los registros reciben el paquete en paralelo. Si algo falla, todo se revierte.",
        },
      ],
    },
    install: {
      title: "Instala una vez. Luego solo ejecuta `pubm`.",
      description:
        "Proyecto nuevo o existente, puedes empezar de inmediato. pubm detecta tus registros desde el primer dia y no exige migracion despues.",
      readDocs: "Leer docs",
      viewGithub: "Ver en GitHub",
      copyLabel: "Copiar comandos",
      terminalTitle: "bash - instalacion",
    },
    footer: { tagline: "Un comando, todos los registros", docs: "Docs" },
    why: {
      badge: "Por que pubm?",
      title: "Empieza bien. Nunca migres.",
      description:
        "La mayoria de herramientas de release te atan a una configuracion. pubm crece con tu proyecto: agrega registros, paquetes o ecosistemas sin cambiar tu flujo.",
      items: [
        {
          heading: "Sin costo de migracion",
          body: "Empieza solo con npm. Agrega jsr o crates.io cuando quieras. Tu flujo no cambia.",
        },
        {
          heading: "JS + Rust, un solo pipeline",
          body: "Publicas un crate de Rust junto a un paquete npm? pubm lee package.json y Cargo.toml y lo publica todo junto.",
        },
        {
          heading: "Listo para monorepo desde el dia uno",
          body: "Hoy un paquete, manana diez. pubm publica segun dependencias para evitar releases rotos por mal orden.",
        },
      ],
    },
  },
};
