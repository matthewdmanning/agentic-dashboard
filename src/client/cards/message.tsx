import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface MessageCardData {
  message: string;
}

export function MessageCard({ data }: { data: MessageCardData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Message</CardTitle>
      </CardHeader>
      <CardContent>{data.message}</CardContent>
    </Card>
  );
}
