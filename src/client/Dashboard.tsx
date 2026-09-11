import { useEffect, useState } from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  Dashboard as DashboardData,
  TileReference,
} from "@/dashboard/types";
import type { Registry } from "./registry";
import { TileHost } from "./TileHost";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly dashboard: DashboardData;
      readonly registry: Registry;
    };

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

  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-4">
        <Skeleton className="h-32 md:col-span-2" />
        <Skeleton className="h-32 md:col-span-2" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load dashboard</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { dashboard, registry } = state;

  if (dashboard.references.length === 0) {
    return (
      <div className="p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tiles yet</EmptyTitle>
            <EmptyDescription>
              Ask an agent to add a tile to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-4">
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
