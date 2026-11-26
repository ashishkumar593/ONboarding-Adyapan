"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { decodeFile, request } from "./client";

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
