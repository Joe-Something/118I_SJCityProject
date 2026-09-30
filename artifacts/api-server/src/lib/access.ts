import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";

export const allowedDepartments = ["Planning", "Building", "Fire", "Economic Development"] as const;
const allowedDepartmentSet = new Set<string>(allowedDepartments);

export function signedInUser(req: Request, res: Response): string | null {
  const id = getAuth(req).userId;
  if (!id) res.status(401).json({ error: "Sign in to continue." });
  return id;
}

/** Staff eligibility is server-managed; every approved staff reviewer has administrator access. */
export type AuthorizedStaff = {
  id: string;
  department: string;
  administratorEnabled: boolean;
};

export function staffCanAccessDepartment(staff: AuthorizedStaff, department: string): boolean {
  // Economic Development has historically had the citywide queue.
  return staff.administratorEnabled || staff.department === "Economic Development" || staff.department === department;
}

export async function authorizedStaff(req: Request, res: Response): Promise<AuthorizedStaff | null> {
  const id = signedInUser(req, res);
  if (!id) return null;
  let user;
  try {
    user = await clerkClient.users.getUser(id);
  } catch {
    res.status(503).json({ error: "Staff permissions are temporarily unavailable. Please retry shortly." });
    return null;
  }
  const department = user.privateMetadata?.staffDepartment;
  if (user.privateMetadata?.staffRole !== "reviewer" || typeof department !== "string" || !allowedDepartmentSet.has(department)) {
    res.status(403).json({ error: "Staff access requires an administrator-assigned Clerk staff role." });
    return null;
  }
  return { id, department, administratorEnabled: true };
}