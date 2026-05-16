import { Data, Effect } from "effect";
import { collectWorkspacePackageManifests } from "./workspace-package-discovery.mjs";

class WorkspaceVerificationPlanError extends Data.TaggedError("WorkspaceVerificationPlanError") {}

const fail = (message, repair, cause) =>
  new WorkspaceVerificationPlanError({ message, repair, cause });

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const packageVerifyLabelOverrides = new Map([
  ["@effect-ui/example-devtools-extension", "devtools extension"],
  ["@effect-ui/example-devtools-panel", "devtools panel"],
  ["@effect-ui/example-project-console", "project console"],
  ["@effect-ui/starter-basic", "basic starter"],
  ["@effect-ui/starter-react", "React starter"],
]);

const defaultVerifyLabel = (packageName) =>
  packageName
    .replace(/^@effect-ui\//, "")
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
  collectWorkspacePackageManifests(workspaceRoot).pipe(
    Effect.map(verifyPackageTargetsFromManifests),
    Effect.flatMap((targets) =>
      targets.length === 0
        ? Effect.fail(
            fail(
              "Workspace verification plan found no package verify scripts.",
              "Add package-level verify scripts or update workspace verification policy before release checks can run.",
            ),
          )
        : Effect.succeed(targets)
    )
  );

const failSelfTest = (message) => {
  console.error(message);
  process.exit(1);
};

const selfTestTargets = verifyPackageTargetsFromManifests([
  {
    packageJson: {
      name: "@effect-ui/example-devtools-panel",
      scripts: { verify: "pnpm test" },
    },
  },
  {
    packageJson: {
      name: "@effect-ui/no-verify",
      scripts: { test: "vitest" },
    },
  },
  {
    packageJson: {
      name: "@effect-ui/blank-verify",
      scripts: { verify: "" },
    },
  },
]);

if (selfTestTargets.length !== 1 || selfTestTargets[0]?.packageName !== "@effect-ui/example-devtools-panel") {
  failSelfTest("workspace verification plan self-test did not select exactly the package with a verify script.");
}
if (selfTestTargets[0]?.label !== "devtools panel") {
  failSelfTest("workspace verification plan self-test did not apply package labels.");
}
