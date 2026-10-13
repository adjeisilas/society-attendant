"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revokeTerminal } from "../actions";

export function RevokeTerminalButton({ terminalId, terminalName }: { terminalId: string; terminalName: string }) {
  return (
    <ConfirmDialog
      title={`Switch off ${terminalName}?`}
      description="Staff will no longer be able to clock in or out on this computer. To use it again, register it again."
      confirmLabel="Switch off terminal"
      tone="danger"
      onConfirm={async () => {
        const result = await revokeTerminal(terminalId);
        return result.ok ? null : result.message;
      }}
      renderTrigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open}>
          Switch off
        </Button>
      )}
    />
  );
}
