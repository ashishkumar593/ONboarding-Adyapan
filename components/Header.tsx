"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, CircleHelp, X } from "lucide-react";
export function Header() {
  const path = usePathname(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.close();
  }, [path]);
  return (
    <>
      <header>
        <div className="header-inner">
          <a href="/" className="brand">
            <i
              className={
                path === "/" || path.startsWith("/i/")
                  ? "brand-mark welcome-mark"
                  : "brand-mark"
              }
            >
              <img src="/adyapan.png" alt="" />
            </i>
            <b>Adyapan</b>
            <span>Onboarding Portal</span>
          </a>
          <nav aria-label="Main navigation">
            <a
              className={"nav-home " + (path != "/hr" ? "active" : "")}
              href="/"
            >
              Onboarding
            </a>
            <button
              className="help"
              onClick={() => dialog.current?.showModal()}
            >
              <CircleHelp size={16} /> Help
            </button>
            <a href="/hr" className="hr-link">
              <BriefcaseBusiness size={16} /> HR workspace
            </a>
          </nav>
        </div>
      </header>
      <dialog
        ref={dialog}
        aria-labelledby="help-title"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="dialog-head">
          <h2 id="help-title">Onboarding help</h2>
          <button
            className="icon"
            aria-label="Close help"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        <h3>Where is my invitation email?</h3>
        <p>
          Look for an invitation from Adyapan in the inbox HR invited. Check
          spam, or ask HR for your invitation QR code.
        </p>
        <h3>Can I finish later?</h3>
        <p>
          Yes. Reopen your invitation or scan your QR code and enter the invited
          email address to resume on another device.
        </p>
        <h3>When is my letter ready?</h3>
        <p>
          People Operations will review your signed offer. You’ll receive an
          email when your countersigned PDF is ready to download.
        </p>
      </dialog>
    </>
  );
}
