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
                path === "/" || path === "/hr" || path.startsWith("/i/")
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
        <h3>How do I start?</h3>
        <p>Open the shared onboarding link or scan the QR from HR and enter your registered email.</p>
        <h3>Can I finish later?</h3>
        <p>Yes. Reopen the shared link. If your session has expired, check your registered inbox to resume.</p>
        <h3>When is my letter ready?</h3>
        <p>
          People Operations will review your signed offer. You’ll receive an
          email when your countersigned PDF is ready to download.
        </p>
      </dialog>
    </>
  );
}
