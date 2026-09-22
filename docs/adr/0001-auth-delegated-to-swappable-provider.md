# Auth delegated to a swappable provider

**Status:** accepted

This project does not build authentication. It has no registration, no
password storage, and no account-creation mutation.

An auth provider resolves each caller to an account. The auth provider is the
only place identity risk lives. A real deployment puts a high-security
authentication service behind this boundary.

This project's auth provider is a fixed whitelist file. The file maps each
credential to an account and a role.

**Trade-off:** The whitelist does not do registration, credential rotation, or
revocation. To change an account, edit the file by hand. This is deliberate.
An in-app version would be a worse copy of the service that replaces it. The
permission decision sees only the resolved account, so the replacement changes
nothing downstream.
