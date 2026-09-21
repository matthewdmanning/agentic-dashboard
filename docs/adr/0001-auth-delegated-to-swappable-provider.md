# Auth delegated to a swappable provider, mocked as a fixed whitelist

**Status:** accepted

Authentication is not built as an in-app feature (no registration, no password storage, no account-creation mutation). Instead, every caller is resolved to an account through an auth-provider boundary — the one place identity risk lives — which a real deployment would back with a proper high-security authentication service. This project's own implementation is a fixed whitelist file mapping a credential to an account and its role, standing in for that service.

The trade-off: nothing here handles registration, credential rotation, or revocation beyond hand-editing the whitelist file. That is deliberate — building any of that would be building a worse version of the service this is meant to be swapped for later, and the permission decision downstream never needs to know the difference.
