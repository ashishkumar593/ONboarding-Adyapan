"use client";
import { useRef, useState, type PointerEvent } from "react";
import type { Stroke } from "@shared/signature";

export default function SignatureField() {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const active = useRef<number | null>(null);
  function point(e: PointerEvent<SVGSVGElement>): [number, number] {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      Math.round(
        1000 * Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      ),
      Math.round(
        300 * Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
      ),
    ];
  }
  return (
    <fieldset className="signature-field">
      <legend>Signature method</legend>
      <div className="signature-options">
        <label className="check">
          <input
            type="radio"
            name="signatureMode"
            value="draw"
            checked={mode === "draw"}
            onChange={() => setMode("draw")}
          />
          Draw signature
        </label>
        <label className="check">
          <input
            type="radio"
            name="signatureMode"
            value="type"
            checked={mode === "type"}
            onChange={() => setMode("type")}
          />
          Type signature
        </label>
      </div>
      {mode === "type" ? (
        <label>
          Signature · full name
          <input
            name="signature"
            required
            minLength={2}
            maxLength={160}
            autoComplete="name"
          />
        </label>
      ) : (
        <>
          <p>Sign below with your finger, mouse or pen.</p>
          <svg
            className="signature-pad"
            viewBox="0 0 1000 300"
            preserveAspectRatio="none"
            role="img"
            aria-label="Signature drawing area"
            onPointerDown={(e) => {
              if (active.current !== null || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              active.current = e.pointerId;
              const p = point(e);
              setStrokes((prev) => [...prev, [p]]);
            }}
            onPointerMove={(e) => {
              if (active.current !== e.pointerId) return;
              const p = point(e);
              setStrokes((prev) => {
                const last = prev.at(-1);
                if (!last) return prev;
                const tail = last[last.length - 1];
                return tail[0] === p[0] && tail[1] === p[1]
                  ? prev
                  : [...prev.slice(0, -1), [...last, p]];
              });
            }}
            onLostPointerCapture={() => {
              active.current = null;
            }}
          >
            {strokes.map((s, i) => (
              <polyline
                key={i}
                points={s.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          <input type="hidden" name="drawing" value={JSON.stringify(strokes)} />
          <button
            className="textbtn"
            type="button"
            onClick={() => setStrokes([])}
            disabled={!strokes.length}
          >
            Clear signature
          </button>
        </>
      )}
    </fieldset>
  );
}
