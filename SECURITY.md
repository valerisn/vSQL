# Security Policy

## Supported versions

vSQL is under active development. Security fixes land on the latest release on the `main` branch, so please update to the latest version before reporting an issue - your bug may already be fixed.

| Version | Supported |
|---|---|
| Latest `main` | Yes |
| Older releases | No |

## Reporting a vulnerability

> [!CAUTION]
> Please do **not** report security vulnerabilities through public GitHub issues, pull requests, or discussions.

Report privately using GitHub's built in vulnerability reporting:

1. Go to the [Security tab](https://github.com/valerisn/vSQL/security) of the repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form with as much detail as you can.

If that flow isn't available to you, open a regular issue with **no technical details** - just ask a maintainer to reach out about a security matter, and we'll set up a private channel.

### What to include

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version or commit.
- Any suggested fix or mitigation, if you have one.

### What to expect

- We'll acknowledge your report as soon as we can.
- We'll investigate, confirm the issue, and keep you posted as it progresses.
- Once a fix ships, we're glad to credit you in the advisory - unless you'd rather stay anonymous.

## Scope and good practices

vSQL binds every query value through a parameter, so untrusted input passed as a parameter can't be used for SQL injection. That protection covers **values only**. Concatenating untrusted input straight into the query string sidesteps it entirely.

> [!WARNING]
> Never interpolate user supplied data directly into a SQL string. Always pass it through `?`, `@name`, or `:name` parameters.
