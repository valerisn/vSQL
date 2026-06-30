# Security Policy

## Supported versions

vSQL is under active development. Security fixes are applied to the latest release on the `main` branch. Please make sure you are running the latest version before reporting an issue.

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

If you cannot use that flow, open a regular issue that contains **no technical details**, just asking a maintainer to get in touch about a security matter, and we will arrange a private channel.

### What to include

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version or commit.
- Any suggested fix or mitigation, if you have one.

### What to expect

- We will acknowledge your report as soon as we can.
- We will investigate, confirm the issue, and keep you updated on progress.
- Once a fix is released, we are happy to credit you in the advisory unless you prefer to stay anonymous.

## Scope and good practices

vSQL binds every query value through parameters, so untrusted input passed via the parameter argument is not vulnerable to SQL injection. Note that this protection only applies to **values**. Building SQL by concatenating untrusted input into the query string itself bypasses it.

> [!WARNING]
> Never interpolate user supplied data directly into a SQL string. Always pass it through `?`, `@name`, or `:name` parameters.
