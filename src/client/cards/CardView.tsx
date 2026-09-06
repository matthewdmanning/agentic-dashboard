import type { CardTemplateName } from "../../contract";
import { includedCardTemplates } from "./index";

/**
 * Renders a card's state with the component its card template names. The
 * template name binds schema and component together, so neither half can be
 * paired with the other's data.
 *
 * The read path parses a partial configuration, which does not run the card
 * state check `parseDashboardConfiguration` does, so state is validated here.
 * One card that does not fit its template says so where it sits rather than
 * taking the dashboard down with it.
 *
 * A template the dashboard does not have is reported the same way.
 */
export function CardView({
  template,
  state,
}: {
  template: CardTemplateName;
  state: unknown;
}) {
  const cardTemplate = includedCardTemplates[template];
  if (!cardTemplate) {
    return <p role="alert">This dashboard has no card template '{template}'.</p>;
  }

  const { schema, Component } = cardTemplate;
  const data = schema.safeParse(state);

  return data.success ? (
    <Component data={data.data} />
  ) : (
    <p role="alert">This card's data does not fit its card template.</p>
  );
}
