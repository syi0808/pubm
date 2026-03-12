type TerminalSegment = {
  text?: string;
  tone?: string;
  strong?: boolean;
  underline?: boolean;
  spinner?: boolean;
};

type TerminalLine = {
  blank?: boolean;
  segments?: TerminalSegment[];
};

type VersionPromptOption = {
  label: string;
  value?: string;
};

type PromptCommandAnimation = {
  type: "prompt-command";
  commandBase: string;
  commandSuffix: string;
  erase?: boolean;
};

type PromptSelectAnimation = {
  type: "prompt-select";
  options: VersionPromptOption[];
  selectionOrder: number[];
  selectionInterval?: number;
  commandText: string;
};

type TaskAnimation = {
  type: "task";
};

type TerminalFrameAnimation =
  | PromptCommandAnimation
  | PromptSelectAnimation
  | TaskAnimation;

type TerminalFrame = {
  duration: number;
  lines: TerminalLine[];
  animation?: TerminalFrameAnimation;
};

type TerminalPanelMode = "autoplay" | "manual";

type PanelState = {
  currentFrame: number;
  frameTimer?: number;
  frames: TerminalFrame[];
  frameStartedAt: number;
  mode: TerminalPanelMode;
  host: PubmTerminalPlayerElement;
  screen: HTMLElement;
  spinnerIndex: number;
  animationTimer?: number;
};

interface PubmTerminalPlayerElement extends HTMLElement {
  __terminalState?: PanelState;
  setFrame: (frameIndex: number) => void;
}

declare global {
  interface Window {
    __pubmTerminalApi?: {
      setFrame: (panel: Element | null, frameIndex: number) => void;
    };
  }

  interface HTMLElementTagNameMap {
    "pubm-terminal-player": PubmTerminalPlayerElement;
  }
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const panelSelector = "[data-pubm-terminal]";

function clampFrameIndex(index: number, frames: TerminalFrame[]): number {
  return Math.max(0, Math.min(index, frames.length - 1));
}

function frameHasSpinner(frame: TerminalFrame): boolean {
  return frame.lines.some((line) =>
    (line.segments ?? []).some((segment) => segment.spinner),
  );
}

function frameNeedsAnimation(frame: TerminalFrame): boolean {
  return frameHasSpinner(frame) || Boolean(frame.animation);
}

function clearPanelTimers(state: PanelState): void {
  if (state.frameTimer) {
    window.clearTimeout(state.frameTimer);
    state.frameTimer = undefined;
  }

  if (state.animationTimer) {
    window.clearInterval(state.animationTimer);
    state.animationTimer = undefined;
  }
}

function getCommandText(
  animation: PromptCommandAnimation,
  elapsed: number,
): string {
  const base = animation.commandBase;
  const suffix = animation.commandSuffix;
  const full = `${base}${suffix}`;
  const typeStep = 75;
  const deleteStep = 55;
  const phases =
    animation.erase === false
      ? ([
          { type: "hold", text: base, duration: 180 },
          { type: "type", from: base, to: full, step: typeStep },
          { type: "hold", text: full, duration: 900 },
        ] as const)
      : ([
          { type: "hold", text: base, duration: 240 },
          { type: "type", from: base, to: full, step: typeStep },
          { type: "hold", text: full, duration: 420 },
          { type: "delete", from: full, to: base, step: deleteStep },
          { type: "hold", text: base, duration: 240 },
        ] as const);

  let cycle =
    elapsed %
    phases.reduce((total, phase) => {
      if (phase.type === "hold") {
        return total + phase.duration;
      }

      return total + Math.abs(phase.to.length - phase.from.length) * phase.step;
    }, 0);

  for (const phase of phases) {
    if (phase.type === "hold") {
      if (cycle < phase.duration) {
        return phase.text;
      }

      cycle -= phase.duration;
      continue;
    }

    const lengthDelta = phase.to.length - phase.from.length;
    const steps = Math.abs(lengthDelta);
    const duration = steps * phase.step;
    if (cycle >= duration) {
      cycle -= duration;
      continue;
    }

    const step = Math.floor(cycle / phase.step);
    if (phase.type === "type") {
      return phase.to.slice(0, phase.from.length + step + 1);
    }

    return phase.from.slice(0, phase.from.length - step - 1);
  }

  return base;
}

function createPromptOptionLine(
  option: VersionPromptOption,
  isSelected: boolean,
): TerminalLine {
  if (isSelected) {
    return {
      segments: [
        { text: "❯ ", tone: "prompt" },
        { text: option.label, tone: "selected", underline: true },
        option.value ? { text: option.value, tone: "dim" } : undefined,
      ].filter(Boolean) as TerminalSegment[],
    };
  }

  return {
    segments: [
      { text: `  ${option.label}` },
      option.value ? { text: option.value, tone: "dim" } : undefined,
    ].filter(Boolean) as TerminalSegment[],
  };
}

function getPromptSelectLines(
  animation: PromptSelectAnimation,
  elapsed: number,
): TerminalLine[] {
  const order =
    animation.selectionOrder.length > 0 ? animation.selectionOrder : [0];
  const selectedIndex =
    order[
      Math.floor(elapsed / (animation.selectionInterval ?? 320)) % order.length
    ] ?? 0;

  return [
    {
      segments: [
        { text: "$ ", tone: "prompt" },
        { text: animation.commandText },
      ],
    },
    { blank: true },
    {
      segments: [
        { text: "? ", tone: "prompt" },
        {
          text: "Select SemVer increment or specify new version",
          strong: true,
        },
        { text: " ...", tone: "dim" },
      ],
    },
    ...animation.options.map((option, index) =>
      createPromptOptionLine(option, index === selectedIndex),
    ),
  ];
}

function getPromptCommandLines(
  frame: TerminalFrame,
  animation: PromptCommandAnimation,
  elapsed: number,
): TerminalLine[] {
  const lines = frame.lines.map(cloneLine);
  const cursor = Math.floor(elapsed / 260) % 2 === 0 ? "▋" : " ";

  lines[0] = {
    segments: [
      { text: "$ ", tone: "prompt" },
      { text: getCommandText(animation, elapsed) },
      { text: cursor, tone: "dim" },
    ],
  };

  return lines;
}

function cloneLine(line: TerminalLine): TerminalLine {
  return {
    blank: line.blank,
    segments: line.segments?.map((segment) => ({ ...segment })),
  };
}

function withTaskSpinner(lines: TerminalLine[]): TerminalLine[] {
  return lines.map((line) => {
    const [firstSegment, ...restSegments] = line.segments ?? [];
    if (!firstSegment?.text?.includes("❯")) {
      return cloneLine(line);
    }

    const match = firstSegment.text.match(/^(\s*)❯\s$/);
    if (!match) {
      return cloneLine(line);
    }

    const segments: TerminalSegment[] = [];
    if (match[1]) {
      segments.push({ text: match[1] });
    }

    segments.push({ spinner: true, tone: firstSegment.tone ?? "warning" });
    segments.push({ text: " " });

    return {
      blank: line.blank,
      segments: [
        ...segments,
        ...restSegments.map((segment) => ({ ...segment })),
      ],
    };
  });
}

function getRenderableLines(
  frame: TerminalFrame,
  state: PanelState,
): TerminalLine[] {
  const elapsed = Math.max(0, performance.now() - state.frameStartedAt);

  if (frame.animation?.type === "prompt-command") {
    return getPromptCommandLines(frame, frame.animation, elapsed);
  }

  if (frame.animation?.type === "prompt-select") {
    return getPromptSelectLines(frame.animation, elapsed);
  }

  const lines = frame.lines.map(cloneLine);
  if (frame.animation?.type === "task") {
    return withTaskSpinner(lines);
  }

  return lines;
}

function buildFrame(
  screen: HTMLElement,
  frame: TerminalFrame,
  state: PanelState,
  animateRows: boolean,
): void {
  screen.replaceChildren();

  getRenderableLines(frame, state).forEach((line) => {
    const row = document.createElement("div");
    row.className = line.blank
      ? "terminal-row terminal-row-blank"
      : "terminal-row";

    if (animateRows) {
      row.classList.add("is-entering");
    }

    if (line.blank) {
      row.textContent = " ";
      screen.append(row);
      return;
    }

    (line.segments ?? []).forEach((segment) => {
      const span = document.createElement("span");
      span.className = "terminal-segment";

      if (segment.tone) {
        span.classList.add(`tone-${segment.tone}`);
      }

      if (segment.strong) {
        span.classList.add("is-strong");
      }

      if (segment.underline) {
        span.classList.add("is-underline");
      }

      if (segment.spinner) {
        span.dataset.spinner = "true";
        span.textContent =
          spinnerFrames[state.spinnerIndex % spinnerFrames.length];
      } else {
        span.textContent = segment.text ?? "";
      }

      row.append(span);
    });

    screen.append(row);
  });
}

function startFrameAnimation(state: PanelState): void {
  if (state.animationTimer) {
    window.clearInterval(state.animationTimer);
    state.animationTimer = undefined;
  }

  const frame = state.frames[state.currentFrame];
  if (!frameNeedsAnimation(frame)) {
    return;
  }

  state.animationTimer = window.setInterval(() => {
    state.spinnerIndex = (state.spinnerIndex + 1) % spinnerFrames.length;
    buildFrame(state.screen, frame, state, false);
  }, 90);
}

function renderFrame(state: PanelState, frameIndex: number): void {
  state.currentFrame = clampFrameIndex(frameIndex, state.frames);
  state.frameStartedAt = performance.now();
  buildFrame(state.screen, state.frames[state.currentFrame], state, true);
  startFrameAnimation(state);
}

function scheduleNextFrame(state: PanelState): void {
  if (state.mode !== "autoplay") {
    return;
  }

  if (state.frameTimer) {
    window.clearTimeout(state.frameTimer);
  }

  const delay = state.frames[state.currentFrame].duration;
  state.frameTimer = window.setTimeout(() => {
    renderFrame(state, (state.currentFrame + 1) % state.frames.length);
    scheduleNextFrame(state);
  }, delay);
}

function parseFrames(host: HTMLElement): TerminalFrame[] {
  const framesElement = host.querySelector("[data-terminal-frames]");

  if (!(framesElement instanceof HTMLScriptElement)) {
    return [];
  }

  try {
    const parsed = JSON.parse(framesElement.textContent || "[]");
    return Array.isArray(parsed) ? (parsed as TerminalFrame[]) : [];
  } catch {
    return [];
  }
}

function createPanelState(host: PubmTerminalPlayerElement): PanelState | null {
  const screen = host.querySelector("[data-terminal-screen]");
  if (!(screen instanceof HTMLElement)) {
    return null;
  }

  const frames = parseFrames(host);
  if (frames.length === 0) {
    return null;
  }

  const mode = host.dataset.terminalMode === "manual" ? "manual" : "autoplay";
  const initialFrame = Number.parseInt(
    host.dataset.terminalInitialFrame ?? "0",
    10,
  );
  const state: PanelState = {
    currentFrame: clampFrameIndex(
      Number.isNaN(initialFrame) ? 0 : initialFrame,
      frames,
    ),
    frames,
    frameStartedAt: performance.now(),
    mode,
    host,
    screen,
    spinnerIndex: 0,
  };

  host.__terminalState = state;

  renderFrame(state, state.currentFrame);

  if (state.mode === "autoplay") {
    scheduleNextFrame(state);
  }

  return state;
}

function cleanupPanel(host: PubmTerminalPlayerElement): void {
  const state = host.__terminalState;
  if (!state) {
    return;
  }

  clearPanelTimers(state);
  delete host.__terminalState;
}

function setFrame(panel: Element | null, frameIndex: number): void {
  const host =
    panel instanceof HTMLElement ? panel.closest(panelSelector) : null;

  if (!(host instanceof HTMLElement)) {
    return;
  }

  const player = host as PubmTerminalPlayerElement;
  const state = player.__terminalState ?? createPanelState(player);
  if (!state) {
    return;
  }

  state.mode = "manual";
  clearPanelTimers(state);
  renderFrame(state, frameIndex);
}

function initPanels(root: ParentNode = document): void {
  root.querySelectorAll(panelSelector).forEach((panel) => {
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    const host = panel as PubmTerminalPlayerElement;
    if (host.__terminalState) {
      return;
    }

    host.setFrame = (frameIndex: number) => {
      setFrame(host, frameIndex);
    };

    createPanelState(host);
  });
}

function cleanupPanels(root: ParentNode = document): void {
  root.querySelectorAll(panelSelector).forEach((panel) => {
    if (panel instanceof HTMLElement) {
      cleanupPanel(panel as PubmTerminalPlayerElement);
    }
  });
}

window.__pubmTerminalApi = { setFrame };

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initPanels(), {
    once: true,
  });
} else {
  initPanels();
}

window.addEventListener("load", () => initPanels());
document.addEventListener("astro:after-swap", () => {
  cleanupPanels();
  initPanels();
});
document.addEventListener("astro:page-load", () => initPanels());

export {};
