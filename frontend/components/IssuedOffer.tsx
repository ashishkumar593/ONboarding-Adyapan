"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { decodeFile, form, request } from "./client";

type PdfFile = { blob: Blob; name: string };

function OfferPreview({ file, hr = false }: { file: PdfFile; hr?: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const preview = URL.createObjectURL(file.blob);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  if (!url) return <p role="status">Opening the PDF…</p>;
  return <>
    <iframe className="stamped-preview" title="Stamped offer letter preview" src={url} />
    <a className={hr ? "filelink" : "button"} href={url} download={file.name}>
      <Download size={17} /> Download stamped offer letter
    </a>
  </>;
}

export function StatusOffer() {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section aria-labelledby="status-offer-heading">
    <h2 id="status-offer-heading">Stamped offer letter</h2>
    {file ? <OfferPreview file={file} /> : <form onSubmit={async event => {
      event.preventDefault();
      const reference = String(new FormData(event.currentTarget).get("reference") || "").trim().toUpperCase();
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/stamped-offer", { method: "POST", body: form({ reference }), cache: "no-store" });
        if (!response.ok) throw Error((await response.json()).error);
        setFile({ blob: new Blob([await response.arrayBuffer()], { type: "application/pdf" }), name: reference + "-signed-offer.pdf" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The letter could not be opened. Please try again.");
      } finally {
        setBusy(false);
      }
    }}>
      <label>Submission reference
        <input name="reference" required maxLength={32} spellCheck={false} aria-describedby="offer-reference-help" />
      </label>
      <small id="offer-reference-help">Use the reference on your submission receipt. HR can help if you no longer have it.</small>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Opening…" : "View stamped offer letter"}</button>
    </form>}
  </section>;
}

export default function IssuedOffer({ id, hr = false }: { id: string; hr?: boolean }) {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError("");
    request("file?id=" + encodeURIComponent(id) + "&format=json" + (hr ? "&hr=1" : ""), undefined, controller.signal)
      .then(({ name, content }) => {
        if (controller.signal.aborted) return;
        setFile({ blob: new Blob([decodeFile(content)], { type: "application/pdf" }), name });
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => {
      controller.abort();
    };
  }, [id, attempt, hr]);
  if (error) return (
    <>
      <p role="alert" className="error">{error}</p>
      <button className="secondary" onClick={() => setAttempt(n => n + 1)}>Retry download</button>
    </>
  );
  if (!file) return <p role="status">Loading signed offer letter…</p>;
  return <OfferPreview file={file} hr={hr} />;
}
