"use client";

import { Printer } from "lucide-react";
import { Button } from "./button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer size={16} aria-hidden="true" />
      {label}
    </Button>
  );
}
