export type Stroke = [number, number][];
export function validDrawing(value: unknown): value is Stroke[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    return false;
  let total = 0,
    hasLine = false;
  for (const stroke of value) {
    if (!Array.isArray(stroke) || !stroke.length) return false;
    total += stroke.length;
    if (total > 10000) return false;
    for (const p of stroke) {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isInteger) ||
        p[0] < 0 ||
        p[0] > 1000 ||
        p[1] < 0 ||
        p[1] > 300
      )
        return false;
      if (p[0] !== stroke[0][0] || p[1] !== stroke[0][1]) hasLine = true;
    }
  }
  return hasLine;
}
