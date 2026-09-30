# Peer Dependencies for Pi Extensions

A peer dependency is a package that the host supplies.
Pi lists five packages that it supplies to extensions and skills:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

Declare the host packages that your extension imports in `peerDependencies` with the `"*"` range.
Use the package names that match the Pi release that you support.

For example, use this manifest when your extension imports `ExtensionAPI` from `@earendil-works/pi-coding-agent` and `Type` from `typebox`:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

Do not put these host packages in `dependencies` or bundle them.
A second copy can bypass Pi's extension module mapping and create duplicate classes or registries.
Pi suppresses automatic peer installation for managed npm packages and for git packages that Pi installs with npm, pnpm, or Bun.
Pi does not install or change local packages, so the package author must provide the local development environment.

Put other runtime packages that the extension imports in `dependencies`.
Keep build, test, and type-checking tools in `devDependencies`.
Other Pi packages outside the five-name list are not host-provided peers.
Include other Pi packages in the published tarball and reference their resources through `node_modules` paths.
