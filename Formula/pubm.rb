class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.13"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.13/pubm-darwin-arm64.tar.gz"
      sha256 "e964da364ca8ca7b2a72063fe12e9a5ae9132c77a7ac4b951e30395bb810c67d"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.13/pubm-darwin-x64.tar.gz"
      sha256 "1717d5b80eaaae4ef27cbd2ba1a0e87d3ac613d4369927855e4fc60768e5070d"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.13/pubm-linux-arm64.tar.gz"
      sha256 "303b1404f9c9ac2a30f5ea55fc54a754a72d9520c83a326f88fca86d2309cee7"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.13/pubm-linux-x64.tar.gz"
      sha256 "6e7371a601c13abeaead301c16ae9d2849819564dec59952d21a2950a9b7c17a"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
