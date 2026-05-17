import { Data, Effect } from "effect";
import { collectWorkspacePackageManifests } from "./workspace-package-discovery.mjs";

class WorkspaceVerificationPlanError extends Data.TaggedError("WorkspaceVerificationPlanError") {}

const fail = (message, repair, cause) =>
  new WorkspaceVerificationPlanError({ message, repair, cause });

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const packageVerifyLabelOverrides = new Map([
  ["@sunfall/arc-example-devtools-extension", "devtools extension"],
  ["@sunfall/arc-example-devtools-panel", "devtools panel"],
  ["@sunfall/arc-example-docs-site", "docs site"],
  ["@sunfall/arc-example-project-console", "project console"],
  ["@sunfall/arc-starter-basic", "basic starter"],
  ["@sunfall/arc-starter-react", "React starter"],
]);

const defaultVerifyLabel = (packageName) =>
  packageName
    .replace(/^@sunfall\/arc-/, "")
    .replace(/^example-/, "")
    .replace(/^starter-/, "")
    .replace(/-/g, " ");

export const workspaceVerifyLabel = (packageName) =>
  packageVerifyLabelOverrides.get(packageName) ?? defaultVerifyLabel(packageName);

export const verifyPackageTargetsFromManifests = (manifests) =>
  manifests
    .filter((manifest) => isNonEmptyString(manifest.packageJson.scripts?.verify))
    .map((manifest) => ({
      label: workspaceVerifyLabel(manifest.packageJson.name),
      packageName: manifest.packageJson.name,
    }))
    .sort((left, right) => left.packageName.localeCompare(right.packageName));

export const workspaceVerifyPackageTargetsEffect = (workspaceRoot) =>
  workspaceVerificationPlanSelfTestEffect.pipe(
    Effect.flatMap(() => collectWorkspacePackageManifests(workspaceRoot)),
    Effect.map(verifyPackageTargetsFromManifests),
    Effect.flatMap((targets) =>
      targets.length === 0
        ? Effect.fail(
            fail(
              "Workspace verification plan found no package verify scripts.",
              "Add package-level verify scripts or update workspace verification policy before release checks can run.",
            ),
          )
        : Effect.succeed(targets),
    ),
  );

export const workspaceVerificationPlanSelfTestEffect = Effect.gen(function* () {
  const selfTestTargets = verifyPackageTargetsFromManifests([
    {
      packageJson: {
        name: "@sunfall/arc-example-devtools-panel",
        scripts: { verify: "pnpm test" },
      },
    },
    {
      packageJson: {
        name: "@sunfall/arc-core",
        scripts: { verify: "pnpm test" },
      },
    },
    {
      packageJson: {
        name: "@sunfall/arc-no-verify",
        scripts: { test: "vitest" },
      },
    },
    {
      packageJson: {
        name: "@sunfall/arc-blank-verify",
        scripts: { verify: "" },
      },
    },
  ]);

  if (selfTestTargets.length !== 2) {
    return yield* Effect.fail(
      fail(
        "Workspace verification plan self-test did not select exactly the packages with verify scripts.",
        "Fix verifyPackageTargetsFromManifests before running workspace verification.",
      ),
    );
  }
  const labels = new Map(selfTestTargets.map((target) => [target.packageName, target.label]));
  if (
    labels.get("@sunfall/arc-example-devtools-panel") !== "devtools panel" ||
    labels.get("@sunfall/arc-core") !== "core"
  ) {
    return yield* Effect.fail(
      fail(
        "Workspace verification plan self-test did not apply package labels.",
        "Fix workspaceVerifyLabel before running workspace verification.",
      ),
    );
  }
});
