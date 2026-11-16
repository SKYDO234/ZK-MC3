import React from "react";
import { statusTone } from "../lib/format";
import clsx from "clsx";

export const StatusPill: React.FC<{ status: string; className?: string; showLabel?: boolean }> = ({
  status,
  className,
  showLabel = true,
}) => {
  const tone = statusTone(status);
  const key = tone.badge.replace("zk-badge-", "");
  return (
    <span className={clsx("zk-badge", tone.badge, className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot, status === "online" && "animate-pulse")} />
      {showLabel && tone.label}
    </span>
  );
};
