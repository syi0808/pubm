class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.5.2"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.2/pubm-darwin-arm64.tar.gz"
      sha256 "efa21faf88f061eadedcb98cabe9b018a6a4ec50ef3e4880d0b9babcb5eeaab5"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.2/pubm-darwin-x64.tar.gz"
      sha256 "9643b213474cf4d5ab61612c61524be838a093476bda6defa0ebcbb412f1b104"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.2/pubm-linux-arm64.tar.gz"
      sha256 "06f7f6ea15070609770330a1bbbc459097acd23a820991b2a9c5044705895ec2"
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/pubm%400.5.2/pubm-linux-x64.tar.gz"
      sha256 "b502292bfccf9cff0ec1b9dbef67e6118fe354cecd5761251c2a5f0f616b0483"
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
