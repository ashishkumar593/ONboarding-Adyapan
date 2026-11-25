"use client";
import { useEffect, useState } from "react";
import { Check, ListChecks } from "lucide-react";

const items = [
  "Access to your invited email",
  "Your signed offer letter (PDF)",
  "Supporting documents on your invitation",
];

export default function ReadinessChecklist({
  invitation,
}: {
  invitation: string;
}) {
  const [checked, setChecked] = useState<number[]>([]);
  const key = "adyapan:preparation:" + invitation;
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) || "[]");
      if (Array.isArray(saved))
        setChecked(items.map((_, i) => i).filter((i) => saved.includes(i)));
    } catch {
      /* The checklist also works when browser storage is unavailable. */
    }
  }, [key]);
  function toggle(index: number) {
    const next = checked.includes(index)
      ? checked.filter((i) => i !== index)
      : [...checked, index];
    setChecked(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep this tab’s in-memory state. */
    }
  }
  return (
    <div className="prep-card">
      <div className="prep-heading">
        <ListChecks size={23} strokeWidth={1.7} aria-hidden="true" />
        <span role="status">
          {checked.length} of {items.length} ready
        </span>
      </div>
      <h2>Before you begin</h2>
      <fieldset>
        <legend className="sr-only">Mark the items you have ready</legend>
        {items.map((item, index) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={checked.includes(index)}
              onChange={() => toggle(index)}
            />
            <span className="prep-check" aria-hidden="true">
              <Check size={14} />
            </span>
            {item}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
