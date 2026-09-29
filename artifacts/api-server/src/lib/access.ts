import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";

const allowedDepartments = new Set(["Planning", "Building", "Fire", "Economic Development"]);

export function signedInUser(req: Request, res: Response): string | null {
  const id = getAuth(req).userId;
  if (!id) res.status(401).json({ error: "Sign in to continue." });
  return id;
}

/** Private Clerk user metadata is only assignable by an administrator, never the browser. */
export async function authorizedStaff(req: Request, res: Response): Promise<{ id: string; department: string } | null> {
  const id = signedInUser(req, res);
  if (!id) return null;
  const user = await clerkClient.users.getUser(id);
  const department = user.privateMetadata?.staffDepartment;
  if (user.privateMetadata?.staffRole !== "reviewer" || typeof department !== "string" || !allowedDepartments.has(department)) {
    res.status(403).json({ error: "Staff access requires an administrator-assigned Clerk staff role." });
    return null;
  }
  return { id, department };
}