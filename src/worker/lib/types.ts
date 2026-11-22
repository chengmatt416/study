export type Role = "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser; sessionHash: string; canSharedWrite: boolean; accessRules: import("../../shared/access").AccessRule[]; accessResources: import("../../shared/access").AccessResource[] };
};
