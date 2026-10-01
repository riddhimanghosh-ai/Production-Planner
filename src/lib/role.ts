import { cookies } from "next/headers";
import { store } from "@/data/store";
import type { Viewer } from "./workflow";

export const VIEWER_COOKIE = "sln_viewer";
export const ALL_ACCESS: Viewer = { id: null, name: "All access (demo)", role: "ALL" };

// Prototype sign-in: the "Viewing as" picker stores a user id in a cookie until real logins exist.
export async function getViewer(): Promise<Viewer> {
  const value = (await cookies()).get(VIEWER_COOKIE)?.value;
  const user = value && value !== "ALL" ? store().users.find((u) => String(u.id) === value) : undefined;
  return user ? { id: user.id, name: user.name, role: user.role } : ALL_ACCESS;
}
