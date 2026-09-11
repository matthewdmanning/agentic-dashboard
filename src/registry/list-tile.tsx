import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { schemas } from "./schemas.generated";
import type { JsonSchemaToType } from "./schema";

type ListTileProps = JsonSchemaToType<(typeof schemas)["list-tile"]>;

export default function ListTile({ LIST_TITLE, LIST_ITEMS }: ListTileProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{LIST_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {LIST_ITEMS.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
