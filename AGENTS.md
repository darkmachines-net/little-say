# Repository documentation

Keep documentation close to the code and update it whenever the behavior or public contract changes.

- Do not check in a `docs/` tree, change summaries, implementation plans, audit snapshots, validation reports, or historical screenshot galleries. Keep temporary reports, captures, logs, and generated evidence in ignored `artifacts/` or attach them to the relevant PR. Maintained prompt resources and generated runtime data are product inputs, not documentation reports.
- Put implementation contracts in file/function comments and module-wide usage, architecture, and operational guidance in a `README.md` beside the owning code. Keep the root README as an entry point linking to these modules. Give each fact one canonical home and link to it rather than repeating it across modules. Group related code into cohesive subdirectories where that makes ownership clearer.
- When adding or updating any authored code file, add or update its concise file-level documentation comment to explain its current purpose and responsibility. Include application code, tests, fixtures, build configuration, and development or release scripts. Document what a test file verifies and what a script runs or changes.
- Use a `/** @file ... */` header in TypeScript and JavaScript, including TSX and MJS. Use the language's native comment syntax elsewhere, such as PowerShell comment-based help, YAML/Dockerfile `#` comments, and HTML comments. Preserve required shebangs and format directives.
- When adding or updating any exported/public function, add or update JSDoc immediately above it, including React components, hooks, callable exports, default exports, and public constructors, methods, accessors, and callable properties. Public members of internal classes and module-scope objects (including test adapters) need documentation too; private/protected helpers do not. Document public interface methods and callable properties at their declarations. Re-exports can rely on documentation at the original declaration.
- Explain the function's purpose and any non-obvious contract: meaningful inputs, units, return values, side effects, errors, cancellation, or resource ownership. For components and hooks, describe their role and important state or lifecycle behavior. Document platform-specific behavior in native and web implementations.
- Prefer short, useful prose over comments that merely repeat the function name or TypeScript types. Use `@param`, `@returns`, or `@throws` when they clarify the contract; do not add them mechanically. Preserve useful existing documentation.
- Do not add comments to formats that disallow them, such as JSON manifests and lockfiles. Generated output, vendored code/data, and binary assets are exempt; document their source or generator instead.

Run `npm run lint` to enforce file overviews and public-callable JSDoc using the existing `eslint-plugin-jsdoc` rules in `eslint.config.mjs`; it also runs in `npm run check` and CI. Do not replace these rules with custom documentation-checking scripts or silence them with empty comments. Review documentation accuracy alongside the usual validation; lint checks presence, not correctness. Documentation-only edits should preserve executable behavior.

## Release integration

Use the single protected Release workflow and the pinned toolkit; keep package/workflow SHAs identical with the toolkit pin updater. Consumers own only application metadata, source boundaries and validation. Runtime is the shared mobile major; EAS owns independent platform build counters. Never add consumer lifecycle, recovery or retained-artifact wrappers.

Failed or uncertain prior attempts must not block a fresh release. Preserve consumed reservations and confirmed success baselines, retain same-run duplicate protection, and accept possible redundant delivery after a lost provider acknowledgement.
