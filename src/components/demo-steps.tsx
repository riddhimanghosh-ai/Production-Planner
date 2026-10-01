"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setViewer } from "@/app/actions";
import { buttonClass, cx, tbl } from "./ui";

export type DemoStep = { n: string; who: string; viewer: string; where: string; href: string; show: string; point: string };

// Each step switches "Viewing as" to the right person and opens the right screen in one click.
export function DemoSteps({ steps }: { steps: DemoStep[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (s: DemoStep) =>
    start(async () => {
      await setViewer(s.viewer);
      router.push(s.href);
    });

  return (
    <div className={tbl.wrap}>
      <table className={cx(tbl.table, "min-w-[900px]")}>
        <thead>
          <tr>
            <th className={tbl.th}>#</th>
            <th className={tbl.th}>View as</th>
            <th className={tbl.th}>Screen</th>
            <th className={tbl.th}>What to show</th>
            <th className={tbl.th}>The point</th>
            <th className={tbl.th} />
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.n} className={cx(tbl.tr, "align-top")}>
              <td className={cx(tbl.td, "font-mono text-[11px] text-stone-500")}>{s.n}</td>
              <td className={cx(tbl.td, "whitespace-nowrap font-semibold text-stone-900")}>{s.who}</td>
              <td className={cx(tbl.td, "whitespace-nowrap text-stone-700")}>{s.where}</td>
              <td className={tbl.td}>{s.show}</td>
              <td className={cx(tbl.td, "text-stone-600")}>{s.point}</td>
              <td className={cx(tbl.td, "text-right")}>
                <button type="button" disabled={pending} onClick={() => go(s)} className={buttonClass("primary", "sm")}>
                  Go
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
