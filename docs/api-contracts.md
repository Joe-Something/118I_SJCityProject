# API contract checks

`lib/api-spec/openapi.yaml` is the source of truth for the API contract.

Run the generated API output freshness check with:

```bash
pnpm run check:api-contract
```

Run the regression test for stale generated output and typecheck ordering with:

```bash
pnpm run test:api-contract-freshness
```

The regression test uses isolated Git fixtures to verify that modified, deleted, and newly generated files under `lib/api-zod/src/generated/` fail the contract check. It also verifies a clean generated state passes and that library and artifact typechecks are skipped after a freshness failure. Fixtures are created in a temporary directory, so the checked-in generated files are not changed.

The command regenerates both the React Query client and the server's Zod validation schemas. It fails if generated files differ from the committed versions, including deleted or newly created files, under `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`. The root `pnpm run typecheck` runs this check before artifact typechecks. When changing the OpenAPI spec, include the regenerated files from both directories in the same commit.

To regenerate both outputs and validate library types during development, run:

```bash
pnpm --filter @workspace/api-spec run codegen
```
