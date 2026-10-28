import Link from "next/link";
import { FlickeringGrid } from "@/components/magicui/flickering-grid";
import { DATA } from "@/data/resume";
import { AdaptedCustomField, AdaptedSocialLink } from "@/lib/onevue-profile-adapter";
import { Icons } from "@/components/icons";
import { CustomFieldList } from "@/components/section/custom-fields";

interface ContactSectionProps {
  contact?: {
    email?: string;
    tel?: string;
    social: Record<string, AdaptedSocialLink>;
    customFields?: AdaptedCustomField[];
  };
  resumeUrl?: string;
  resumeFields?: AdaptedCustomField[];
}

function renderContactIcon(iconName: string) {
  switch (iconName) {
    case "github":
      return <Icons.github className="size-4" />;
    case "linkedin":
      return <Icons.linkedin className="size-4" />;
    case "x":
      return <Icons.x className="size-4" />;
    case "instagram":
      return <Icons.instagram className="size-4" />;
    case "email":
      return <Icons.email className="size-4" />;
    default:
      return <Icons.globe className="size-4" />;
  }
}

export default function ContactSection({ contact, resumeUrl, resumeFields }: ContactSectionProps) {
  const isDynamic = contact !== undefined;

  // Build the list of all available social/contact channels
  const socialList = isDynamic
    ? Object.values(contact?.social || {}).filter((s) => Boolean(s.url))
    : Object.entries(DATA.contact.social).map(([name, s]) => ({
        name,
        url: s.url,
        iconName: (name.toLowerCase() as any),
        navbar: s.navbar,
      }));

  return (
    <div className="border rounded-xl p-10 relative">
      <div className="absolute -top-4 border bg-primary z-10 rounded-xl px-4 py-1 left-1/2 -translate-x-1/2">
        <span className="text-background text-sm font-medium">Contact</span>
      </div>
      <div className="absolute inset-0 top-0 left-0 right-0 h-1/2 rounded-xl overflow-hidden">
        <FlickeringGrid
          className="h-full w-full"
          squareSize={2}
          gridGap={2}
          style={{
            maskImage: "linear-gradient(to bottom, black, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />
      </div>
      <div className="relative flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
          Get in Touch
        </h2>
        <p className="mx-auto max-w-lg text-muted-foreground text-balance">
          {socialList.length > 0 ? (
            <>
              Want to connect? Feel free to reach out via{" "}
              {socialList.slice(0, 3).map((s, idx, arr) => (
                <span key={s.name + s.url}>
                  <Link
                    href={s.url}
                    target={s.url.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline underline-offset-4 font-medium"
                  >
                    {s.name}
                  </Link>
                  {idx < arr.length - 2 ? ", " : idx === arr.length - 2 ? " or " : " "}
                </span>
              ))}
              and I&apos;ll respond whenever possible.
            </>
          ) : (
            <>
              Want to connect? Feel free to explore my public projects above or connect on OneVue.
            </>
          )}
        </p>

        {resumeUrl && (
          <a
            href={resumeUrl}
            data-ov-track="download"
            data-ov-action="resume"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border border-border bg-card/60 hover:bg-muted text-foreground"
          >
            Resume
          </a>
        )}

        <CustomFieldList fields={resumeFields} />
        <CustomFieldList fields={contact?.customFields} />

        {socialList.length > 0 && (
          <div className="flex flex-col items-center gap-3 mt-2 w-full">
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {socialList.map((social) => {
                const isExternal = social.url.startsWith("http");
                return (
                  <a
                    key={`btn-${social.name}-${social.url}`}
                    href={social.url}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border border-border bg-card/60 hover:bg-muted text-foreground transition-all duration-200 hover:scale-105 shadow-sm"
                  >
                    {renderContactIcon(social.iconName)}
                    <span>{social.name}</span>
                  </a>
                );
              })}
            </div>
            {socialList.map((social) => (
              <CustomFieldList key={`fields-${social.name}-${social.url}`} fields={"customFields" in social ? social.customFields : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
