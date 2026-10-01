"use client";

type Cell = string | number | null | undefined;

function toCsv(rows: Cell[][]) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const v = c == null ? "" : String(c);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\r\n");
}

// Excel opens UTF-8 CSV with a BOM directly, keeping ₹ and other symbols intact.
export function ExportButton({ filename, rows, label = "Export to Excel" }: { filename: string; rows: Cell[][]; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="inline-flex items-center gap-1 rounded-sm border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
    >
      <span aria-hidden>⇩</span> {label}
    </button>
  );
}
