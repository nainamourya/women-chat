import type { ReactNode } from "react";

type AlertVariant = "success" | "warning" | "danger" | "info";

const variantClasses: Record<AlertVariant, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

export function Alert({
  variant = "info",
  children,
}: {
  variant?: AlertVariant;
  children: ReactNode;
}) {
  return (
    <p
      role={variant === "danger" ? "alert" : "status"}
      className={`rounded-md px-3 py-2.5 text-sm ${variantClasses[variant]}`}
    >
      {children}
    </p>
  );
}
