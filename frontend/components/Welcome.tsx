import Image from "next/image";
import {
  BookmarkCheck,
  ChevronDown,
  ClipboardList,
  MailCheck,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import ReadinessChecklist from "./ReadinessChecklist";
import "./welcome.css";

const stages = [
  {
    title: "Open the onboarding portal",
    text: "Use the shared link or QR code from HR.",
    detail:
      "Open the shared onboarding link or scan the QR from HR. Enter the email address on the roster.",
    icon: MailCheck,
  },
  {
    title: "Complete your profile",
    text: "Add your details and upload your documents.",
    detail:
      "Start with your personal details and résumé. Then upload your 10th, intermediate and degree or latest semester marksheets, Aadhaar card, PAN card and signed offer letter.",
    icon: ClipboardList,
  },
  {
    title: "Review & sign",
    text: "Check your application and sign your declaration.",
    detail:
      "You’ll receive a submission reference immediately. Once HR reviews and countersigns your offer, we’ll email you a link to download it.",
    icon: PenLine,
  },
];

export default function Welcome() {
  const applyUrl = "/apply";
  return (
    <main className="welcome shell" id="main-content">
      <section className="welcome-intro" aria-labelledby="welcome-title">
        <div className="welcome-intro-copy">
          <p className="welcome-kicker">Welcome to Adyapan</p>
          <h1 id="welcome-title">
            Your internship
            <br />
            <em>starts here.</em>
          </h1>
          <p className="welcome-lead">
            Use your registered email to set up your profile, submit your
            documents and receive your signed offer letter.
          </p>
          <div className="welcome-actions">
            <a className="button welcome-start" href={applyUrl}>
              Start onboarding
            </a>
            <a className="welcome-guide" href="#journey">
              View the steps <ChevronDown size={16} aria-hidden="true" />
            </a>
          </div>
          <p className="welcome-access">
            <ShieldCheck size={16} aria-hidden="true" /> For registered interns
          </p>
        </div>
        <div className="welcome-photo">
          <Image
            src="/welcome-kit.webp"
            alt="A green Adyapan welcome kit with an internship offer and gold pen."
            width={911}
            height={873}
            sizes="(max-width: 720px) 94vw, (max-width: 1440px) 46vw, 675px"
            preload
          />
        </div>
      </section>
      <div className="welcome-resources">
        <section id="journey" aria-labelledby="journey-heading">
          <h2 id="journey-heading">Your onboarding journey</h2>
          <div className="journey-stages">
            {stages.map((stage, index) => (
              <details key={stage.title} className="journey-stage">
                <summary>
                  <span className="journey-icon">
                    <stage.icon
                      size={21}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="journey-stage-copy">
                    <span className="journey-title">
                      <span className="sr-only">Step </span>
                      {index + 1}. {stage.title}
                    </span>
                    <span className="journey-caption">{stage.text}</span>
                  </span>
                  <ChevronDown
                    className="journey-toggle"
                    size={18}
                    aria-hidden="true"
                  />
                </summary>
                <p>{stage.detail}</p>
              </details>
            ))}
          </div>
        </section>
        <aside className="welcome-prep" aria-label="Onboarding preparation">
          <ReadinessChecklist invitation="onboarding" />
          <div className="resume-note">
            <BookmarkCheck size={21} strokeWidth={1.6} aria-hidden="true" />
            <div>
              <strong>Picking up where you left off?</strong>
              <p>
                Reopen your invitation or scan your QR code to resume on any device.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
