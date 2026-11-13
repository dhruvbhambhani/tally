# Security

Tally handles rent rolls, leases and payment records. Please report problems privately.

## Reporting a problem

Open a private security advisory on GitHub (Security → Advisories → Report a vulnerability). Please don't file a public issue for anything that could expose someone's data.

## How Tally handles data

- **Self-hosted (the intended way to use it).** Everything stays on your machine in one SQLite file plus an uploads folder (`data/` by default). There are no accounts and no telemetry. Anyone who can reach the app can see the data, so run it on your own computer or behind your own login or VPN. Do not expose it to the internet as-is.
- **AI keys.** A key entered in Settings is stored in an httpOnly cookie in that browser. It is not written to the database and is never sent back to the page. It is sent only to the provider you chose. A server-wide key can be set with an environment variable instead.
- **What is sent to an AI provider.** Only when a key is configured: the text of leases, images of ledger pages, the question typed into Ask Tally, and the facts for a letter. Without a key nothing leaves the machine.
- **Links you import** are fetched by the server over https only, from public addresses only, with a size cap and a timeout.
- **Public demo (shared-host mode).** Each browser gets an isolated workspace keyed by a random cookie. It is temporary and is not a substitute for accounts. Don't put real resident data in a public demo.
