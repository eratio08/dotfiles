# Setup new extension

Use Bun as the runtime, not Node.js.
Give every extension a `biome.json` file.
Use this configuration in every extension:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["../biome.json"]
}
```

The `extends` path must be valid an point to the parent biome.json.
Add `"check": "biome check ."` and `"check:fix": "biome check --write ."` to each extension's `scripts`.
Add `@biomejs/biome` to each extension's `devDependencies`.
