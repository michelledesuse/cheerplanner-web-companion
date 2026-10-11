import React, { ReactNode } from "react";

// Web: the browser SDK autocaptures pageviews/clicks from analytics.init and
// ships no provider component, so this is a passthrough.
export function HeyCatchRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
