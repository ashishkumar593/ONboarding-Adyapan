"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { decodeFile, request } from "./client";

export default function IssuedOffer({ id, hr = false }: { id: string; hr?: boolean }) {
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setError("");
    request("file?id=" + encodeURIComponent(id) + "&format=json" + (hr ? "&hr=1" : ""), undefined, controller.signal)
      .then(({ name, content }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(new Blob([decodeFile(content)], { type: "application/pdf" }));
        setFile({ url, name });
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, attempt, hr]);
  if (error) return (
    <>
      <p role="alert" className="error">{error}</p>
      <button className="secondary" onClick={() => setAttempt(n => n + 1)}>Retry download</button>
    </>
  );
  if (!file) return <p role="status">Loading signed offer letter…</p>;
  return (
    <>
      {hr && <iframe className="stamped-preview" title="Stamped offer letter preview" src={file.url} />}
      <a className={hr ? "filelink" : "button"} href={file.url} download={file.name}>
        <Download size={17} />
        {hr ? "Download stamped offer letter" : "Download signed offer letter"}
      </a>
    </>
  );
}
