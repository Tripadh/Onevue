import { NextResponse } from "next/server";
import * as QRCode from "qrcode";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const data = searchParams.get("data") || searchParams.get("url");

    if (!data) {
      return NextResponse.json(
        { message: "Query parameter 'data' or 'url' is required." },
        { status: 400 }
      );
    }

    const format = searchParams.get("format") || "svg";
    const fg = searchParams.get("fg") || "#000000";
    const bg = searchParams.get("bg") || "#ffffff";
    const size = parseInt(searchParams.get("size") || "250", 10);

    const options = {
      color: {
        dark: fg,
        light: bg,
      },
      width: Math.min(Math.max(size, 80), 800),
      margin: 1,
    };

    if (format === "svg") {
      const qrSvg = await QRCode.toString(data, { ...options, type: "svg" });
      return new Response(qrSvg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200",
        },
      });
    }

    const dataUrl = await QRCode.toDataURL(data, options);
    return NextResponse.json({ success: true, dataUrl }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
