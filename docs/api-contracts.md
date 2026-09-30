# API contract checks

`lib/api-spec/openapi.yaml` is the source of truth for the API contract.

Run the generated React client freshness check with:

```bash
pnpm run check:api-contract
```

The command regenerates the client and fails if generated files differ from the committed versions, including newly created files. The root `pnpm run typecheck` runs this check before artifact typechecks. When changing the OpenAPI spec, include the regenerated files under `lib/api-client-react/src/generated/` in the same commit.

To regenerate the client and validate library types during development, run:

```bash
pnpm --filter @workspace/api-spec run codegen
```