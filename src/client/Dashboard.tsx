import { useEffect, useState } from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  Dashboard as DashboardData,
  TileReference,
} from "@/dashboard/types";
import type { Registry } from "./registry";
import { ThemeToggle } from "./ThemeToggle";
import { TileHost } from "./TileHost";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly dashboard: DashboardData;
      readonly registry: Registry;
    };

// Shared by the header and the content so the page's title and the first
// tile's left edge always land on the same horizontal line.
const PAGE_CONTAINER = "mx-auto w-full max-w-6xl px-6";

export function Dashboard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetch("/api/dashboard"), fetch("/r/registry.json")])
      .then(async ([dashboardRes, registryRes]) => {
        if (!dashboardRes.ok)
          throw new Error(`GET /api/dashboard failed: ${dashboardRes.status}`);
        if (!registryRes.ok)
          throw new Error(`GET /r/registry.json failed: ${registryRes.status}`);
        const dashboard = (await dashboardRes.json()) as DashboardData;
        const registry = (await registryRes.json()) as Registry;
        if (!cancelled) setState({ status: "ready", dashboard, registry });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header
        className={cn(
          PAGE_CONTAINER,
          "flex items-start justify-between gap-4 py-6",
        )}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Personal Dashboard</h1>
          {state.status === "loading" && <Skeleton className="h-4 w-24" />}
          {state.status === "ready" && (
            <p className="text-sm text-muted-foreground">
              {tileCountLabel(state.dashboard.references.length)}
            </p>
          )}
        </div>
        <ThemeToggle />
      </header>
      <Separator />
      <main className={cn(PAGE_CONTAINER, "flex-1 py-8")}>
        <DashboardContent state={state} />
      </main>
    </div>
  );
}

function tileCountLabel(count: number): string {
  return `${count} ${count === 1 ? "tile" : "tiles"}`;
}

type DashboardContentProps = {
  readonly state: LoadState;
};

function DashboardContent({ state }: DashboardContentProps) {
  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Skeleton className="h-32 md:col-span-2" />
        <Skeleton className="h-32 md:col-span-2" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load dashboard</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const { dashboard, registry } = state;

  if (dashboard.references.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No tiles yet</EmptyTitle>
          <EmptyDescription>
            Ask an agent to add a tile to get started.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {dashboard.references.map((reference, index) => (
        <TileCell
          key={`${reference.tileId}-${index}`}
          reference={reference}
          dashboard={dashboard}
          registry={registry}
        />
      ))}
    </div>
  );
}

// sm/md/lg map onto a 4-column grid; md prefix keeps mobile a single column.
const SPAN_BY_SIZE: Record<TileReference["size"], string> = {
  sm: "md:col-span-1",
  md: "md:col-span-2",
  lg: "md:col-span-4",
};

type TileCellProps = {
  readonly reference: TileReference;
  readonly dashboard: DashboardData;
  readonly registry: Registry;
};

function TileCell({ reference, dashboard, registry }: TileCellProps) {
  const tile = dashboard.tiles.find(
    (candidate) => candidate.id === reference.tileId,
  );

  return (
    <div
      data-tile-id={reference.tileId}
      data-tile-size={reference.size}
      className={SPAN_BY_SIZE[reference.size]}
    >
      {tile ? (
        <TileHost tile={tile} items={registry.items} />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Missing tile: {reference.tileId}</AlertTitle>
          <AlertDescription>
            The dashboard references a tile that is not in the pool.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
