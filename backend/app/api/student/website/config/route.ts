import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig, {
  APPROVED_TEMPLATES,
  ApprovedTemplateId,
} from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { presentationForTemplate } from "../../../../../lib/templates/registry";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/student/website/config
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    await connectToDatabase();
    const config = await UserWebsiteConfig.findOne({ userId: auth.user._id });

    if (!config) {
      return NextResponse.json(
        {
          success: true,
          config: null,
          message: "No website configuration found for this user.",
        },
        { status: 200 }
      );
    }

    let activeRevisionNumber: number | null = null;
    if (config.activeRevisionId) {
      const activeRev = await PublishedProfileRevision.findById(config.activeRevisionId).select(
        "revisionNumber publishedAt"
      );
      if (activeRev) {
        activeRevisionNumber = activeRev.revisionNumber;
      }
    }

    return NextResponse.json(
      {
        success: true,
        config: {
          username: config.username,
          selectedTemplateId: config.selectedTemplateId,
          selectedTemplateVersion: config.selectedTemplateVersion,
          customization: config.customization,
          status: config.status,
          activeRevisionId: config.activeRevisionId,
          activeRevisionNumber,
          publishedAt: config.publishedAt,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

/* =========================================================================
   PUT /api/student/website/config
   ========================================================================= */

const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/;

export async function PUT(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Malformed JSON payload in request body." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ message: "Request body must be an object." }, { status: 400 });
    }

    // Reject client-supplied ownership overrides
    if (body.userId !== undefined && String(body.userId) !== String(auth.user._id)) {
      return NextResponse.json(
        { message: "Unauthorized attempt to modify website ownership." },
        { status: 403 }
      );
    }

    // Direct revision activation or status tampering via config PUT is forbidden
    if (body.activeRevisionId !== undefined) {
      return NextResponse.json(
        { message: "Direct mutation of activeRevisionId is forbidden. Use the publish or rollback endpoints." },
        { status: 400 }
      );
    }
    if (body.status === "published") {
      return NextResponse.json(
        { message: "Status cannot be set to 'published' via config update. An explicit publication request is required." },
        { status: 400 }
      );
    }

    // Validate Template ID
    if (body.selectedTemplateId !== undefined) {
      if (!APPROVED_TEMPLATES.includes(body.selectedTemplateId as ApprovedTemplateId)) {
        return NextResponse.json(
          {
            message: `Template '${body.selectedTemplateId}' is not in the approved template registry. Approved templates: ${APPROVED_TEMPLATES.join(
              ", "
            )}`,
          },
          { status: 400 }
        );
      }
    }

    if (body.customization !== undefined) {
      if (typeof body.customization !== "object" || body.customization === null || Array.isArray(body.customization)) {
        return NextResponse.json({ message: "Customization must be an object." }, { status: 400 });
      }
    }

    await connectToDatabase();

    // Validate and check Username Uniqueness
    let normalizedUsername: string | undefined = undefined;
    if (body.username !== undefined) {
      normalizedUsername = String(body.username).toLowerCase().trim();
      if (!USERNAME_REGEX.test(normalizedUsername)) {
        return NextResponse.json(
          {
            message:
              "Invalid username format. Must be 3-30 lowercase characters, start and end with an alphanumeric character, and contain only letters, numbers, periods, hyphens, or underscores.",
          },
          { status: 400 }
        );
      }

      const existingClaim = await UserWebsiteConfig.findOne({
        username: normalizedUsername,
        userId: { $ne: auth.user._id },
      });
      if (existingClaim) {
        return NextResponse.json(
          { message: `Username '${normalizedUsername}' is already claimed by another user.` },
          { status: 409 }
        );
      }
    }

    let config = await UserWebsiteConfig.findOne({ userId: auth.user._id });
    const templateId = String(
      body.selectedTemplateId || config?.selectedTemplateId || "magicui-portfolio"
    );
    let presentation: ReturnType<typeof presentationForTemplate> | null = null;
    if (body.customization !== undefined) {
      const current =
        config?.customization && typeof (config.customization as { toObject?: () => object }).toObject === "function"
          ? (config.customization as { toObject: () => object }).toObject()
          : config?.customization || {};
      try {
        presentation = presentationForTemplate(templateId, {
          ...current,
          ...body.customization,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Invalid appearance settings.";
        return NextResponse.json({ message }, { status: 400 });
      }
    }

    if (!config) {
      if (!normalizedUsername) {
        return NextResponse.json(
          { message: "A valid username is required to initialize website configuration." },
          { status: 400 }
        );
      }

      config = new UserWebsiteConfig({
        userId: auth.user._id,
        username: normalizedUsername,
        selectedTemplateId: body.selectedTemplateId || "magicui-portfolio",
        selectedTemplateVersion: body.selectedTemplateVersion || "1.0.0",
        customization: presentation || undefined,
        status: "draft",
      });
    } else {
      if (normalizedUsername) config.username = normalizedUsername;
      if (body.selectedTemplateId) config.selectedTemplateId = body.selectedTemplateId;
      if (body.selectedTemplateVersion) config.selectedTemplateVersion = body.selectedTemplateVersion;
      if (presentation) {
        config.customization = presentation;
        config.markModified("customization");
      }
      if (body.status === "draft" || body.status === "suspended") {
        config.status = body.status;
      }
    }

    await config.save();

    return NextResponse.json(
      {
        success: true,
        message: "Website configuration saved successfully.",
        config: {
          username: config.username,
          selectedTemplateId: config.selectedTemplateId,
          selectedTemplateVersion: config.selectedTemplateVersion,
          customization: config.customization,
          status: config.status,
          activeRevisionId: config.activeRevisionId,
          publishedAt: config.publishedAt,
          updatedAt: config.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    if (error && error.code === 11000) {
      return NextResponse.json(
        { message: "Username conflict: That username is already claimed by another user." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
