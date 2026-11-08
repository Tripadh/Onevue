import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { validateEligibleTemplateSelection } from "../../../../../lib/template-registry-extension";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "../../../../../lib/public-profile-dto";

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
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

    // Validate Template Selection against Central Registry
    if (body.selectedTemplateId !== undefined || body.selectedTemplateVersion !== undefined) {
      if (
        body.selectedTemplateId !== undefined &&
        (typeof body.selectedTemplateId !== "string" || !body.selectedTemplateId.trim())
      ) {
        return NextResponse.json(
          { message: "Template ID is required.", code: "TEMPLATE_ID_REQUIRED" },
          { status: 400 }
        );
      }
      if (
        body.selectedTemplateVersion !== undefined &&
        (typeof body.selectedTemplateVersion !== "string" || !body.selectedTemplateVersion.trim())
      ) {
        return NextResponse.json(
          { message: "Template version is required.", code: "VERSION_REQUIRED" },
          { status: 400 }
        );
      }

      const candidateTemplateId =
        body.selectedTemplateId !== undefined
          ? body.selectedTemplateId.trim()
          : "magicui-portfolio";
      const candidateTemplateVersion =
        body.selectedTemplateVersion !== undefined
          ? body.selectedTemplateVersion.trim()
          : "latest";

      const earlyValidation = await validateEligibleTemplateSelection(
        candidateTemplateId,
        candidateTemplateVersion,
        PUBLIC_PROFILE_SCHEMA_VERSION
      );

      if (!earlyValidation.valid) {
        return NextResponse.json(
          {
            message: earlyValidation.error,
            code: earlyValidation.code,
          },
          { status: 400 }
        );
      }
    }

    // Validate Customization
    if (body.customization !== undefined) {
      if (typeof body.customization !== "object" || body.customization === null) {
        return NextResponse.json({ message: "Customization must be an object." }, { status: 400 });
      }
      if (body.customization.accentColor !== undefined) {
        if (!HEX_COLOR_REGEX.test(String(body.customization.accentColor).trim())) {
          return NextResponse.json(
            { message: "Invalid hex accent color. Must be a valid 3- or 6-digit hex string (e.g. #3b82f6)." },
            { status: 400 }
          );
        }
      }
      if (body.customization.themeMode !== undefined) {
        if (!["light", "dark", "system"].includes(body.customization.themeMode)) {
          return NextResponse.json(
            { message: "Invalid themeMode. Must be 'light', 'dark', or 'system'." },
            { status: 400 }
          );
        }
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
    if (!config) {
      if (!normalizedUsername) {
        return NextResponse.json(
          { message: "A valid username is required to initialize website configuration." },
          { status: 400 }
        );
      }

      const initialTemplateId =
        body.selectedTemplateId !== undefined
          ? body.selectedTemplateId.trim()
          : "magicui-portfolio";
      const requestedTemplateVersion =
        body.selectedTemplateVersion !== undefined
          ? body.selectedTemplateVersion.trim()
          : "latest";

      const initValidation = await validateEligibleTemplateSelection(
        initialTemplateId,
        requestedTemplateVersion,
        PUBLIC_PROFILE_SCHEMA_VERSION
      );
      if (!initValidation.valid) {
        return NextResponse.json(
          {
            message: initValidation.error,
            code: initValidation.code,
          },
          { status: 400 }
        );
      }

      config = new UserWebsiteConfig({
        userId: auth.user._id,
        username: normalizedUsername,
        selectedTemplateId: initialTemplateId,
        selectedTemplateVersion:
          (initValidation as any).resolvedVersion || requestedTemplateVersion,
        customization: body.customization,
        status: "draft",
      });
    } else {
      if (normalizedUsername) config.username = normalizedUsername;

      if (body.selectedTemplateId !== undefined || body.selectedTemplateVersion !== undefined) {
        const resolvedTemplateId =
          body.selectedTemplateId !== undefined
            ? body.selectedTemplateId.trim()
            : config.selectedTemplateId;
        const switchingTemplate =
          body.selectedTemplateId !== undefined &&
          body.selectedTemplateId.trim() !== config.selectedTemplateId;
        const resolvedTemplateVersion =
          body.selectedTemplateVersion !== undefined
            ? body.selectedTemplateVersion.trim()
            : switchingTemplate
              ? "latest"
              : config.selectedTemplateVersion;

        const updateValidation = await validateEligibleTemplateSelection(
          resolvedTemplateId,
          resolvedTemplateVersion,
          PUBLIC_PROFILE_SCHEMA_VERSION
        );

        if (!updateValidation.valid) {
          return NextResponse.json(
            {
              message: updateValidation.error,
              code: updateValidation.code,
            },
            { status: 400 }
          );
        }

        config.selectedTemplateId = resolvedTemplateId;
        // Persist the resolved release, so 'latest' selections pin a concrete
        // immutable version and never drift when newer releases appear.
        config.selectedTemplateVersion =
          (updateValidation as any).resolvedVersion || resolvedTemplateVersion;
      }
      if (body.customization) {
        config.customization = {
          accentColor: body.customization.accentColor || config.customization?.accentColor || "#3b82f6",
          themeMode: body.customization.themeMode || config.customization?.themeMode || "system",
          visibleSections:
            body.customization.visibleSections ||
            config.customization?.visibleSections || [
              "about",
              "education",
              "projects",
              "skills",
              "achievements",
              "contact",
            ],
        };
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
