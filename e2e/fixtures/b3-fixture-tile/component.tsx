import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { schemas } from "./schemas.generated";
import type { JsonSchemaToType } from "./schema";

type B3FixtureTileProps = JsonSchemaToType<(typeof schemas)["b3-fixture-tile"]>;

export default function B3FixtureTile({ MESSAGE }: B3FixtureTileProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>B3 Fixture</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{MESSAGE}</p>
      </CardContent>
    </Card>
  );
}
