import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../../lib/db";
import User from "../../../../../../models/User";
import VisitingCard from "../../../../../../models/VisitingCard";
import UserWebsiteConfig from "../../../../../../models/UserWebsiteConfig";
import { verifyAdminAuth, checkDomainAccess, logDataAccess } from "../../../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { userId } = await context.params;
    if (!userId) {
      return NextResponse.json({ success: false, message: "userId parameter is required." }, { status: 400 });
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const CardModel = (VisitingCard as any).default || VisitingCard;
    const WebConfigModel = (UserWebsiteConfig as any).default || UserWebsiteConfig;

    const targetUser = await UserModel.findById(userId).select("-password").lean();
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    // Aggregate statistics
    const [cardCount, webConfig] = await Promise.all([
      CardModel.countDocuments({ userId }),
      WebConfigModel.findOne({ userId }).lean(),
    ]);

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    // Strict Data Access Logging
    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: userId,
      accessType: "view",
      dataFieldsAccessed: ["email", "username", "status", "identity", "stats"],
      ipAddress,
      userAgent,
      reason: "Pre-action safeguard impact preview",
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          username: targetUser.username || null,
          role: targetUser.role || "user",
          status: targetUser.status || "active",
          identity: targetUser.identity || "unassigned",
          blockedUntil: targetUser.blockedUntil || null,
        },
        stats: {
          join_date: targetUser.createdAt,
          last_active: targetUser.updatedAt,
          card_count: cardCount,
          website_claimed: !!webConfig,
          website_subdomain: webConfig?.username || null,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

