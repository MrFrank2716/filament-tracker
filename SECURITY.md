# Security

Thank you for helping keep Wrkbench and the workshops that use it safe.

## Reporting a problem

**Please do not report security problems in a public issue.**

Report them privately through GitHub instead:

1. Go to the repository's [**Security** tab](https://github.com/hussxin5046/filament-tracker/security).
2. Press **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what someone could do with it.

Only the maintainers can see the report. You will get a reply as soon as possible, and you will be kept informed while it is fixed. Once a fix is released, you will be credited unless you would rather not be.

## What counts

Anything that lets someone do or see what they should not, for example:

- reading or changing another workspace's data, or acting above your role;
- getting into an account without its password;
- abusing the public job request or progress pages;
- the printer bridge sending a printer anything other than a status request, or connecting outside a private network.

## Supported versions

Wrkbench does not have numbered releases yet. Fixes go into the `main` branch, so please check that a problem still happens there before reporting it.

If you run your own copy, keep it up to date with `main`, set your own long random `JWT_SECRET`, and serve it over HTTPS. See [Self-hosting](docs/wiki/Self-hosting.md).
