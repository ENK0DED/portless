import { ThemeSwitcher } from "@vercel/geistdocs/components/theme-switcher";
import type { GeistdocsNavLink } from "@vercel/geistdocs/config";
import type { ReactNode } from "react";

// Local replacement for `@vercel/geistdocs/footer`, which hardcodes the Vercel
// logo and a directory of Vercel product links. This keeps the theme's footer
// frame (max width, padding, theme switcher at the end of the row) and shows
// the fork's own wordmark and links. The theme switcher renders a fieldset that
// `docs-chat.tsx` measures (`footer fieldset`) to keep its launcher clear of
// the footer, so keep the switcher inside this `footer` element.

const UPSTREAM_URL = "https://github.com/vercel-labs/portless";
const LICENSE_URL = "https://github.com/ENK0DED/portless/blob/main/LICENSE";

const linkClass =
  "w-fit p-0.5 text-gray-900 no-underline outline-none transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 motion-reduce:transition-none";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={linkClass} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function SiteFooter({ logo, nav }: { logo: ReactNode; nav: GeistdocsNavLink[] }) {
  const external = nav.filter((item) => item.external ?? item.href.startsWith("http"));
  return (
    <footer className="mx-auto max-w-[1448px] px-6 pt-10 pb-6 text-sm">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <span className="text-lg text-gray-1000">{logo}</span>
          <p className="m-0 text-gray-900">
            A fork of <FooterLink href={UPSTREAM_URL}>vercel-labs/portless</FooterLink>
          </p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {external.map((item) => (
            <FooterLink key={item.href} href={item.href}>
              {item.label}
            </FooterLink>
          ))}
          <FooterLink href={LICENSE_URL}>License</FooterLink>
        </nav>
      </div>
      <div className="mt-10 flex items-center justify-end">
        <ThemeSwitcher small />
      </div>
    </footer>
  );
}
