class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.5.5"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.5/pubm-darwin-arm64.tar.gz"
      sha256 "7e53c4e8301251db517f0875e6743e756c8b63532b0443fddca8b9a5726a66b3"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.5/pubm-darwin-x64.tar.gz"
      sha256 "0c8f527677da9279c7229b38bc5d482ad02272b6a2088a89acd5fabbdd385340"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.5/pubm-linux-arm64.tar.gz"
      sha256 "08117e7150569491ff48ee731f34e9429a678e6d89f9cd46919d50d5d4a2c34f"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.5/pubm-linux-x64.tar.gz"
      sha256 "6da6c1a89be8ed46b77bf7a91e3a03303844e65c2d665a5edf961aeb66166743"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
