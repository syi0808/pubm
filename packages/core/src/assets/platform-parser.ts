import type { ParsedPlatform } from "./types.js";

const OS_MAP: Record<string, string> = {
  darwin: "darwin",
  macos: "darwin",
  mac: "darwin",
  osx: "darwin",
  macosx: "darwin",
  linux: "linux",
  lin: "linux",
  windows: "windows",
  win: "windows",
  win32: "windows",
  win64: "windows",
  freebsd: "freebsd",
  openbsd: "openbsd",
  netbsd: "netbsd",
  android: "android",
  ios: "ios",
  solaris: "solaris",
  sunos: "solaris",
  illumos: "illumos",
  aix: "aix",
  dragonfly: "dragonfly",
  dragonflybsd: "dragonfly",
  plan9: "plan9",
  fuchsia: "fuchsia",
  haiku: "haiku",
  redox: "redox",
};

const ARCH_MAP: Record<string, string> = {
  x64: "x64",
  x86_64: "x64",
  amd64: "x64",
  "x86-64": "x64",
  ia32: "ia32",
  i386: "ia32",
  i486: "ia32",
  i586: "ia32",
  i686: "ia32",
  x86: "ia32",
  "386": "ia32",
  arm64: "arm64",
  aarch64: "arm64",
  armv8: "arm64",
  aarch_64: "arm64",
  arm: "arm",
  armv7: "arm",
  armv7l: "arm",
  armv6: "arm",
  armv6l: "arm",
  armhf: "arm",
  armel: "arm",
  ppc64le: "ppc64le",
  powerpc64le: "ppc64le",
  ppc64el: "ppc64le",
  ppc64: "ppc64",
  powerpc64: "ppc64",
  ppc: "ppc",
  powerpc: "ppc",
  s390x: "s390x",
  riscv64: "riscv64",
  riscv64gc: "riscv64",
  loong64: "loong64",
  loongarch64: "loong64",
  la64: "loong64",
  mips: "mips",
  mips32: "mips",
  mipsel: "mipsel",
  mipsle: "mipsel",
  mips64: "mips64",
  mips64el: "mips64el",
  mips64le: "mips64el",
  wasm32: "wasm32",
  wasm: "wasm32",
  wasm64: "wasm64",
  universal: "universal",
  universal2: "universal",
  fat: "universal",
};

const ABI_SET = new Set([
  "gnu",
  "glibc",
  "musl",
  "msvc",
  "mingw",
  "mingw32",
  "mingw-w64",
  "gnueabihf",
  "gnueabi",
  "musleabihf",
  "musleabi",
  "androideabi",
  "uclibc",
  "bionic",
]);

const VARIANT_SET = new Set(["baseline", "v2", "v3", "v4", "avx2", "avx512"]);
const VENDOR_SET = new Set(["unknown", "apple", "pc", "none"]);

export function parsePlatform(input: string): ParsedPlatform {
  const tokens = input.split("-");
  const result: ParsedPlatform = { raw: input };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!result.os && OS_MAP[lower]) {
      result.os = OS_MAP[lower];
    } else if (!result.arch && ARCH_MAP[lower]) {
      result.arch = ARCH_MAP[lower];
    } else if (!result.abi && ABI_SET.has(lower)) {
      result.abi = lower === "glibc" ? "gnu" : lower;
    } else if (!result.variant && VARIANT_SET.has(lower)) {
      result.variant = lower;
    } else if (!result.vendor && VENDOR_SET.has(lower)) {
      result.vendor = lower;
    }
  }

  // Remove undefined fields for clean output
  if (result.os === undefined) delete result.os;
  if (result.arch === undefined) delete result.arch;
  if (result.vendor === undefined) delete result.vendor;
  if (result.abi === undefined) delete result.abi;
  if (result.variant === undefined) delete result.variant;

  return result;
}
