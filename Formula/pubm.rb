class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.1"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.1/pubm-darwin-arm64.tar.gz"
      sha256 "92c6fdea276353858bf23de81ade5f12ad6b7de036dc4a3638f53a89ddd3737f"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.1/pubm-darwin-x64.tar.gz"
      sha256 "92c6fdea276353858bf23de81ade5f12ad6b7de036dc4a3638f53a89ddd3737f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.1/pubm-linux-arm64.tar.gz"
      sha256 "92c6fdea276353858bf23de81ade5f12ad6b7de036dc4a3638f53a89ddd3737f"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.1/pubm-linux-x64.tar.gz"
      sha256 "92c6fdea276353858bf23de81ade5f12ad6b7de036dc4a3638f53a89ddd3737f"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
