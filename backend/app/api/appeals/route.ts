import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import BanAppeal from "@/models/BanAppeal";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/appeals
 * Public appeal submission endpoint for users whose accounts are blocked or suspended
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, appeal_message } = body;

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanMessage = String(appeal_message || "").trim();

    if (!cleanEmail || !cleanMessage) {
      return NextResponse.json(
        { success: false, message: "Email and appeal explanation are required." },
        { status: 400 }
      );
    }

    if (cleanMessage.length < 15) {
      return NextResponse.json(
        { success: false, message: "Please provide a detailed appeal explanation of at least 15 characters." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const AppealModel = (BanAppeal as any).default || BanAppeal;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const targetUser = await UserModel.findOne({ email: cleanEmail });
    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: "No account found matching the provided email address." },
        { status: 404 }
      );
    }

    if (targetUser.status !== "blocked" && targetUser.status !== "suspended") {
      return NextResponse.json(
        { success: false, message: "This account is currently active. An appeal is not required." },
        { status: 400 }
      );
    }

    // Check if an appeal is already pending
    const existingPending = await AppealModel.findOne({
      appealingUserId: targetUser._id,
      appealStatus: "pending",
    });

    if (existingPending) {
      return NextResponse.json(
        {
          success: false,
          message: "An appeal is already under active administrative review for this account.",
          appealed_at: existingPending.appealedAt,
        },
        { status: 409 }
      );
    }

    // Retrieve the most recent ban record to attach context
    const latestBan = await HistoryModel.findOne({
      userId: targetUser._id,
      newStatus: { $in: ["blocked", "suspended"] },
    }).sort({ changedAt: -1 });

    const appeal = await AppealModel.create({
      appealingUserId: targetUser._id,
      originalBanReason: latestBan?.changeReason || "Account violation",
      originalBanDate: latestBan?.changedAt || targetUser.blockedAt || new Date(),
      originalBanningAdminId: latestBan?.changedByAdminId || targetUser.blockedByAdminId || null,
      appealMessage: cleanMessage,
      contactEmail: cleanEmail,
      appealStatus: "pending",
      appealedAt: new Date(),
    });

    return NextResponse.json(
      {
        success: true,
        message: "Your appeal has been submitted successfully and is pending administrative review.",
        appeal_id: appeal._id,
        submitted_at: appeal.appealedAt,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

