"use client";

import { useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

export function ConvexClientProvider({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  const client = useMemo(() => new ConvexReactClient(url), [url]);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
