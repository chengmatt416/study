import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runImageJob } from '@/lib/server/material-extraction/document-image-worker.cloudflare.mjs';
import { runPptxJob } from '@/lib/server/agent-runtime/import-pptx-worker.cloudflare.mjs';

test('Workers document parser preserves official Markdown and HTML derivative references', () => {
  const result = runImageJob({ kind: 'plan', text: '![Mass](openmaic-derivative:mass.png)\n<img src="openmaic-derivative:spring.png">\n![External](https://example.invalid/image.png)' });
  expect(result.error).toBeUndefined();
  expect(result.result.markdown.map((image: { target: string }) => image.target)).toEqual(['openmaic-derivative:mass.png']);
  expect(result.result.html.map((image: { target: string }) => image.target)).toEqual(['openmaic-derivative:spring.png']);
});

test('Workers PPTX parser imports the official regression fixture into native slide elements', async () => {
  const bytes = await readFile('.openmaic/worker-core/packages/@openmaic/importer/test/fixtures/color-cache-collision.pptx');
  const result = await runPptxJob({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  expect(result.error).toBeUndefined();
  expect(result.slides).toHaveLength(1);
  expect(result.slides[0].elements).toHaveLength(13);
  expect(result.slides[0].elements.every((element: { type: string }) => element.type === 'shape')).toBe(true);
});
