import sharp from 'sharp';
import { sha256 } from '@musefold/scheme-package';
import { importFixture } from '../../modules/design-scheme-packages/__tests__/import-fixture.js';

/** Distinct images make swapped mappings observable; the existing shared codec still builds the ZIP. */
export async function packageExchangeContent() {
  const fixture = await importFixture();
  fixture.manifest.document.name = '跨端 Café 山水 ✨';
  const colors = ['#2463eb', '#eab308', '#db2777'];
  for (const [index, asset] of fixture.manifest.assets.entries()) {
    const width = index + 2;
    const height = index + 3;
    const bytes = await sharp({ create: { width, height, channels: 4, background: colors[index] } })
      .png()
      .toBuffer();
    Object.assign(asset, { width, height, byteSize: bytes.length, contentHash: sha256(bytes) });
    fixture.content.set(`assets/${asset.id}.png`, bytes);
    const sourcePath =
      asset.id === 'repo-asset'
        ? ['repo-snap', 'style.png']
        : asset.id === 'history-asset'
          ? ['history-snap', 'image.png']
          : null;
    if (sourcePath) {
      fixture.content.set(`sources/${sourcePath[0]}/${sourcePath[1]}`, bytes);
      const snapshot = fixture.manifest.sourceSnapshots.find((item) => item.id === sourcePath[0]);
      const file = snapshot?.files.find((item) => item.relativePath === sourcePath[1]);
      if (!snapshot || !file) throw new Error('Missing fixed source image fixture');
      file.contentHash = sha256(bytes);
      file.sizeBytes = bytes.length;
      snapshot.totalBytes = snapshot.files.reduce((sum, item) => sum + item.sizeBytes, 0);
    }
    for (const image of fixture.manifest.document.repositoryImages ?? [])
      if (image.assetId === asset.id) image.contentHash = sha256(bytes);
  }
  return fixture;
}
