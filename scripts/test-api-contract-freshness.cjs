const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "api-contract-freshness-"),
);
const shimDirectory = path.join(tempRoot, "bin");
const pnpmShim = path.join(shimDirectory, "pnpm");
const callLog = path.join(tempRoot, "pnpm-calls.log");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(cwd, ...args) {
  const result = run("git", ["-C", cwd, ...args]);
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
  );
}

function createFixture(name) {
  const fixture = path.join(tempRoot, name);
  const clientFile = "lib/api-client-react/src/generated/client.ts";
  const schemaFile = "lib/api-zod/src/generated/schema.ts";

  for (const [file, contents] of [
    [clientFile, "export const clientVersion = 1;\n"],
    [schemaFile, "export const schemaVersion = 1;\n"],
  ]) {
    const fullPath = path.join(fixture, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }

  git(fixture, "init", "-q");
  git(fixture, "config", "user.name", "API contract test");
  git(fixture, "config", "user.email", "api-contract-test@example.invalid");
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "fixture baseline");

  return { fixture, clientFile, schemaFile };
}

function runTypecheck(fixture) {
  fs.writeFileSync(callLog, "");
  const result = run("sh", ["-c", rootPackage.scripts.typecheck], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${shimDirectory}${path.delimiter}${process.env.PATH}`,
      API_CONTRACT_SCRIPT: rootPackage.scripts["check:api-contract"],
      PNPM_CALL_LOG: callLog,
    },
  });
  return {
    ...result,
    calls: fs.readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean),
  };
}

function assertFreshnessFailure(name, mutate, expectedPath) {
  const fixture = createFixture(name);
  mutate(fixture);
  const result = runTypecheck(fixture.fixture);
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0, `${name} should fail the root typecheck`);
  assert.ok(
    output.includes(expectedPath),
    `${name} should identify stale output ${expectedPath}:\n${output}`,
  );
  assert.deepEqual(
    result.calls,
    ["run check:api-contract", "--filter @workspace/api-spec run generate"],
    `${name} must stop before library or artifact typechecks`,
  );
}

try {
  fs.mkdirSync(shimDirectory, { recursive: true });
  fs.writeFileSync(
    pnpmShim,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PNPM_CALL_LOG"
if [ "$1" = "run" ] && [ "$2" = "check:api-contract" ]; then
  sh -c "$API_CONTRACT_SCRIPT"
  exit $?
fi
if [ "$1" = "--filter" ] && [ "$2" = "@workspace/api-spec" ] && [ "$3" = "run" ] && [ "$4" = "generate" ]; then
  exit 0
fi
exit 0
`,
  );
  fs.chmodSync(pnpmShim, 0o755);

  assertFreshnessFailure(
    "changed-tracked-output",
    ({ fixture, clientFile }) =>
      fs.writeFileSync(
        path.join(fixture, clientFile),
        "export const clientVersion = 2;\n",
      ),
    "lib/api-client-react/src/generated/client.ts",
  );

  assertFreshnessFailure(
    "changed-tracked-zod-output",
    ({ fixture, schemaFile }) =>
      fs.writeFileSync(
        path.join(fixture, schemaFile),
        "export const schemaVersion = 2;\n",
      ),
    "lib/api-zod/src/generated/schema.ts",
  );

  assertFreshnessFailure(
    "deleted-tracked-output",
    ({ fixture, schemaFile }) => fs.unlinkSync(path.join(fixture, schemaFile)),
    "lib/api-zod/src/generated/schema.ts",
  );

  assertFreshnessFailure(
    "new-untracked-output",
    ({ fixture }) => {
      const file = path.join(
        fixture,
        "lib/api-client-react/src/generated/new-client.ts",
      );
      fs.writeFileSync(file, "export const newClient = true;\n");
    },
    "lib/api-client-react/src/generated/new-client.ts",
  );

  assertFreshnessFailure(
    "new-untracked-zod-output",
    ({ fixture }) => {
      const file = path.join(
        fixture,
        "lib/api-zod/src/generated/types/newSchema.ts",
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "export const newSchema = true;\n");
    },
    "lib/api-zod/src/generated/types/newSchema.ts",
  );

  const cleanFixture = createFixture("clean-output");
  const cleanResult = runTypecheck(cleanFixture.fixture);
  assert.equal(
    cleanResult.status,
    0,
    `clean output should pass the root typecheck:\n${cleanResult.stdout}${cleanResult.stderr}`,
  );
  assert.deepEqual(cleanResult.calls, [
    "run check:api-contract",
    "--filter @workspace/api-spec run generate",
    "run typecheck:libs",
    "-r --filter ./artifacts/** --filter ./scripts --if-present run typecheck",
  ]);

  console.log(
    "API contract freshness regression checks passed (changed, deleted, untracked, and clean client/Zod output).",
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
