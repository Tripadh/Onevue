import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import UserWarningHistory from "@/models/UserWarningHistory";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/user/warnings
 * Current user's warnings
 */
export async function GET(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json({ success: false, message: authResult.error }, { status: authResult.status });
    }
    const { user } = authResult;

    await connectToDatabase();
    const WarningModel = (UserWarningHistory as any).default || UserWarningHistory;

    const warnings = await WarningModel.find({ warnedUserId: user._id })
      .populate("warningTemplateId", "title category")
      .sort({ warnedAt: -1 })
      .lean();

    return NextResponse.json(
      {
        success: true,
        warnings: warnings.map((w: any) => ({
          id: w._id,
          message: w.warningMessage,
          severityLevel: w.severityLevel,
          warnedAt: w.warnedAt,
          acknowledgedAt: w.acknowledgedAt || null,
          sender: w.isAnonymous ? "OneVue Trust & Safety Team" : "OneVue Administrator",
          category: w.warningTemplateId?.category || "general",
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * POST /api/user/warnings/acknowledge
 * Acknowledge receipt of a warning
 */
export async function POST(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json({ success: false, message: authResult.error }, { status: authResult.status });
    }
    const { user } = authResult;

    const body = await req.json().catch(() => ({}));
    const { warning_id } = body;

    if (!warning_id) {
      return NextResponse.json({ success: false, message: "warning_id is required." }, { status: 400 });
    }

    await connectToDatabase();
    const WarningModel = (UserWarningHistory as any).default || UserWarningHistory;

    const warning = await WarningModel.findOne({ _id: warning_id, warnedUserId: user._id });
    if (!warning) {
      return NextResponse.json({ success: false, message: "Warning not found." }, { status: 404 });
    }

    warning.acknowledgedAt = new Date();
    await warning.save();

    return NextResponse.json(
      { success: true, message: "Warning acknowledged successfully." },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

