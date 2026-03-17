class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.3"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.3/pubm-darwin-arm64.tar.gz"
      sha256 "f5aca1f7df98aece3d18628a2ce4f99b5b21be40623bf74e53f074c847317b1f"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.3/pubm-darwin-x64.tar.gz"
      sha256 "a485848c9ce746f7254ca6a1c3a5fed22b33eef7c78034067ecdb39e60f8c39d"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.3/pubm-linux-arm64.tar.gz"
      sha256 "af1980db02eacf8a2af83a3c8bfb81269a41c161f0ea0bc0a4f15e79d5d29a65"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.3/pubm-linux-x64.tar.gz"
      sha256 "859675e0a7a3c2dee13a39b4ee197e4c174cf652b086cb89146e8000488e8bab"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
