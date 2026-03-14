const LARGE_UNITS = [
  { value: 1e18, label: "Quintillion" },
  { value: 1e15, label: "Quadrillion" },
  { value: 1e12, label: "Trillion" },
  { value: 1e9, label: "Billion" },
  { value: 1e6, label: "Million" },
] as const;

export function formatTokenAmount(value: string | number, maximumFractionDigits = 3) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  const abs = Math.abs(numeric);
  const unit = LARGE_UNITS.find((candidate) => abs >= candidate.value);
  if (unit) {
    return `${(numeric / unit.value).toLocaleString("en-US", { maximumFractionDigits })} ${
      unit.label
    }`;
  }

  return numeric.toLocaleString("en-US", { maximumFractionDigits });
}
