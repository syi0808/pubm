class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.5.1"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.1/pubm-darwin-arm64.tar.gz"
      sha256 "c38429868ed72312e8e55660b86742da1b37b106c73f994a1dcbe977f21a0dcc"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.1/pubm-darwin-x64.tar.gz"
      sha256 "80302a205eb469cc530cd31bff3c2a0b94ae2e3dde4301ea2566177108b22a9a"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.1/pubm-linux-arm64.tar.gz"
      sha256 "dc06548b9f6374d22e587a7e04726c8ba5422d5039d3fb8e2b074c94f6aff248"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.1/pubm-linux-x64.tar.gz"
      sha256 "e99ca7253ad2fbc0bb3ea7fba1ba61148738aef285f9aa9643b67a6ce85caaf1"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
