import { UpdateKit } from "update-kit";

export async function notifyNewVersion(): Promise<void> {
  const kit = await UpdateKit.create({
    sources: [{ type: "npm", packageName: "pubm" }],
  });

  const banner = await kit.checkAndNotify();
  if (banner) console.error(banner);
}
