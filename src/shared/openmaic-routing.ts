// Native Next.js paths keep their original URLs on the STUDY origin.
const CORE_API_PREFIXES = new Set([
  "access-code",
  "agent",
  "agents",
  "chat",
  "classroom-media",
  "folders",
  "generate",
  "generation-runs",
  "identity",
  "materials",
  "model-config",
  "parse-pdf",
  "pbl",
  "persistence",
  "provider",
  "proxy-media",
  "quiz-grade",
  "server-providers",
  "stage-meta",
  "stages",
]);

export function isOpenMaicPublicPath(path: string): boolean {
  if (/^\/classroom(?:\/|$)/.test(path)) return true;
  if (/^\/(?:_next|avatars|logos)(?:\/|$)/.test(path)) return true;
  if (/^\/vendor\/(?:interactive|maic-importer|standalone-player|video-export)(?:\/|$)/.test(path) || path === '/vendor/gsap.min.js') return true;
  if (/^\/(?:openmaic-mark|logo-horizontal)\.png$/.test(path) || path === '/api/study-mcp/session') return true;
  return path.startsWith('/api/') && CORE_API_PREFIXES.has(path.split('/')[2]);
}
