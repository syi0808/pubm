class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.5.0"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.0/pubm-darwin-arm64.tar.gz"
      sha256 "a76b5e3d6223c7352b826abdee0890f549d19128f30ab00a785bd2c4b74f917d"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.0/pubm-darwin-x64.tar.gz"
      sha256 "8b6dc2fe6c976ebc45edb836f051bac3569a5393a7af286ec5fe5c12fa719235"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.0/pubm-linux-arm64.tar.gz"
      sha256 "487f2104280bb74ed5df7459fc0796302b02cc61f6ccc3208c6eaf9002dfa321"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.0/pubm-linux-x64.tar.gz"
      sha256 "e2d3b2749215502634c860aa8a571aba2384bfb512cc51dbddec2672b125acde"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
