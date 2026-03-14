import type { UpdateStatus } from "update-kit";
import { UpdateKit } from "update-kit";
import { PUBM_VERSION } from "./pubm-metadata.js";

async function createKit(): Promise<UpdateKit> {
  return UpdateKit.create({
    appName: "pubm",
    currentVersion: PUBM_VERSION,
    sources: [{ type: "npm", packageName: "pubm" }],
  });
}

export async function checkUpdateStatus(): Promise<UpdateStatus | undefined> {
  try {
    const kit = await createKit();
    return await kit.checkUpdate("blocking");
  } catch {
    return undefined;
  }
}

export async function notifyNewVersion(): Promise<void> {
  const kit = await createKit();
  const banner = await kit.checkAndNotify();
  if (banner) console.error(banner);
}
