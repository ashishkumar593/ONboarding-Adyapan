import type { Metadata } from "next";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./style.css";
import { Header } from "@/components/Header";
export const metadata: Metadata = {
  title: "Adyapan | Onboarding Portal",
  description:
    "Your Adyapan internship onboarding, documents and offer letter.",
  icons: { icon: "/adyapan.png" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
        <footer>
          <span>
            Adyapan <i>/</i> Onboarding Portal
          </span>
          <span>People Operations</span>
        </footer>
      </body>
    </html>
  );
}
