import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "../db";
import User, { IdentityType } from "../../models/User";
import { isJwtConfigError, resolveJwtSecret, verifyJwtToken } from "../auth";
import type { DomainContract } from "./types";
import { buildDomainUpdate, ProfileValidationError } from "./validate";
import { assertProfileAssetRefs, collectAssetBindings } from "../storage/asset-service";

interface ProfileDocument {
  toObject: (options?: { versionKey?: boolean }) => Record<string, unknown>;
}

interface DomainModel {
  findOne: (filter: Record<string, unknown>) => Promise<ProfileDocument | null>;
  create: (doc: Record<string, unknown>) => Promise<ProfileDocument>;
  findOneAndUpdate: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>
  ) => Promise<ProfileDocument | null>;
}

interface AccountUser {
  _id: unknown;
  name: string;
  email: string;
  identity?: string;
}

function asModel(model: unknown): DomainModel {
  if (model && typeof model === "object" && "default" in model) {
    const wrapped = model as { default?: DomainModel };
    if (wrapped.default) return wrapped.default;
  }
  return model as DomainModel;
}

export async function ensureDomainProfile(Model: DomainModel, userId: unknown) {
  const existing = await Model.findOne({ userId });
  if (existing) return existing;
  try {
    return await Model.create({ userId });
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      const again = await Model.findOne({ userId });
      if (again) return again;
    }
    throw error;
  }
}

function serializeValue(value: unknown): unknown {
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "_id" || key === "__v") continue;
    out[key] = serializeValue(child);
  }
  if (record._id != null) {
    const explicit = typeof record.id === "string" && record.id ? record.id : "";
    out.id = explicit || String(record._id);
  }
  return out;
}

export function serializeDomainProfile(doc: { toObject?: (opts?: object) => Record<string, unknown> }) {
  const raw = typeof doc.toObject === "function" ? doc.toObject({ versionKey: false }) : doc;
  return serializeValue(raw);
}

async function authenticateIdentity(req: Request, identity: IdentityType) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: "Authentication required. Please provide a valid Bearer token.",
      status: 401 as const,
    };
  }

  const token = authHeader.split(" ")[1];
  let secret: string;
  try {
    secret = resolveJwtSecret();
  } catch (error) {
    if (isJwtConfigError(error)) {
      return { error: "Server authentication is not configured.", status: 500 as const };
    }
    return { error: "Server authentication is not configured.", status: 500 as const };
  }

  let decoded: { id: string; email: string };
  try {
    decoded = verifyJwtToken(token, secret);
  } catch {
    return { error: "Invalid or expired session token.", status: 401 as const };
  }
  if (!decoded?.id || typeof decoded.id !== "string") {
    return { error: "Invalid or expired session token.", status: 401 as const };
  }

  try {
    await connectToDatabase();
  } catch {
    return { error: "Internal server error", status: 500 as const };
  }

  const UserModel = (User as unknown as { default?: typeof User }).default || User;
  let user: AccountUser | null;
  try {
    user = (await UserModel.findById(decoded.id)) as AccountUser | null;
  } catch {
    return { error: "Invalid or expired session token.", status: 401 as const };
  }
  if (!user) {
    return { error: "Authenticated user no longer exists.", status: 401 as const };
  }

  const actual = String(user.identity || "").toLowerCase();
  if (actual !== identity) {
    return {
      error: `Access denied. Your identity is '${actual || "unset"}', but this profile is reserved for '${identity}'.`,
      status: 403 as const,
    };
  }
  return { user };
}

function failure(error: unknown) {
  if (error instanceof ProfileValidationError || (error instanceof Error && error.name === "ProfileValidationError")) {
    const status = error instanceof ProfileValidationError ? error.status : 400;
    return NextResponse.json({ message: error.message }, { status });
  }
  if (isJwtConfigError(error)) {
    return NextResponse.json({ message: "Server authentication is not configured." }, { status: 500 });
  }
  const code = (error as { code?: number })?.code;
  if (code === 11000) {
    return NextResponse.json(
      { message: "A profile for this account already exists." },
      { status: 409 }
    );
  }
  if (error instanceof mongoose.Error.ValidationError || (error instanceof Error && error.name === "ValidationError")) {
    const errors = (error as { errors?: Record<string, { message?: string }> }).errors;
    const first = errors ? Object.values(errors)[0]?.message : "";
    return NextResponse.json({ message: first || "Profile validation failed." }, { status: 400 });
  }
  if (error instanceof Error && error.name === "CastError") {
    return NextResponse.json({ message: "Invalid profile data." }, { status: 400 });
  }
  console.error("Domain profile request failed");
  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}

function ownerPayload(user: { _id: unknown; name: string; email: string; identity?: string }, profile: unknown) {
  return {
    success: true,
    profile,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      identity: user.identity,
    },
  };
}

export function createDomainProfileHandlers(
  identity: IdentityType,
  model: unknown,
  contract: DomainContract
) {
  const Model = asModel(model);

  async function GET(req: Request) {
    try {
      const authResult = await authenticateIdentity(req, identity);
      if ("error" in authResult) {
        return NextResponse.json({ message: authResult.error }, { status: authResult.status });
      }
      const profile = await ensureDomainProfile(Model, authResult.user._id);
      return NextResponse.json(ownerPayload(authResult.user, serializeDomainProfile(profile)), { status: 200 });
    } catch (error) {
      return failure(error);
    }
  }

  async function PUT(req: Request) {
    try {
      const authResult = await authenticateIdentity(req, identity);
      if ("error" in authResult) {
        return NextResponse.json({ message: authResult.error }, { status: authResult.status });
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ message: "Malformed JSON payload in request body." }, { status: 400 });
      }

      const profile = await ensureDomainProfile(Model, authResult.user._id);
      const existing = profile.toObject({ versionKey: false }) as Record<string, unknown>;
      const $set = buildDomainUpdate(existing, body, contract, authResult.user._id);
      await assertProfileAssetRefs(String(authResult.user._id), collectAssetBindings($set));
      let updated: ProfileDocument = profile;
      if (Object.keys($set).length > 0) {
        const saved = await Model.findOneAndUpdate(
          { userId: authResult.user._id },
          { $set },
          { returnDocument: "after", runValidators: true }
        );
        if (!saved) {
          return NextResponse.json({ message: "Profile could not be updated." }, { status: 404 });
        }
        updated = saved;
      }
      return NextResponse.json(ownerPayload(authResult.user, serializeDomainProfile(updated)), { status: 200 });
    } catch (error) {
      return failure(error);
    }
  }

  async function OPTIONS() {
    return NextResponse.json({}, { status: 200 });
  }

  return { GET, PUT, OPTIONS };
}
