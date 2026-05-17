import { readFile, readdir } from "node:fs/promises";
import { Server } from "@effect-ui/core";
import { Effect, Schema } from "effect";
import {
  GetRecipeContract,
  ListRecipeSummariesContract,
  RecipeCategory,
  RecipeFrontmatterDecodeError,
  RecipeMarkdownParseError,
  RecipeNotFound,
  RecipeSchema,
  RecipeSlug,
  type Recipe,
  type RecipeBlock,
  type RecipeContentError,
  type RecipeSlug as RecipeSlugType,
  type RecipeSummary,
} from "./content.contract.js";

const cookbookContentUrl = new URL("./content/cookbook/", import.meta.url);

const RecipeFrontmatterSchema = Schema.Struct({
  title: Schema.String,
  category: RecipeCategory,
  summary: Schema.String,
  order: Schema.Number,
  related: Schema.optional(Schema.Array(Schema.String)),
});

type RecipeFrontmatter = typeof RecipeFrontmatterSchema.Type;

const stripJsonTrailingCommas = (text: string): string => {
  let next = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (inString) {
      next += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      next += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] ?? "")) {
        lookahead += 1;
      }
      const nextChar = text[lookahead];
      if (nextChar === "}" || nextChar === "]") {
        continue;
      }
    }

    next += char;
  }

  return next;
};

const markdownFilesEffect: Effect.Effect<
  ReadonlyArray<string>,
  RecipeMarkdownParseError
> = Effect.tryPromise({
  try: () => readdir(cookbookContentUrl),
  catch: (cause) =>
    new RecipeMarkdownParseError({
      file: "src/content/cookbook",
      message: cause instanceof Error ? cause.message : "Could not read cookbook directory.",
    }),
}).pipe(
  Effect.map((files) =>
    files.filter((file) => file.endsWith(".md")).sort((left, right) => left.localeCompare(right)),
  ),
);

const readRecipeFileEffect = (fileName: string): Effect.Effect<string, RecipeMarkdownParseError> =>
  Effect.tryPromise({
    try: () => readFile(new URL(fileName, cookbookContentUrl), "utf8"),
    catch: (cause) =>
      new RecipeMarkdownParseError({
        file: fileName,
        message: cause instanceof Error ? cause.message : "Could not read recipe file.",
      }),
  });

const parseFrontmatterEffect = (
  fileName: string,
  text: string,
): Effect.Effect<
  { readonly frontmatter: RecipeFrontmatter; readonly body: string },
  RecipeContentError
> =>
  Effect.gen(function* () {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const closing = lines.indexOf("---", 1);
    if (lines[0] !== "---" || closing === -1) {
      return yield* new RecipeMarkdownParseError({
        file: fileName,
        message: "Recipe files must start with JSON frontmatter delimited by --- lines.",
      });
    }

    const frontmatterJson = stripJsonTrailingCommas(lines.slice(1, closing).join("\n"));
    const rawFrontmatter = yield* Effect.try({
      try: () => JSON.parse(frontmatterJson) as unknown,
      catch: (cause) =>
        new RecipeFrontmatterDecodeError({
          file: fileName,
          message: cause instanceof Error ? cause.message : "Invalid JSON frontmatter.",
        }),
    });
    const frontmatter = yield* Schema.decodeUnknownEffect(RecipeFrontmatterSchema)(
      rawFrontmatter,
    ).pipe(
      Effect.mapError(
        (error) =>
          new RecipeFrontmatterDecodeError({
            file: fileName,
            message: String(error),
          }),
      ),
    );

    return {
      frontmatter,
      body: lines
        .slice(closing + 1)
        .join("\n")
        .trim(),
    };
  });

const pushParagraph = (blocks: RecipeBlock[], paragraph: string[]): void => {
  const text = paragraph.join(" ").trim();
  if (text.length > 0) {
    blocks.push({ _tag: "Paragraph", text });
  }
  paragraph.length = 0;
};

const parseMarkdownBlocksEffect = (
  fileName: string,
  markdown: string,
): Effect.Effect<ReadonlyArray<RecipeBlock>, RecipeMarkdownParseError> =>
  Effect.try({
    try: () => {
      const blocks: RecipeBlock[] = [];
      const paragraph: string[] = [];
      const lines = markdown.split("\n");

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) {
          pushParagraph(blocks, paragraph);
          const language = trimmed.slice(3).trim();
          const codeLines: string[] = [];
          index += 1;
          while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
            codeLines.push(lines[index] ?? "");
            index += 1;
          }
          if (index >= lines.length) {
            throw new RecipeMarkdownParseError({
              file: fileName,
              message: "Code fence was not closed.",
            });
          }
          blocks.push({ _tag: "Code", language, code: codeLines.join("\n") });
          continue;
        }

        if (trimmed.length === 0) {
          pushParagraph(blocks, paragraph);
          continue;
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
        if (heading) {
          pushParagraph(blocks, paragraph);
          blocks.push({
            _tag: "Heading",
            level: heading[1]?.length ?? 2,
            text: heading[2] ?? "",
          });
          continue;
        }

        if (trimmed.startsWith("- ")) {
          pushParagraph(blocks, paragraph);
          const items: string[] = [];
          while (index < lines.length && (lines[index] ?? "").trim().startsWith("- ")) {
            items.push((lines[index] ?? "").trim().slice(2));
            index += 1;
          }
          index -= 1;
          blocks.push({ _tag: "List", items });
          continue;
        }

        paragraph.push(trimmed);
      }

      pushParagraph(blocks, paragraph);
      return blocks;
    },
    catch: (cause) =>
      cause instanceof RecipeMarkdownParseError
        ? cause
        : new RecipeMarkdownParseError({
            file: fileName,
            message: cause instanceof Error ? cause.message : "Could not parse recipe Markdown.",
          }),
  });

const dropPageTitleHeading = (
  blocks: ReadonlyArray<RecipeBlock>,
  title: string,
): ReadonlyArray<RecipeBlock> => {
  const firstBlock = blocks[0];
  if (firstBlock?._tag === "Heading" && firstBlock.level === 1 && firstBlock.text === title) {
    return blocks.slice(1);
  }
  return blocks;
};

const loadRecipeFromFileEffect = (fileName: string): Effect.Effect<Recipe, RecipeContentError> =>
  Effect.gen(function* () {
    const slugText = fileName.replace(/\.md$/, "");
    const slug = yield* Schema.decodeUnknownEffect(RecipeSlug)(slugText).pipe(
      Effect.mapError(
        (error) =>
          new RecipeFrontmatterDecodeError({
            file: fileName,
            message: String(error),
          }),
      ),
    );
    const fileText = yield* readRecipeFileEffect(fileName);
    const parsed = yield* parseFrontmatterEffect(fileName, fileText);
    const related = yield* Effect.forEach(parsed.frontmatter.related ?? [], (relatedSlug) =>
      Schema.decodeUnknownEffect(RecipeSlug)(relatedSlug).pipe(
        Effect.mapError(
          (error) =>
            new RecipeFrontmatterDecodeError({
              file: fileName,
              message: String(error),
            }),
        ),
      ),
    );
    const parsedBlocks = yield* parseMarkdownBlocksEffect(fileName, parsed.body);
    const blocks = dropPageTitleHeading(parsedBlocks, parsed.frontmatter.title);

    return yield* Schema.decodeUnknownEffect(RecipeSchema)({
      slug,
      title: parsed.frontmatter.title,
      category: parsed.frontmatter.category,
      summary: parsed.frontmatter.summary,
      order: parsed.frontmatter.order,
      related,
      blocks,
    }).pipe(
      Effect.mapError(
        (error) =>
          new RecipeFrontmatterDecodeError({
            file: fileName,
            message: String(error),
          }),
      ),
    );
  });

const allRecipesEffect: Effect.Effect<ReadonlyArray<Recipe>, RecipeContentError> = Effect.gen(
  function* () {
    const files = yield* markdownFilesEffect;
    const recipes = yield* Effect.forEach(files, loadRecipeFromFileEffect);
    return recipes.sort(
      (left, right) => left.order - right.order || left.title.localeCompare(right.title),
    );
  },
);

const toSummary = (recipe: Recipe): RecipeSummary => ({
  slug: recipe.slug,
  title: recipe.title,
  category: recipe.category,
  summary: recipe.summary,
  order: recipe.order,
});

const listRecipeSummariesEffect: Effect.Effect<RecipeSummary[], RecipeContentError> =
  allRecipesEffect.pipe(Effect.map((recipes) => recipes.map(toSummary)));

const getRecipeEffect = (slug: RecipeSlugType): Effect.Effect<Recipe, RecipeContentError> =>
  allRecipesEffect.pipe(
    Effect.flatMap((recipes) => {
      const recipe = recipes.find((entry) => entry.slug === slug);
      return recipe === undefined
        ? Effect.fail(new RecipeNotFound({ slug }))
        : Effect.succeed(recipe);
    }),
  );

export const listRecipeSummariesServer = Server.implement(
  ListRecipeSummariesContract,
  () => listRecipeSummariesEffect,
);

export const getRecipeServer = Server.implement(GetRecipeContract, ({ slug }) =>
  getRecipeEffect(slug),
);

export const docsSiteServerFunctions = [listRecipeSummariesServer, getRecipeServer] as const;
