export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installStudyIdentity } = await import("@/lib/study-mcp/identity");
  const { configureAssetByteStore } = await import("@/lib/server/persistence-hooks");
  const { r2AssetBytes } = await import("@/lib/study-workers/assets");
  const { installBuiltinSkills } = await import("@/lib/study-workers/skills");
  installBuiltinSkills();
  installStudyIdentity();
  configureAssetByteStore({ name: "cloudflare-r2", create: () => r2AssetBytes });
}
