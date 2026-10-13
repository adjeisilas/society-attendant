"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./button";
import { StatusPanel } from "./status-panel";
import styles from "./error-state.module.css";

interface ErrorStateProps {
  error: Error & { digest?: string };
  retry: () => void;
  fullPage?: boolean;
}

export function ErrorState({ error, retry, fullPage }: ErrorStateProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPanel
      tone="danger"
      icon={<TriangleAlert size={22} />}
      title="Something went wrong"
      description="This page could not be loaded. Try again, and contact your system administrator if the problem continues."
      fullPage={fullPage}
    >
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
      {error.digest && (
        <p className={styles.reference}>
          Reference: <code>{error.digest}</code>
        </p>
      )}
    </StatusPanel>
  );
}
