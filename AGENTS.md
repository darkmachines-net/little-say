# Repository documentation

Keep documentation close to the code and update it whenever the behavior or public contract changes.

- Every authored code file needs a concise file-level documentation comment explaining its purpose and responsibility. Include application code, tests, fixtures, build configuration, and development or release scripts. Document what a test file verifies and what a script runs or changes.
- Use a `/** @file ... */` header in TypeScript and JavaScript, including TSX and MJS. Use the language's native comment syntax elsewhere, such as PowerShell comment-based help, YAML/Dockerfile `#` comments, and HTML comments. Preserve required shebangs and format directives.
- Add JSDoc immediately above every exported/public function, including React components, hooks, callable exports, default exports, and public constructors, methods, accessors, and callable properties on exported classes. Document public interface methods at their declarations. Re-exports can rely on documentation at the original declaration.
- Explain the function's purpose and any non-obvious contract: meaningful inputs, units, return values, side effects, errors, cancellation, or resource ownership. For components and hooks, describe their role and important state or lifecycle behavior. Document platform-specific behavior in native and web implementations.
- Prefer short, useful prose over comments that merely repeat the function name or TypeScript types. Use `@param`, `@returns`, or `@throws` when they clarify the contract; do not add them mechanically. Preserve useful existing documentation.
- Do not add comments to formats that disallow them, such as JSON manifests and lockfiles. Generated output, vendored code/data, and binary assets are exempt; document their source or generator instead.

When adding or changing code, check documentation coverage and accuracy along with the usual validation. Documentation-only edits should preserve executable behavior.
