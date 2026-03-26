class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.4.10"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.10/pubm-darwin-arm64.tar.gz"
      sha256 "047da7201b13ab159b9b608ad50050cef91597b8fc8e7b106a7bf61f7e465265"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.10/pubm-darwin-x64.tar.gz"
      sha256 "f5510fbb3026cc13ad054d20c4dff88858a3a9524eb6c1a0b9f6a4fe29fb5bba"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.10/pubm-linux-arm64.tar.gz"
      sha256 "ea716d4dd0619023350356ebf52f37d406b0bbdd7879cfe09a661e6652415adf"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.4.10/pubm-linux-x64.tar.gz"
      sha256 "eb2618569e898a73db35879035e84a17c0ebf725a44b78be831109517b089397"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
