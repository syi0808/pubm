import { UpdateKit } from "update-kit";
import { PUBM_VERSION } from "./pubm-metadata.js";

export async function notifyNewVersion(): Promise<void> {
  const kit = await UpdateKit.create({
    appName: "pubm",
    currentVersion: PUBM_VERSION,
    sources: [{ type: "npm", packageName: "pubm" }],
  });

  const banner = await kit.checkAndNotify();
  if (banner) console.error(banner);
}
