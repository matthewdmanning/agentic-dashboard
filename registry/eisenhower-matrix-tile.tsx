import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { schemas } from "./schemas.generated";
import type { JsonSchemaToType } from "./schema";

type EisenhowerMatrixTileProps = JsonSchemaToType<
  (typeof schemas)["eisenhower-matrix-tile"]
>;

const QUADRANTS = [
  {
    key: "DO_FIRST",
    title: "Do first",
    description: "Urgent and important",
  },
  {
    key: "SCHEDULE",
    title: "Schedule",
    description: "Important, not urgent",
  },
  {
    key: "DELEGATE",
    title: "Delegate",
    description: "Urgent, not important",
  },
  {
    key: "ELIMINATE",
    title: "Eliminate",
    description: "Neither urgent nor important",
  },
] as const;

// Use this function to display tasks across the four standard Eisenhower matrix quadrants.
export default function EisenhowerMatrixTile({
  MATRIX_TITLE,
  MATRIX_ITEMS,
}: EisenhowerMatrixTileProps) {
  const items = {
    DO_FIRST: MATRIX_ITEMS.filter(
      ({ urgency, importance }) =>
        urgency === "High" && importance === "High",
    ),
    SCHEDULE: MATRIX_ITEMS.filter(
      ({ urgency, importance }) =>
        urgency === "Low" && importance === "High",
    ),
    DELEGATE: MATRIX_ITEMS.filter(
      ({ urgency, importance }) =>
        urgency === "High" && importance === "Low",
    ),
    ELIMINATE: MATRIX_ITEMS.filter(
      ({ urgency, importance }) => urgency === "Low" && importance === "Low",
    ),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{MATRIX_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {QUADRANTS.map((quadrant) => (
            <section
              key={quadrant.key}
              className="rounded-lg border bg-muted/20 p-4"
            >
              <h3 className="text-sm font-medium">{quadrant.title}</h3>
              <p className="text-sm text-muted-foreground">
                {quadrant.description}
              </p>
              {items[quadrant.key].length > 0 ? (
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {items[quadrant.key].map((item, index) => (
                    <li key={`${quadrant.key}-${index}`}>{item.task}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No items
                </p>
              )}
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
