class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.9"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.9/pubm-darwin-arm64.tar.gz"
      sha256 "7bfaf88e591d5b63daedea1d97f0fdbbb553680c2a6efa51714aeb797e8ac024"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.9/pubm-darwin-x64.tar.gz"
      sha256 "9ed56929bcee4fd945286202f56adb2d9c37d6f6619f9ffd00040afa23cf8325"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.9/pubm-linux-arm64.tar.gz"
      sha256 "56ebbb0715d928b97790f461eb673a0147ff79d579af3245877824ad4a53ac0e"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.9/pubm-linux-x64.tar.gz"
      sha256 "b76c2ad170af33c355736ca8a1e8cedc9ce7bdc1564d78e46fd592e6de03264a"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
