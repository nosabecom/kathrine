# Security maintenance

Use Node.js 24.22.1 or a newer patched 24.x release and the pinned pnpm version.
Run `pnpm audit` for the complete dependency report. CI checks all severities,
with the following explicit exceptions because no patched npm release exists
as of 2026-10-22. Exceptions are not declarations that the packages are safe.

- **GHSA-vfj7-8cjw-p6xm / braces <=3.0.3:** recursive brace patterns can exhaust
  the stack. This is a build-tool dependency. Do not process untrusted glob
  patterns. Remove the CI exception once an upstream fixed release is available.
  https://github.com/micromatch/braces/issues/70

- **GHSA-86w9-cpqp-85rv / node-forge <=1.4.0:** RSA signature validation issue
  in the Expo CLI dependency graph. This package is absent from the deployed
  server dependency graph. Do not use Expo CLI to verify untrusted certificates
  or signatures. Remove the CI exception when an upstream fixed release exists.
  https://github.com/digitalbazaar/forge/pull/1152

Production is private to the tailnet, binds to loopback, and uses HTTPS cookies.
Keep server environment files and the database private. Never commit media,
credentials, signing keys, or deployment environment files.
