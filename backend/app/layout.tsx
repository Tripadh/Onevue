import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OneVue Backend API",
  description: "OneVue Backend & Authentication Services",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0c0d12", color: "#f0f2f8" }}>
        {children}
      </body>
    </html>
  );
}
