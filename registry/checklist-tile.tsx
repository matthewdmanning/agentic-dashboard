import { useId } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { schemas } from "./schemas.generated";
import type { JsonSchemaToType } from "./schema";

type ChecklistTileProps = JsonSchemaToType<
  (typeof schemas)["checklist-tile"]
>;

// Use this function to render a titled group of independently toggleable checklist items.
export default function ChecklistTile({
  CHECKLIST_TITLE,
  CHECKLIST_ITEMS,
}: ChecklistTileProps) {
  const idPrefix = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{CHECKLIST_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldSet>
          <FieldLegend className="sr-only">{CHECKLIST_TITLE}</FieldLegend>
          <FieldGroup>
            {CHECKLIST_ITEMS.map((item, index) => {
              const id = `${idPrefix}-${index}`;

              return (
                <Field key={id} orientation="horizontal">
                  <Checkbox id={id} defaultChecked={item.CHECKED} />
                  <FieldLabel htmlFor={id}>{item.LABEL}</FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </FieldSet>
      </CardContent>
    </Card>
  );
}
