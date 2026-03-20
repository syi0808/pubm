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
      title: "pubm - One command, every registry",
      description:
        "One command to publish across npm, jsr, crates.io, and private registries with automatic rollback when things go wrong.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Get Started" },
    hero: {
      badge: "v0.4.4 available",
      titleLine1: "One command.",
      titleLine2: "Every registry.",
      description:
        "Publish to npm, jsr, crates.io, and private registries in a single step. If anything fails, pubm rolls everything back automatically.",
      primaryCta: "Get Started",
      secondaryCta: "Star on GitHub",
    },
    registry: {
      badge: "Unified Distribution",
      title: "Write once,",
      titleAccent: "ship everywhere.",
      description:
        "Stop juggling registry CLIs. Pubm handles authentication, protocols, and publishing across every ecosystem so you focus on code, not deployment scripts.",
      statuses: {
        connected: "Connected",
        ready: "Ready",
        private: "Private",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Publish without fear",
      description:
        "Every release is validated, orchestrated, and recoverable. No more half-published packages or manual cleanup.",
      items: [
        {
          title: "One workflow, every registry",
          description:
            "npm, jsr, crates.io, and private registries from a single command, with dependency-aware ordering for monorepos.",
        },
        {
          title: "Automatic rollback",
          description:
            "If any registry rejects your package, pubm undoes the version bump, git tag, and commit so your repo returns to its previous state.",
        },
        {
          title: "Catch problems before publishing",
          description:
            "Branch guards, clean working tree, remote sync, and registry auth are verified before any side effects happen.",
        },
        {
          title: "Works locally and in CI",
          description:
            "Interactive prompts at the terminal, fully headless in CI. Same command and same guarantees.",
        },
        {
          title: "Set up once, scale forever",
          description:
            "Start a new project with pubm and never revisit your release setup. Add registries, packages, or ecosystems without changing your workflow.",
        },
      ],
    },
    workflow: {
      badge: "Release Pipeline",
      title: "One command does",
      titleAccent: "everything.",
      description:
        "Run `pubm` and it handles the rest: version prompts, preflight checks, testing, building, and publishing across every registry.",
      steps: [
        {
          title: "Pick your version",
          description:
            "Run `pubm` with no arguments and choose the next patch, minor, or major release before anything else happens.",
        },
        {
          title: "Preflight and auth",
          description:
            "pubm verifies the branch, working tree, remote sync, and registry credentials before it makes changes.",
        },
        {
          title: "Test, build, tag",
          description:
            "Your test suite runs, the build executes, and the version is bumped atomically with a git commit and tag.",
        },
        {
          title: "Publish everywhere",
          description:
            "All registries receive your package concurrently. If anything fails, every change rolls back automatically.",
        },
      ],
    },
    install: {
      title: "Install once. Then just run `pubm`.",
      description:
        "Start fresh or drop into an existing project. pubm wires npm, jsr, and private registries from day one — no migration needed later.",
      readDocs: "Read the Docs",
      viewGithub: "View on GitHub",
      copyLabel: "Copy commands",
      terminalTitle: "bash - install",
    },
    footer: { tagline: "One command, every registry", docs: "Docs" },
    why: {
      badge: "Why pubm?",
      title: "The right foundation for new projects",
      description:
        "Most release tools assume you already know what you need. pubm gives new projects a complete, multi-registry setup from day one.",
      items: [
        {
          heading: "No migration later",
          body: "Start with npm only and add jsr or crates.io when you're ready — no workflow changes required.",
        },
        {
          heading: "JS + Rust in one pipeline",
          body: "Shipping a Rust crate alongside an npm package? pubm reads both package.json and Cargo.toml — one command publishes to npm, jsr, and crates.io together.",
        },
        {
          heading: "Grows with your monorepo",
          body: "One package today, ten tomorrow. pubm's dependency-aware ordering means you never publish in the wrong order.",
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
      badge: "v0.4.4 사용 가능",
      titleLine1: "명령은 하나.",
      titleLine2: "배포 대상은 전부.",
      description:
        "npm, jsr, crates.io, 사설 레지스트리까지 한 번에 배포합니다. 중간에 실패하면 pubm이 전체 변경을 자동으로 되돌립니다.",
      primaryCta: "시작하기",
      secondaryCta: "GitHub에서 스타 주기",
    },
    registry: {
      badge: "통합 배포",
      title: "한 번 작성하고,",
      titleAccent: "어디든 배포하세요.",
      description:
        "레지스트리마다 다른 CLI를 따로 다룰 필요가 없습니다. pubm이 인증, 프로토콜, 배포 흐름을 통합합니다.",
      statuses: {
        connected: "연결됨",
        ready: "준비됨",
        private: "비공개",
        enterprise: "엔터프라이즈",
      },
    },
    features: {
      title: "불안 없이 배포하세요",
      description:
        "모든 릴리스는 사전 검증되고, 전체 흐름이 오케스트레이션되며, 실패 시 복구 가능합니다.",
      items: [
        {
          title: "하나의 워크플로, 모든 레지스트리",
          description:
            "npm, jsr, crates.io, 사설 레지스트리를 단일 명령으로 처리하며, 모노레포에서는 의존 순서를 고려해 배포합니다.",
        },
        {
          title: "자동 롤백",
          description:
            "어느 한 레지스트리라도 배포를 거부하면 버전 변경, git 태그, 커밋까지 되돌려 저장소 상태를 복원합니다.",
        },
        {
          title: "배포 전에 문제 감지",
          description:
            "브랜치 상태, 워킹 트리, 원격 동기화, 레지스트리 인증을 실제 변경 전에 확인합니다.",
        },
        {
          title: "로컬과 CI 모두 지원",
          description:
            "터미널에서는 대화형으로, CI에서는 완전 무인으로 동작합니다. 명령과 보장은 동일합니다.",
        },
        {
          title: "한 번 설정, 영구적으로 확장",
          description:
            "pubm으로 새 프로젝트를 시작하면 릴리즈 설정을 다시 손볼 필요가 없습니다. 레지스트리, 패키지, 생태계를 추가해도 워크플로우는 그대로입니다.",
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
        "새 프로젝트든 기존 프로젝트든 바로 시작하세요. pubm은 처음부터 npm, jsr, private registry를 모두 지원합니다.",
      readDocs: "문서 읽기",
      viewGithub: "GitHub 보기",
      copyLabel: "명령 복사",
      terminalTitle: "bash - 설치",
    },
    footer: { tagline: "하나의 명령, 모든 레지스트리", docs: "문서" },
    why: {
      badge: "왜 pubm인가?",
      title: "새 프로젝트를 위한 올바른 기반",
      description:
        "대부분의 릴리즈 도구는 이미 무엇이 필요한지 알고 있다고 가정합니다. pubm은 새 프로젝트에 처음부터 완전한 멀티 레지스트리 셋업을 제공합니다.",
      items: [
        {
          heading: "나중에 마이그레이션 없음",
          body: "지금은 npm만으로 시작하고, 준비되면 jsr이나 crates.io를 추가하세요 — 워크플로우 변경이 없습니다.",
        },
        {
          heading: "JS + Rust 하나의 파이프라인",
          body: "npm 패키지와 함께 Rust crate도 배포하나요? pubm은 package.json과 Cargo.toml을 모두 읽어 npm, jsr, crates.io를 한 번에 배포합니다.",
        },
        {
          heading: "모노레포와 함께 성장",
          body: "오늘은 패키지 1개, 내일은 10개. pubm의 의존성 순서 정렬로 항상 올바른 순서로 배포됩니다.",
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
      badge: "v0.4.4 已可用",
      titleLine1: "一条命令。",
      titleLine2: "所有仓库。",
      description:
        "一步发布到 npm、jsr、crates.io 和私有仓库。任何一步失败时，pubm 会自动回滚全部变更。",
      primaryCta: "开始使用",
      secondaryCta: "在 GitHub 上加星",
    },
    registry: {
      badge: "统一分发",
      title: "写一次，",
      titleAccent: "发布到所有地方。",
      description:
        "不必再切换不同仓库 CLI。pubm 统一处理认证、协议和发布流程。",
      statuses: {
        connected: "已连接",
        ready: "就绪",
        private: "私有",
        enterprise: "企业",
      },
    },
    features: {
      title: "放心发布",
      description: "每次发布都会先验证、统一编排，并且在失败时可恢复。",
      items: [
        {
          title: "一套流程，覆盖所有仓库",
          description:
            "同一条命令同时支持 npm、jsr、crates.io 和私有仓库，也支持 monorepo 依赖顺序。",
        },
        {
          title: "自动回滚",
          description:
            "任何仓库拒绝发布时，pubm 会撤销版本变更、git tag 和提交。",
        },
        {
          title: "发布前先发现问题",
          description:
            "分支状态、工作区、远端同步和仓库认证都会在真正执行前完成校验。",
        },
        {
          title: "本地与 CI 一致",
          description:
            "本地终端可交互，CI 中可全自动执行。命令一致，保证一致。",
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
        "默认流程是交互式的：在终端选择 patch、minor 或 major，后续发布流程由 pubm 处理。",
      readDocs: "阅读文档",
      viewGithub: "查看 GitHub",
      copyLabel: "复制命令",
      terminalTitle: "bash - 安装",
    },
    footer: { tagline: "一条命令，所有仓库", docs: "文档" },
  },
  fr: {
    meta: {
      title: "pubm - Une commande pour tous les registres",
      description:
        "Publiez vers npm, jsr, crates.io et des registres prives avec rollback automatique en cas d'echec.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Commencer" },
    hero: {
      badge: "v0.4.4 disponible",
      titleLine1: "Une commande.",
      titleLine2: "Tous les registres.",
      description:
        "Publiez vers npm, jsr, crates.io et vos registres prives en une seule etape. En cas d'echec, pubm annule tout automatiquement.",
      primaryCta: "Commencer",
      secondaryCta: "Ajouter une etoile",
    },
    registry: {
      badge: "Distribution unifiee",
      title: "Ecrire une fois,",
      titleAccent: "deployer partout.",
      description:
        "Inutile de jongler avec plusieurs CLI de registre. pubm gere l'authentification, les protocoles et la publication.",
      statuses: {
        connected: "Connecte",
        ready: "Pret",
        private: "Prive",
        enterprise: "Entreprise",
      },
    },
    features: {
      title: "Publier sans crainte",
      description: "Chaque release est verifiee, orchestree et recuperable.",
      items: [
        {
          title: "Un workflow pour tous les registres",
          description:
            "Une seule commande pour npm, jsr, crates.io et les registres prives, avec ordre de dependances pour les monorepos.",
        },
        {
          title: "Rollback automatique",
          description:
            "Si un registre refuse le package, pubm annule le bump de version, le tag git et le commit.",
        },
        {
          title: "Problemes detectes avant publication",
          description:
            "Etat de la branche, working tree, synchro distante et auth registre sont verifies avant les effets de bord.",
        },
        {
          title: "Local et CI",
          description:
            "Interactif dans le terminal, sans interaction en CI. Meme commande, memes garanties.",
        },
      ],
    },
    workflow: {
      badge: "Pipeline de release",
      title: "Une commande fait",
      titleAccent: "tout.",
      description:
        "Lancez `pubm` et il gere le reste: version, preflight, tests, build et publication multi-registres.",
      steps: [
        {
          title: "Choisir la version",
          description:
            "Executez `pubm` sans argument et choisissez la prochaine version patch, minor ou major.",
        },
        {
          title: "Preflight et auth",
          description:
            "pubm verifie la branche, le working tree, la synchro distante et les credentials avant toute modification.",
        },
        {
          title: "Tester, builder, tagger",
          description:
            "Les tests et le build s'executent puis le commit git et le tag sont crees de facon atomique.",
        },
        {
          title: "Publier partout",
          description:
            "Tous les registres recoivent le package en parallele. En cas d'echec, tout est restaure.",
        },
      ],
    },
    install: {
      title: "Installez une fois. Ensuite, lancez simplement `pubm`.",
      description:
        "Le flux par defaut est interactif: choisissez patch, minor ou major, puis laissez pubm piloter la release.",
      readDocs: "Lire la doc",
      viewGithub: "Voir sur GitHub",
      copyLabel: "Copier les commandes",
      terminalTitle: "bash - installation",
    },
    footer: { tagline: "Une commande, tous les registres", docs: "Docs" },
  },
  de: {
    meta: {
      title: "pubm - Ein Befehl fur alle Registries",
      description:
        "Mit einem Befehl nach npm, jsr, crates.io und private Registries veroffentlichen, mit automatischem Rollback bei Fehlern.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Loslegen" },
    hero: {
      badge: "v0.4.4 verfugbar",
      titleLine1: "Ein Befehl.",
      titleLine2: "Jede Registry.",
      description:
        "Veroffentliche in einem Schritt nach npm, jsr, crates.io und private Registries. Wenn etwas fehlschlagt, rollt pubm alles automatisch zuruck.",
      primaryCta: "Loslegen",
      secondaryCta: "Auf GitHub markieren",
    },
    registry: {
      badge: "Einheitliche Distribution",
      title: "Einmal schreiben,",
      titleAccent: "uberall ausliefern.",
      description:
        "Keine getrennten Registry-CLIs mehr. pubm ubernimmt Authentifizierung, Protokolle und Veroffentlichung uber alle Okosysteme hinweg.",
      statuses: {
        connected: "Verbunden",
        ready: "Bereit",
        private: "Privat",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Ohne Risiko veroffentlichen",
      description:
        "Jeder Release wird validiert, orchestriert und kann wiederhergestellt werden.",
      items: [
        {
          title: "Ein Workflow fur alle Registries",
          description:
            "Eine einzige Anweisung fur npm, jsr, crates.io und private Registries, inklusive abhangigkeitsbewusster Reihenfolge im Monorepo.",
        },
        {
          title: "Automatisches Rollback",
          description:
            "Wenn eine Registry das Paket ablehnt, macht pubm Version, Git-Tag und Commit ruckgangig.",
        },
        {
          title: "Probleme vor dem Publish erkennen",
          description:
            "Branch, Working Tree, Remote-Sync und Registry-Auth werden vor Seiteneffekten gepruft.",
        },
        {
          title: "Lokal und in CI",
          description:
            "Interaktiv im Terminal, voll headless in CI. Gleicher Befehl, gleiche Garantien.",
        },
      ],
    },
    workflow: {
      badge: "Release-Pipeline",
      title: "Ein Befehl erledigt",
      titleAccent: "alles.",
      description:
        "`pubm` ubernimmt Versionswahl, Preflight-Checks, Tests, Build und Veroffentlichung uber alle Registries.",
      steps: [
        {
          title: "Version wahlen",
          description:
            "Starte `pubm` ohne Argumente und wahl Patch, Minor oder Major aus.",
        },
        {
          title: "Preflight und Auth",
          description:
            "Vor Anderungen pruft pubm Branch, Working Tree, Remote-Sync und Zugangsdaten.",
        },
        {
          title: "Testen, bauen, taggen",
          description:
            "Tests und Build laufen, dann werden Version, Git-Commit und Tag atomar erzeugt.",
        },
        {
          title: "Uberall veroffentlichen",
          description:
            "Alle Registries erhalten das Paket parallel. Bei Fehlern wird alles zuruckgesetzt.",
        },
      ],
    },
    install: {
      title: "Einmal installieren. Danach einfach `pubm` ausfuhren.",
      description:
        "Der Standardablauf ist interaktiv: Patch, Minor oder Major wahlen, den Rest der Release-Pipeline ubernimmt pubm.",
      readDocs: "Docs lesen",
      viewGithub: "Auf GitHub ansehen",
      copyLabel: "Befehle kopieren",
      terminalTitle: "bash - installation",
    },
    footer: { tagline: "Ein Befehl, jede Registry", docs: "Docs" },
  },
  es: {
    meta: {
      title: "pubm - Un comando para todos los registros",
      description:
        "Publica en npm, jsr, crates.io y registros privados con un solo comando y rollback automatico si algo falla.",
    },
    nav: { docs: "Docs", github: "GitHub", cta: "Empezar" },
    hero: {
      badge: "v0.4.4 disponible",
      titleLine1: "Un comando.",
      titleLine2: "Todos los registros.",
      description:
        "Publica en npm, jsr, crates.io y registros privados en un solo paso. Si algo falla, pubm revierte todos los cambios automaticamente.",
      primaryCta: "Empezar",
      secondaryCta: "Dar estrella en GitHub",
    },
    registry: {
      badge: "Distribucion unificada",
      title: "Escribe una vez,",
      titleAccent: "publica en todas partes.",
      description:
        "Deja de alternar entre CLIs de registros. pubm gestiona autenticacion, protocolos y publicacion en todos los ecosistemas.",
      statuses: {
        connected: "Conectado",
        ready: "Listo",
        private: "Privado",
        enterprise: "Enterprise",
      },
    },
    features: {
      title: "Publica sin miedo",
      description: "Cada release se valida, se orquesta y puede recuperarse.",
      items: [
        {
          title: "Un flujo para todos los registros",
          description:
            "Una sola orden para npm, jsr, crates.io y registros privados, con orden segun dependencias en monorepos.",
        },
        {
          title: "Rollback automatico",
          description:
            "Si un registro rechaza el paquete, pubm deshace el cambio de version, el tag y el commit.",
        },
        {
          title: "Detecta problemas antes de publicar",
          description:
            "Se verifican rama, working tree, sincronizacion remota y auth antes de generar efectos laterales.",
        },
        {
          title: "Funciona localmente y en CI",
          description:
            "Interactivo en terminal y totalmente sin cabeza en CI. Mismo comando, mismas garantias.",
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
        "El flujo por defecto es interactivo: elige patch, minor o major en la terminal y deja que pubm haga el resto.",
      readDocs: "Leer docs",
      viewGithub: "Ver en GitHub",
      copyLabel: "Copiar comandos",
      terminalTitle: "bash - instalacion",
    },
    footer: { tagline: "Un comando, todos los registros", docs: "Docs" },
  },
};
