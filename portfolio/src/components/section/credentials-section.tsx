import { Badge } from "@/components/ui/badge";
import { AdaptedCredential } from "@/lib/onevue-profile-adapter";
import { Award, ArrowUpRight } from "lucide-react";
import Link from "next/link";

interface CredentialsSectionProps {
  credentials?: AdaptedCredential[];
}

export default function CredentialsSection({ credentials }: CredentialsSectionProps) {
  const credentialList = credentials ?? [];

  if (credentialList.length === 0) {
    return null;
  }

  return (
    <section id="credentials" className="overflow-hidden">
      <div className="flex min-h-0 flex-col gap-y-6">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight">Credentials & Certifications</h2>
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-border/60">
            {credentialList.length}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {credentialList.map((cred, idx) => {
            const primaryHref = cred.verificationUrl || cred.credentialUrl;
            return (
              <div
                key={cred.id || cred.title + idx}
                className="flex flex-col justify-between p-4 rounded-xl border border-border/60 bg-card/60 hover:border-border hover:shadow-md transition-all duration-200"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <Award className="size-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm leading-tight text-foreground">
                          {cred.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">{cred.issuer}</p>
                      </div>
                    </div>
                  </div>

                  {cred.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {cred.description}
                    </p>
                  )}

                  {cred.relatedSkills && cred.relatedSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {cred.relatedSkills.slice(0, 4).map((skill) => (
                        <span
                          key={skill}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-border/40 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {cred.issueDate ? `Issued ${cred.issueDate}` : cred.credentialType}
                  </span>

                  {primaryHref && (
                    <Link
                      href={primaryHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <span>Verify</span>
                      <ArrowUpRight className="size-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
