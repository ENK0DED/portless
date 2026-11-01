"use client";

import { SearchButton } from "@vercel/geistdocs/controls";
import { ThemeSwitcher } from "@vercel/geistdocs/components/theme-switcher";
import type { GeistdocsNavLink } from "@vercel/geistdocs/config";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// Local replacement for `@vercel/geistdocs/navbar`. The theme's navbar only
// accepts the "vercel" or "labs" brand and always renders a Vercel logo, so
// this keeps the same shell (sticky 64px row, scroll shadow, search, mobile
// menu, theme switcher) with the fork's own wordmark. Nav links come from
// `config.nav` in `@/lib/geistdocs/config`.

const linkClass =
  "text-sm text-gray-900 no-underline outline-none transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700";

function isActive(pathname: string, href: string) {
  if (href.startsWith("http")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  pathname,
  className,
  onClick,
}: {
  item: GeistdocsNavLink;
  pathname: string;
  className: string;
  onClick?: () => void;
}) {
  const external = item.external ?? item.href.startsWith("http");
  const active = isActive(pathname, item.href);
  const cls = `${className} ${active ? "text-gray-1000" : ""}`;
  if (external) {
    return (
      <a
        href={item.href}
        className={cls}
        rel="noopener noreferrer"
        target="_blank"
        onClick={onClick}
      >
        {item.label}
        <span aria-hidden="true" className="ml-1">
          &#8599;
        </span>
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className={cls}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {item.label}
    </Link>
  );
}

export function SiteNavbar({ logo, nav }: { logo: ReactNode; nav: GeistdocsNavLink[] }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 flex h-16 justify-center bg-background-200 transition-shadow motion-reduce:transition-none ${
        scrolled ? "shadow-[0_1px_0_0_var(--ds-gray-alpha-400)]" : ""
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1448px] items-center justify-between px-2">
        <div className="ml-4 flex items-center gap-8">
          <Link
            href="/"
            aria-label="portless home"
            className="flex items-center text-gray-1000 text-lg no-underline outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            {logo}
          </Link>
          <nav aria-label="Primary navigation" className="hidden items-center gap-6 lg:flex">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} className={linkClass} />
            ))}
          </nav>
        </div>
        <div className="mr-4 flex items-center gap-2">
          <SearchButton className="hidden w-36 lg:flex" />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="site-navbar-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="relative flex size-8 items-center justify-center rounded-full border border-gray-200 transition-colors hover:bg-gray-100 lg:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="flex flex-col items-center justify-center gap-[5px]">
              <span
                className={`block h-[1.5px] w-3.5 bg-gray-1000 transition-transform duration-150 ${
                  open ? "translate-y-[3.25px] rotate-45" : ""
                }`}
              />
              <span
                className={`block h-[1.5px] w-3.5 bg-gray-1000 transition-transform duration-150 ${
                  open ? "-translate-y-[3.25px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>
      </div>
      <div
        id="site-navbar-menu"
        hidden={!open}
        className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto bg-background-200 px-2 lg:hidden"
      >
        <div className="p-4">
          <SearchButton className="w-full py-4.5" onClick={() => setOpen(false)} />
        </div>
        <nav aria-label="Mobile navigation" className="flex flex-col px-1">
          {nav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-md px-3 text-2xl text-gray-900 no-underline outline-none transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000"
            />
          ))}
        </nav>
        <div className="mt-2 flex justify-end px-4 py-4">
          <ThemeSwitcher small />
        </div>
      </div>
    </header>
  );
}
