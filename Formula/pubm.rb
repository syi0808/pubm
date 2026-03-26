class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.12"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.12/pubm-darwin-arm64.tar.gz"
      sha256 "2eb1f7920fe34cadf7ff216fe96c6c4307bff9b2ce96126d73e296df108c6457"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.12/pubm-darwin-x64.tar.gz"
      sha256 "a90f00c8e3951b579b9516191490a2b5b65e8f8dc6eaa9f61641a5e3ae20de3e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.12/pubm-linux-arm64.tar.gz"
      sha256 "a30868ca18935fa981228bf697b79a60b26daf57238dea379afc813993e9ac01"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.12/pubm-linux-x64.tar.gz"
      sha256 "75aa891c63ec3d54324332c67e6bd782fe14011e37137c2221ecae845e397d14"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
