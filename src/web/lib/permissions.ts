import { writableBy } from "../../shared/visibility";
import type { User } from "./types";

export const canEditContent = (user: User, content: { visibility?: string; created_by?: string | null }) =>
  writableBy({ visibility: content.visibility, owner_id: content.created_by }, user.id, user.access?.features.shared_write !== false);
