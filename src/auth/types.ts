/** The identity a caller presents, once resolved by the auth provider. */
export type Account = {
  readonly id: string;
  /** Name of the role assigned to this account. Role definitions live in `./permissions`. */
  readonly role: string;
};
