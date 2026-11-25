export function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request(action: string, data?: FormData, signal?: AbortSignal) {
  const res = await fetch(
    "/api/" + action,
    data ? { method: "POST", body: data, signal } : { cache: "no-store", signal },
  );
  const result = await res.json();
  if (!res.ok)
    throw new RequestError(
      result.error || "Request failed. Please retry.",
      res.status,
    );
  return result;
}
export const decodeFile = (content: string) => Uint8Array.from(atob(content), c => c.charCodeAt(0));
export const fileUrl = (id: string, hr = false, download = false) =>
  "/api/file?id=" + id + (hr ? "&hr=1" : "") + (download ? "&download=1" : "");
export function sendFile(data: FormData, progress: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) resolve();
      else {
        let message = "Upload failed. Please retry.";
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {}
        reject(new Error(message));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Connection interrupted. Please retry."));
    xhr.send(data);
  });
}
