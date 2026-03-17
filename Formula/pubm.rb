class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.2"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.2/pubm-darwin-arm64.tar.gz"
      sha256 "bed2df6cf787ddd79bbf415c8802188e9eef12b59bdbd10b9022393d2e2f40f5"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.2/pubm-darwin-x64.tar.gz"
      sha256 "c6fd4952803178c42a23f05255e7b4fdf8ee9f39adbc15bda025c59aa9800c7f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.2/pubm-linux-arm64.tar.gz"
      sha256 "7656ff77cf50e0e025afe8be0fbc3b9b64bf303444fb86b67acfa3830a157e3c"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.2/pubm-linux-x64.tar.gz"
      sha256 "cb1fddab48546fd7abc886568bec314d49d3161baf30ea297fb135e80b698bfa"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
