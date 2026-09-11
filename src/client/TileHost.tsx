import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { z } from "zod";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tile } from "@/dashboard/types";
import type { RegistryItem } from "./registry";

// Lazy glob, not a hand-written map: a tile added on disk while the server
// runs must resolve here after a reload with no client rebuild (B3).
const registryModules = import.meta.glob("/src/registry/*.tsx");

// One lazy component per item name, reused across renders so a re-render of
// the dashboard doesn't re-trigger the dynamic import.
const lazyComponents = new Map<
  string,
  ComponentType<Record<string, unknown>>
>();

function resolveComponent(
  itemName: string,
): ComponentType<Record<string, unknown>> | null {
  const modulePath = `/src/registry/${itemName}.tsx`;
  const loadModule = registryModules[modulePath];
  if (!loadModule) return null;

  const cached = lazyComponents.get(modulePath);
  if (cached) return cached;

  const component = lazy(
    loadModule as () => Promise<{
      default: ComponentType<Record<string, unknown>>;
    }>,
  );
  lazyComponents.set(modulePath, component);
  return component;
}

type TileHostProps = {
  readonly tile: Tile;
  readonly items: readonly RegistryItem[];
};

export function TileHost({ tile, items }: TileHostProps) {
  const item = items.find((candidate) => candidate.name === tile.item);
  if (!item) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unknown item: {tile.item}</AlertTitle>
        <AlertDescription>
          Tile "{tile.title}" names a registry item that does not exist.
        </AlertDescription>
      </Alert>
    );
  }

  const result = z.fromJSONSchema(item.meta.schema).safeParse(tile.state);
  if (!result.success) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Invalid state for {item.name}</AlertTitle>
        <AlertDescription>{result.error.message}</AlertDescription>
      </Alert>
    );
  }

  const LazyTile = resolveComponent(item.name);
  if (!LazyTile) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Missing component for {item.name}</AlertTitle>
        <AlertDescription>
          No file at src/registry/{item.name}.tsx.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TileErrorBoundary itemName={item.name}>
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <LazyTile {...(result.data as Record<string, unknown>)} />
      </Suspense>
    </TileErrorBoundary>
  );
}

type TileErrorBoundaryProps = {
  readonly itemName: string;
  readonly children: ReactNode;
};

type TileErrorBoundaryState = {
  readonly error: Error | null;
};

// Contains a throwing tile component so one bad tile never blanks the whole dashboard.
class TileErrorBoundary extends Component<
  TileErrorBoundaryProps,
  TileErrorBoundaryState
> {
  state: TileErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): TileErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Tile "${this.props.itemName}" failed to render`,
      error,
      info,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>{this.props.itemName} crashed</AlertTitle>
          <AlertDescription>{this.state.error.message}</AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}
