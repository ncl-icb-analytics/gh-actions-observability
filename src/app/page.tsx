import { ActionsDashboard } from "@/components/actions-dashboard";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { ConvexHttpClient } from "convex/browser";
import type { ActionsHistoryResponse } from "@/lib/types";
import { api } from "../../convex/_generated/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  if (!convexUrl) {
    return (
      <main className="min-h-screen bg-[radial-gradient(1200px_500px_at_20%_0%,#dbeafe_0%,#f8fafc_60%)] px-5 py-6 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
          Missing Convex URL. Set `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`) to enable live updates.
        </div>
      </main>
    );
  }

  let initialData: ActionsHistoryResponse | null = null;
  try {
    const convex = new ConvexHttpClient(convexUrl);
    initialData = (await convex.query(api.history.getHistory, {
      maxRuns: 900,
    })) as ActionsHistoryResponse;
  } catch {
    initialData = null;
  }

  return (
    <ConvexClientProvider url={convexUrl}>
      <ActionsDashboard initialData={initialData} />
    </ConvexClientProvider>
  );
}
