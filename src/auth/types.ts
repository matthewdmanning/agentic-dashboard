/** The identity a caller presents, once resolved by the auth provider. */
export type Account = {
  readonly id: string;
  /** Name of the role assigned to this account. Role definitions land in #134. */
  readonly role: string;
};
