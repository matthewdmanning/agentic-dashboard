# Ownership gates permissions, never grants them

**Status:** accepted

A permission decision has two inputs that could each justify a mutation: the level the acting account's role holds on a category, and whether that account owns the thing being changed. Only the level grants. Ownership is applied on top of it and can only narrow — restricting the reach of a level the account already holds, to the entries it owns. No operation is permitted on ownership alone with no level consulted.

An earlier draft had it the other way: adding an entry needed no level at all, and owning an entry was itself the permission to edit or delete it. That reading puts ownership beside the permission scheme rather than inside it, so a path exists to change shared state without any level being checked — and every new mutation type has to remember the exception. Ownership as a gate has no such path, because there is nothing to remember: the level check always runs first.

`write` on `data` reaches entries the account does not own, which is how one account corrects what another entered. That is a level widening its own reach, not ownership being overridden, so it composes with the rule rather than contradicting it.

The trade-off: both default roles hold `write` on `data`, so under the two roles that ship today the narrowing never fires and every account can edit every entry. The gate is built correctly anyway. Defining any role below `write` on `data` activates it with no code change, and the alternative — dropping a default role's level so the rule visibly bites — would have meant that role could no longer add entries at all, since `write` is the level that creates.
