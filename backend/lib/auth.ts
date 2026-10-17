import * as jwtLib from "jsonwebtoken";
import connectToDatabase from "./db";
import User from "../models/User";

/* =========================================================================
   OneVue Authentication & Authorization Helper
   ========================================================================= */

export function verifyJwtToken(token: string, secret: string): { id: string; email: string } {
  const pkg: any = jwtLib;
  const verifier =
    (pkg && typeof pkg.verify === "function" && pkg.verify) ||
    (pkg && pkg.default && typeof pkg.default.verify === "function" && pkg.default.verify) ||
    (typeof require === "function" && require("jsonwebtoken").verify);

  if (!verifier) {
    throw new Error("JWT verify function not found.");
  }
  return verifier(token, secret) as { id: string; email: string };
}

export interface AuthSuccess {
  user: any;
}

export interface AuthFailure {
  error: string;
  status: number;
}

export type AuthResult = AuthSuccess | AuthFailure;

export async function verifyAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: "Authentication required. Please provide a valid Bearer token.",
      status: 401,
    };
  }

  const token = authHeader.split(" ")[1];
  let decoded: { id: string; email: string };
  try {
    decoded = verifyJwtToken(token, process.env.JWT_SECRET || "fallback_secret");
  } catch {
    return { error: "Invalid or expired session token.", status: 401 };
  }

  await connectToDatabase();
  const UserModel = (User as any).default || User;
  const user = await UserModel.findById(decoded.id);
  if (!user) {
    return { error: "Authenticated user no longer exists.", status: 401 };
  }

  return { user };
}
