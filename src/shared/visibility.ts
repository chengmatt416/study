export type Visibility = "shared" | "private";
export function ownsPrivate(resource: { visibility?: string; owner_id?: string | null }, userId: string) {
  return resource.visibility === "private" && resource.owner_id === userId;
}
export function visibleTo(resource: { visibility?: string; owner_id?: string | null }, userId: string) {
  return resource.visibility !== "private" || resource.owner_id === userId;
}
export function writableBy(resource: { visibility?: string; owner_id?: string | null }, userId: string, sharedWrite: boolean) {
  return visibleTo(resource, userId) && (ownsPrivate(resource, userId) || sharedWrite);
}
