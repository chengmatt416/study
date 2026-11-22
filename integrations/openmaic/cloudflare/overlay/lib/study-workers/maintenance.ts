import { AssetCollector } from '@openmaic/storage/asset/collector';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { resolveAssetCollectionGraceMs } from '@/lib/persistence/asset-collection-grace';
import { assetReferencePrincipalsForOwner } from '@/lib/persistence/owner-assets';
import { STAGE_META_OWNERSHIP } from '@/lib/persistence/stage-meta-ownership';
import { compactFinishedGenerationRuns } from '@/lib/server/generation/run/store';
import { removeDeletedOriginals } from '@/lib/server/materials/migrate-to-pool';
import { r2AssetBytes } from './assets';

export async function maintain(): Promise<void> {
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const graceMs = resolveAssetCollectionGraceMs();
  const collector = new AssetCollector(provider.pool, r2AssetBytes, {
    withTransaction: provider.withTransaction, graceMs, documentReferences: true, batchSize: 100,
    assetReferencePrincipals: assetReferencePrincipalsForOwner, documentOwnership: STAGE_META_OWNERSHIP,
  });
  await collector.collectPass();
  await compactFinishedGenerationRuns(graceMs);
  await removeDeletedOriginals();
}
