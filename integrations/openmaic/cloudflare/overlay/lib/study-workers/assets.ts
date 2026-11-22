import { workersEnvironment } from "./context";

export const r2AssetBytes = {
  writesOutsideRegistryDatabase: true as const,
  async write(hash: string, bytes: Uint8Array): Promise<void> {
    await workersEnvironment().OPENMAIC_FILES.put(`openmaic/assets/${hash}`, bytes);
  },
  async read(hash: string): Promise<Uint8Array | null> {
    const object = await workersEnvironment().OPENMAIC_FILES.get(`openmaic/assets/${hash}`);
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  },
  async delete(hash: string): Promise<void> {
    await workersEnvironment().OPENMAIC_FILES.delete(`openmaic/assets/${hash}`);
  },
};
