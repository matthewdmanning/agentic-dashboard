/** Placement width. Three values, because "make it wider" has one answer at three. */
export type TileSize = "sm" | "md" | "lg";

/** One placed thing on a dashboard. Carries no placement of its own. */
export type Tile = {
  readonly id: string;
  readonly title: string;
  /** Name of the registry item that renders this tile. */
  readonly item: string;
  readonly state: Record<string, unknown>;
};

/** A dashboard's reference into the tile pool. Order is this array's index. */
export type TileReference = {
  readonly tileId: string;
  readonly size: TileSize;
};

export type Dashboard = {
  readonly tiles: readonly Tile[];
  readonly references: readonly TileReference[];
};

export type Mutation =
  | {
      readonly type: "add-tile";
      readonly tile: Tile;
      readonly size?: TileSize;
      readonly index?: number;
    }
  | { readonly type: "remove-tile"; readonly tileId: string }
  | {
      readonly type: "set-tile-state";
      readonly tileId: string;
      readonly state: Record<string, unknown>;
    }
  | {
      readonly type: "set-tile-title";
      readonly tileId: string;
      readonly title: string;
    }
  | {
      readonly type: "place-tile";
      readonly tileId: string;
      readonly index?: number;
      readonly size?: TileSize;
    };

/** `apply` never leaves a caller to work out which of these happened. */
export type ApplyResult = {
  readonly status: "applied" | "queued";
  readonly dashboard: Dashboard;
};

/** The interface's own name for a failure, so callers never match on message text. */
export type MutationFailure =
  | "unknown-tile"
  | "duplicate-tile"
  | "unknown-item"
  | "invalid-state";

export class MutationError extends Error {
  constructor(
    readonly failure: MutationFailure,
    message: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export const EMPTY_DASHBOARD: Dashboard = { tiles: [], references: [] };
