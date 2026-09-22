# Ownership gates permissions, never grants them

**Status:** accepted

A caller gets permission only when every gate passes.

A mutation on `tiles` has one gate: the level the acting account's role holds
on `tiles`. There is no ownership gate. A tile belongs to the dashboard, not
to the account that added it.

A mutation on `data` has two gates:

- the level the account's role holds on `data`
- ownership of the entry

Both gates must pass. A level alone does not grant. Ownership alone does not
grant.

`write` on `data` passes the ownership gate for every entry. This is how one
account corrects what another account entered. The gate still runs. The level
satisfies it.

**Rejected:** An earlier draft let ownership grant on its own. Adding an entry
needed no level, and owning an entry was itself the permission to edit or
delete it. That draft removes the level gate for some operations. It opens a
path to change shared state with no level check. Every new mutation type must
then remember the exception. Two gates that always both run have no such path.

**Trade-off:** Both default roles hold `write` on `data`. Under the roles that
ship today the ownership gate passes for every entry, so it never refuses
anything. The gate is built anyway. Define any role below `write` on `data` to
make it bite, with no code change. The alternative was to lower a default
role's level. That role could then no longer add entries, because `write` is
the level that creates.
