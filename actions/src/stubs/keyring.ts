export default class UnsupportedKeyring {
  constructor() {
    throw new Error("Native keyring is not available in pubm GitHub Actions.");
  }
}
