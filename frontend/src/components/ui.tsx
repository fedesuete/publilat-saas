import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { Stage } from "../lib/types";

const STAGE_STYLES: Record<Stage, string> = {
  NUEVO: "bg-slate-600 text-slate-100",
  CONTACTADO: "bg-sky-700 text-sky-100",
  INTERESADO: "bg-amber-600 text-amber-50",
  COMPRO: "bg-wa-green text-slate-900",
  PERDIDO: "bg-rose-800 text-rose-100",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STAGE_STYLES[stage] ?? "bg-slate-600"}`}
    >
      {stage}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BTN_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-wa-green text-slate-900 hover:bg-emerald-400",
  secondary: "bg-slate-700 text-slate-100 hover:bg-slate-600",
  danger: "bg-rose-700 text-rose-50 hover:bg-rose-600",
  ghost: "bg-transparent text-slate-300 hover:text-white hover:bg-slate-700",
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className = "", ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${BTN_STYLES[variant]} ${className}`}
    />
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-wa-green ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-800 bg-slate-800/60 p-4 ${className}`}>
      {children}
    </div>
  );
}

export function ErrorMsg({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-md border border-rose-800 bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
      {children}
    </div>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-wa-green" : "bg-amber-500"}`}
      title={ok ? "Conectado" : "Inactivo"}
    />
  );
}
