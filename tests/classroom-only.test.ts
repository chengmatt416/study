import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isOpenMaicPublicPath } from '../src/shared/openmaic-routing';

describe('learner-only classroom', () => {
  it('serves only the classroom page, never the workspace, workbench or preview', () => {
    expect(isOpenMaicPublicPath('/classroom/abc')).toBe(true);
    for (const path of ['/workspace', '/workspace/x', '/workbench', '/workbench/1', '/generation-preview', '/generation-preview/1', '/']) expect(isOpenMaicPublicPath(path), path).toBe(false);
  });

  it('does not proxy the settings, export and authoring APIs', () => {
    for (const prefix of ['verify-model', 'verify-image-provider', 'verify-pdf-provider', 'verify-video-provider', 'skills', 'usage', 'export-video', 'comfyui-workflows', 'transcription', 'azure-voices', 'generate-classroom']) expect(isOpenMaicPublicPath('/api/' + prefix + '/x'), prefix).toBe(false);
  });

  it('lets the browser keep lesson media for an hour, and nothing else', () => {
    const proxy = readFileSync(join(__dirname, '..', 'src/worker/lib/openmaic-proxy.ts'), 'utf8');
    expect(proxy).toContain("url.pathname.startsWith('/api/classroom-media/') && result.ok) result.headers.set('cache-control', 'private, max-age=3600')");
    expect(proxy).toContain("else if (!publicAsset) result.headers.set('cache-control', 'private, no-store')");
  });

  it('still proxies what a lesson needs', () => {
    for (const path of ['/api/chat/pi', '/api/pbl/v2/instructor', '/api/stages/abc', '/api/persistence/x', '/api/classroom-media/a/b', '/api/study-mcp/session', '/_next/static/chunks/a.js', '/vendor/interactive/a.js']) expect(isOpenMaicPublicPath(path), path).toBe(true);
  });

  it('removes edit mode, the header and the voice controls from the classroom patch', () => {
    const patch = readFileSync(join(__dirname, '..', 'integrations/openmaic/cloudflare/patch-classroom.mjs'), 'utf8');
    for (const text of ['canEditOwnedStage = false', "hideHeader={!classroomHeaderControls.showHeader}', 'hideHeader'", 'onToggleMute', 'onToggleAutoPlay', 'onCycleSpeed']) expect(patch).toContain(text);
    expect(readFileSync(join(__dirname, '..', 'integrations/openmaic/cloudflare/overlay/components/study/classroom.css'), 'utf8')).toContain('lucide-mic-off');
  });
});
