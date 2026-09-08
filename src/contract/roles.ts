import type { Role } from "./index";

/**
 * The roles file (D19, D35). Roles are configured by editing this file, which
 * takes the same access as changing any other source — there is no mutation
 * that reaches a role, so `roles: edit` and `roles: write` gate nothing.
 *
 * Deliberately not part of dashboard configuration: `service` rewrites that
 * whole object on every applied batch, so a role living there would be data in
 * a service-written file rather than a source import, and the trust level above
 * would not be real.
 *
 * `admin` and `user` ship as defaults, not as fixed names — add, change, or
 * remove entries here.
 */
export const roles: Role[] = [
  {
    name: "admin",
    permissions: {
      data: "write",
      cards: "write",
      presentation: "write",
      integrations: "write",
      roles: "read",
    },
  },
  {
    name: "user",
    permissions: {
      data: "write",
      cards: "read",
      presentation: "read",
      integrations: "read",
      roles: "noAccess",
    },
  },
];

/**
 * The local user (D35) — the OS account running the server — holds every
 * permission, because it can edit this file, the dashboard data, and the source
 * anyway. A caller proves it is that user by presenting the local-user token;
 * see `src/auth/local-user.ts` for what makes that proof.
 */
export const localUser: Role = {
  name: "localUser",
  permissions: {
    data: "write",
    cards: "write",
    presentation: "write",
    integrations: "write",
    roles: "read",
  },
};

/** What a caller who proves nothing gets: nothing. */
export const unauthenticatedUser: Role = {
  name: "unauthenticatedUser",
  permissions: {
    data: "noAccess",
    cards: "noAccess",
    presentation: "noAccess",
    integrations: "noAccess",
    roles: "noAccess",
  },
};

export function findRole(name: string): Role | undefined {
  return roles.find((role) => role.name === name);
}
