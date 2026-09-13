import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { schemas } from "./schemas.generated";
import type { JsonSchemaToType } from "./schema";

type StatTileProps = JsonSchemaToType<(typeof schemas)["stat-tile"]>;

export default function StatTile({ LABEL, VALUE }: StatTileProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground">{LABEL}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{VALUE}</p>
      </CardContent>
    </Card>
  );
}
