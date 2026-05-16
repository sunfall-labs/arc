const manifestTargetFields = new Set(["main", "module", "types", "typings"]);

const toManifestPath = (value) =>
  typeof value === "string" && value.startsWith("./")
    ? value.slice(2)
    : undefined;

const collectStringTargets = (value, context) => {
  const target = toManifestPath(value);
  return target === undefined ? [] : [{ ...context, target }];
};

const collectExportTargets = (value, context) => {
  if (typeof value === "string") {
    return collectStringTargets(value, context);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectExportTargets(entry, {
        ...context,
        field: `${context.field}[${index}]`,
      })
    );
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    collectExportTargets(entry, {
      ...context,
      field: `${context.field}.${key}`,
    })
  );
};

export const packageManifestTargets = (packageJson) => {
  const targets = [];
  for (const [field, value] of Object.entries(packageJson)) {
    if (manifestTargetFields.has(field)) {
      targets.push(...collectStringTargets(value, { field }));
    }
  }

  const bin = packageJson.bin;
  if (typeof bin === "string") {
    targets.push(...collectStringTargets(bin, { field: "bin" }));
  } else if (typeof bin === "object" && bin !== null && !Array.isArray(bin)) {
    for (const [binName, value] of Object.entries(bin)) {
      targets.push(...collectStringTargets(value, { field: `bin.${binName}` }));
    }
  }

  const exportsMap = packageJson.exports;
  if (typeof exportsMap === "string") {
    targets.push(...collectStringTargets(exportsMap, { field: "exports" }));
  } else if (typeof exportsMap === "object" && exportsMap !== null && !Array.isArray(exportsMap)) {
    for (const [exportPath, value] of Object.entries(exportsMap)) {
      targets.push(...collectExportTargets(value, { field: `exports.${exportPath}` }));
    }
  }

  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.field}\0${target.target}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const manifestTargetValidationFailures = ({
  packageName,
  packageJson,
  files,
  payloadLabel,
}) => {
  const fileSet = new Set(files);
  return packageManifestTargets(packageJson)
    .filter((target) => !fileSet.has(target.target))
    .map((target) =>
      `${payloadLabel ?? packageName} manifest field ${target.field} points at missing payload file ${target.target}`
    );
};
