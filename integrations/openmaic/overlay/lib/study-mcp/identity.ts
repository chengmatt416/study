import { headers } from "next/headers";
import { configureOwnerAuthentication } from "@/lib/server/identity/registry";
import type { OwnerAuthMethodResult } from "@/lib/server/identity/types";
import { studyTicket } from "./auth";

export function installStudyIdentity(): void {
  if ((process.env.STUDY_MCP_SECRET ?? "").length < 32)
    throw new Error(
      "STUDY_MCP_SECRET must be set before starting the MCP core",
    );
  const authenticate = async (request: {
    headers: Headers;
  }): Promise<OwnerAuthMethodResult> => {
    const ticket = await studyTicket(request.headers);
    return ticket
      ? {
          status: "authenticated",
          principal: {
            ownerId: ticket.sub,
            kind: "user",
            roles: new Set(),
            assurance: "verified",
            channel: "study-mcp",
          },
        }
      : { status: "invalid" };
  };
  configureOwnerAuthentication({
    anonymousFallback: false,
    methods: [
      {
        name: "study-mcp",
        authenticate,
        authenticateFromContext: async () =>
          authenticate({ headers: new Headers(await headers()) }),
        describeStoredOwner: (ownerId) =>
          ownerId.startsWith("study:")
            ? { kind: "user", roles: new Set() }
            : undefined,
      },
    ],
  });
}
