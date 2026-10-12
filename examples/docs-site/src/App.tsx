import { Component, RouterLink, RouterProvider, useRouter } from "@sunfall/arc-solid";
import { Route, State } from "@sunfall/arc-core";
import { onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  BlogPostRoute,
  CookbookRoute,
  DocsOverviewRoute,
  DocsPageRoute,
  HomeRoute,
  RecipeRoute,
} from "./site-routes.js";
import {
  docsPages,
  docsPagesBySection,
  docsSections,
  getDocsPage,
  type DocsBlock,
  type DocsPage,
} from "./docs-content.js";
import type { RecipeSlug } from "./content.js";
import { ArchitectureDiagram } from "./architecture-diagram.js";
import { BlogPostView } from "./blog.js";
import { HomeView } from "./home.js";
import {
  PageRail,
  createPageRailItems,
  pageRailIdsByBlockIndex,
  type HeadingSource,
  type PageRailItem,
} from "./page-rail.js";
import { RecipeIndexGrid, RecipeNavList, RecipeRouteView } from "./recipes.js";
import { FailureView, LoadingView, NotFoundView } from "./status-views.js";
import {
  AnchoredHeading,
  ArcMark,
  ArrowIcon,
  Callout,
  CloseIcon,
  CodeBlock,
  GitHubIcon,
  InlineText,
  MenuIcon,
  TableBlock,
  ThemeToggle,
  githubUrl,
  themeBootScript,
} from "./ui.js";
import { docsSiteHref, makeDocsSiteHistoryAdapter } from "./site-base.js";
import "./styles.css";

const packageListItemPattern = /^(@sunfall\/[a-z0-9-]+(?: and @sunfall\/[a-z0-9-]+)*):\s(.+)$/u;

type DocsRoutes = typeof routes;

const recipeHref = (slug: RecipeSlug): string => docsSiteHref(`/cookbook/${slug}`);

const docsPageRailItems = (blocks: ReadonlyArray<DocsBlock>): readonly PageRailItem[] =>
  createPageRailItems(
    blocks.flatMap((block, blockIndex): readonly HeadingSource[] =>
      block._tag === "Heading"
        ? [{ blockIndex, level: block.level ?? 2, text: block.text ?? "Section" }]
        : [],
    ),
  );

function DocsOverviewView() {
  const [featured, ...rest]: ReadonlyArray<DocsPage> = docsPages;
  return (
    <article class="docPage wide">
      <div class="docColumn">
        <header class="pageHeader">
          <p class="eyebrow">Documentation</p>
          <h1>Learn Arc</h1>
          <p class="pageLede">
            Start with the golden path: it picks the right definition for each job and builds one
            feature end to end. The rest of the docs go deeper, one topic at a time.
          </p>
        </header>

        <RouterLink
          route={DocsPageRoute}
          options={{ params: { slug: featured.slug } }}
          class="featuredCard"
        >
          <span class="cardMeta">{featured.section}</span>
          <span class="featuredTitle">{featured.title}</span>
          <span class="cardBody">{featured.summary}</span>
          <span class="cardCta">
            Read the guide
            <ArrowIcon />
          </span>
        </RouterLink>

        <section class="docsIndexSection" aria-label="All guides">
          <h2 class="sectionLabel">All guides</h2>
          <ul class="cardGrid">
            {docsSections.flatMap((section) =>
              docsPagesBySection(section)
                .filter((page) => rest.includes(page))
                .map((page) => (
                  <li>
                    <RouterLink
                      route={DocsPageRoute}
                      options={{ params: { slug: page.slug } }}
                      class="card"
                    >
                      <span class="cardMeta">{section}</span>
                      <span class="cardTitle">{page.title}</span>
                      <span class="cardBody">{page.summary}</span>
                    </RouterLink>
                  </li>
                )),
            )}
          </ul>
        </section>

        <section class="docsIndexSection" aria-label="Cookbook">
          <h2 class="sectionLabel">Cookbook</h2>
          <p class="sectionNote">
            Small working slices: Effect-first callbacks, typed schemas, route-owned preload,
            explicit invalidation, and testable boundaries.
          </p>
          <RouterLink route={CookbookRoute} class="textLink">
            Browse the cookbook
            <ArrowIcon />
          </RouterLink>
        </section>
      </div>
    </article>
  );
}

function DocsPageView(props: Route.Props<typeof DocsPageRoute>) {
  const page = getDocsPage(props.params.slug);

  if (!page) {
    return <NotFoundView />;
  }

  const railItems = docsPageRailItems(page.blocks);
  const headingIds = pageRailIdsByBlockIndex(railItems);
  const index = docsPages.findIndex((candidate) => candidate.slug === page.slug);
  const previous = docsPages[index - 1];
  const next = docsPages[index + 1];

  return (
    <article class="docPage">
      <div class="docColumn">
        <header class="pageHeader">
          <p class="eyebrow">{page.section}</p>
          <h1>{page.title}</h1>
          <p class="pageLede">{page.summary}</p>
        </header>

        <div class="prose">
          {page.blocks.map((block, blockIndex) => (
            <DocsBlockView block={block} headingId={headingIds.get(blockIndex)} />
          ))}
        </div>

        <nav class="pageFooterNav pager" aria-label="Previous and next pages">
          {previous === undefined ? (
            <span />
          ) : (
            <RouterLink
              route={DocsPageRoute}
              options={{ params: { slug: previous.slug } }}
              class="pagerLink"
            >
              <span class="pagerLabel">Previous</span>
              <span class="pagerTitle">{previous.title}</span>
            </RouterLink>
          )}
          {next === undefined ? null : (
            <RouterLink
              route={DocsPageRoute}
              options={{ params: { slug: next.slug } }}
              class="pagerLink next"
            >
              <span class="pagerLabel">Next</span>
              <span class="pagerTitle">{next.title}</span>
            </RouterLink>
          )}
        </nav>
      </div>

      <PageRail items={railItems} />
    </article>
  );
}

function DocsBlockView(props: {
  readonly block: DocsBlock;
  readonly headingId: string | undefined;
}) {
  switch (props.block._tag) {
    case "Heading":
      return (
        <AnchoredHeading
          level={props.block.level === 3 ? 3 : 2}
          id={props.headingId}
          text={props.block.text ?? "Section"}
        />
      );
    case "Paragraph":
      return (
        <p>
          <InlineText text={props.block.text ?? ""} />
        </p>
      );
    case "List":
      return (
        <ul>
          {(props.block.items ?? []).map((item) => (
            <DocsListItem item={item} />
          ))}
        </ul>
      );
    case "Code":
      return (
        <CodeBlock
          code={props.block.code ?? ""}
          language={props.block.language}
          title={props.block.title}
        />
      );
    case "Table":
      return <TableBlock rows={props.block.rows ?? []} />;
    case "Callout":
      return <Callout title={props.block.title} text={props.block.text ?? ""} />;
    case "Diagram":
      return <ArchitectureDiagram />;
  }
}

function DocsListItem(props: { readonly item: string }) {
  const match = packageListItemPattern.exec(props.item);
  if (!match) {
    return (
      <li>
        <InlineText text={props.item} />
      </li>
    );
  }

  const packageNames = match[1]?.split(" and ") ?? [];
  const description = match[2] ?? "";

  return (
    <li>
      {packageNames.map((packageName, index) => (
        <>
          {index > 0 ? " and " : null}
          <code class="inlineCode">{packageName}</code>
        </>
      ))}
      : <InlineText text={description} />
    </li>
  );
}

const CookbookIndexView = Component.define("CookbookIndexView", function* () {
  const Recipes = yield* RecipeIndexGrid;
  return () => (
    <article class="docPage wide">
      <div class="docColumn">
        <header class="pageHeader">
          <p class="eyebrow">Cookbook</p>
          <h1>Working Sunfall Arc recipes</h1>
          <p class="pageLede">
            Each recipe is small enough to copy and still follows the framework's contracts:
            Effect-first callbacks, typed schemas, route-owned data, and checks that explain what
            changed.
          </p>
        </header>

        <Recipes />
      </div>
    </article>
  );
});

const HomeUiRoute = Route.withComponent(HomeRoute, HomeView);
const DocsOverviewUiRoute = Route.withComponent(DocsOverviewRoute, DocsOverviewView);
const DocsPageUiRoute = Route.withComponent(DocsPageRoute, DocsPageView);
const BlogPostUiRoute = Route.withComponent(BlogPostRoute, BlogPostView);
const CookbookUiRoute = Route.withComponent(CookbookRoute, CookbookIndexView);
const RecipeUiRoute = Route.withComponent(RecipeRoute, RecipeRouteView);
const routes = [
  HomeUiRoute,
  DocsOverviewUiRoute,
  DocsPageUiRoute,
  BlogPostUiRoute,
  CookbookUiRoute,
  RecipeUiRoute,
] as const;

/** Renders the matched docs view in place, so static navigation swaps content without a blank frame. */
const DocsRouteOutlet = Component.define("DocsRouteOutlet", function* () {
  const Home = yield* HomeView;
  const Cookbook = yield* CookbookIndexView;
  const RecipePage = yield* RecipeRouteView;

  return () => {
    const router = useRouter<DocsRoutes>();
    const state = () => router.state();

    const renderReady = (
      readyState: Extract<ReturnType<typeof state>, { readonly _tag: "Ready" }>,
    ) => {
      const match = readyState.match;
      switch (match.route) {
        case HomeUiRoute:
          return <Home />;
        case DocsOverviewUiRoute:
          return <DocsOverviewView />;
        case DocsPageUiRoute:
          return (
            <DocsPageView
              params={match.params as Route.Params<typeof DocsPageRoute>}
              search={match.search as Route.Search<typeof DocsPageRoute>}
              match={match as Route.Match<typeof DocsPageRoute>}
            />
          );
        case BlogPostUiRoute:
          return <BlogPostView />;
        case CookbookUiRoute:
          return <Cookbook />;
        case RecipeUiRoute:
          return (
            <RecipePage
              params={match.params as Route.Params<typeof RecipeRoute>}
              search={match.search as Route.Search<typeof RecipeRoute>}
              match={match as Route.Match<typeof RecipeRoute>}
            />
          );
      }
    };

    const page = (() => {
      const current = state();
      switch (current._tag) {
        case "Pending":
          return <LoadingView />;
        case "Failure":
          return <FailureView error={current.error} />;
        case "NotFound":
          return <NotFoundView />;
        case "Ready":
          return renderReady(current);
      }
    }) as unknown as JSX.Element;
    return (
      <>
        {page}
        <SiteFooter />
      </>
    );
  };
});

// The phone navigation drawer. Client UI state, so it is a State: the
// Timeline reads `State "Site.menu" Toggle` and `Close`.
const SiteMenu = State.define({
  name: "Site.menu",
  initial: false,
  on: {
    Toggle: (open) => !open,
    Close: () => false,
  },
});

/**
 * The docs site root: Start renders it on the server and `App.launch`
 * hydrates it in the browser.
 */
const DocsSite = Component.define("DocsSite", function* (props: { readonly href: string }) {
  const { runtime } = yield* Component.instance;
  // The server rendered `props.href`, so its data is already hydrated.
  const history = makeDocsSiteHistoryAdapter({ runtime, routes, hydratedHrefs: [props.href] });
  const router = yield* Component.router(routes, { history, initialHref: props.href });
  const Outlet = yield* DocsRouteOutlet;
  const RecipeLinks = yield* RecipeNavList;
  const menu = yield* Component.state(SiteMenu);

  return () => (
    <RouterProvider router={router}>
      <DocsShell Outlet={Outlet} RecipeLinks={RecipeLinks} menu={menu} />
    </RouterProvider>
  );
});

export default DocsSite;

type SiteSection = "home" | "docs" | "cookbook" | "blog" | "none";

function DocsShell(props: {
  readonly Outlet: Component.Solid<{}>;
  readonly RecipeLinks: Component.Solid<{ readonly activeSlug: string | undefined }>;
  readonly menu: {
    readonly model: () => boolean;
    readonly send: { readonly Toggle: () => void; readonly Close: () => void };
  };
}) {
  const { Outlet, RecipeLinks, menu } = props;
  const router = useRouter<DocsRoutes>();
  const match = () => router.match();
  const section = (): SiteSection => {
    switch (match()?.route.path) {
      case HomeRoute.path:
        return "home";
      case DocsOverviewRoute.path:
      case DocsPageRoute.path:
        return "docs";
      case CookbookRoute.path:
      case RecipeRoute.path:
        return "cookbook";
      case BlogPostRoute.path:
        return "blog";
      default:
        return "none";
    }
  };
  const activeSlug = (): string | undefined => {
    const params = match()?.params as { readonly slug?: string } | undefined;
    return params?.slug;
  };
  const hasSidebar = () => section() === "docs" || section() === "cookbook";
  const currentPath = () => match()?.route.path;

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.model()) {
        menu.send.Close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A link inside the drawer navigates, and the drawer closes behind it.
  const closeOnLink = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a") !== null) {
      menu.send.Close();
    }
  };

  return (
    <div
      class={["siteShell", { hasSidebar: hasSidebar(), menuOpen: menu.model() }]}
      data-section={section()}
    >
      <script innerHTML={themeBootScript} />
      <a class="skipLink" href="#content">
        Skip to content
      </a>
      <header class="topbar">
        <div class="topbarInner">
          <button
            type="button"
            class="iconButton menuButton"
            aria-expanded={menu.model() ? "true" : "false"}
            aria-controls="site-navigation"
            onClick={menu.send.Toggle}
          >
            <span class="srOnly">{menu.model() ? "Close navigation" : "Open navigation"}</span>
            {menu.model() ? <CloseIcon /> : <MenuIcon />}
          </button>
          <RouterLink route={HomeRoute} class="brand" aria-label="Sunfall Arc home">
            <ArcMark />
            <span class="brandName">Sunfall Arc</span>
            <span class="brandBadge">alpha</span>
          </RouterLink>
          <nav class="topNav" aria-label="Primary">
            <RouterLink
              route={DocsOverviewRoute}
              class="topNavLink"
              aria-current={section() === "docs" ? "page" : undefined}
            >
              Docs
            </RouterLink>
            <RouterLink
              route={CookbookRoute}
              class="topNavLink"
              aria-current={section() === "cookbook" ? "page" : undefined}
            >
              Cookbook
            </RouterLink>
            <RouterLink
              route={BlogPostRoute}
              class="topNavLink"
              aria-current={section() === "blog" ? "page" : undefined}
            >
              Blog
            </RouterLink>
          </nav>
          <div class="topbarActions">
            <a
              class="iconButton"
              href={githubUrl}
              rel="noreferrer"
              aria-label="Sunfall Arc on GitHub"
            >
              <GitHubIcon />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div class="siteBody">
        <div class="drawerBackdrop" aria-hidden="true" onClick={menu.send.Close} />
        <aside class="sidebar" id="site-navigation" aria-label="Site" onClick={closeOnLink}>
          <nav class="sidebarGroup mobileOnly" aria-label="Primary">
            <ul class="navList">
              <li>
                <RouterLink
                  route={HomeRoute}
                  class="navLink"
                  aria-current={section() === "home" ? "page" : undefined}
                >
                  Home
                </RouterLink>
              </li>
              <li>
                <RouterLink
                  route={BlogPostRoute}
                  class="navLink"
                  aria-current={section() === "blog" ? "page" : undefined}
                >
                  Blog
                </RouterLink>
              </li>
              <li>
                <a class="navLink" href={githubUrl} rel="noreferrer">
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
          {docsSections.map((group) => (
            <nav class="sidebarGroup" aria-label={group}>
              <p class="sidebarHeading">{group}</p>
              <ul class="navList">
                {group === "Start here" ? (
                  <li>
                    <RouterLink
                      route={DocsOverviewRoute}
                      class="navLink"
                      aria-current={currentPath() === DocsOverviewRoute.path ? "page" : undefined}
                    >
                      Overview
                    </RouterLink>
                  </li>
                ) : null}
                {docsPagesBySection(group).map((page) => (
                  <li>
                    <RouterLink
                      route={DocsPageRoute}
                      options={{ params: { slug: page.slug } }}
                      class="navLink"
                      aria-current={
                        currentPath() === DocsPageRoute.path && activeSlug() === page.slug
                          ? "page"
                          : undefined
                      }
                    >
                      {page.title}
                    </RouterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <nav class="sidebarGroup" aria-label="Cookbook">
            <p class="sidebarHeading">
              <RouterLink
                route={CookbookRoute}
                class="sidebarHeadingLink"
                aria-current={currentPath() === CookbookRoute.path ? "page" : undefined}
              >
                Cookbook
              </RouterLink>
            </p>
            {/* Every site route preloads the recipe index; a 404 has no route to preload it. */}
            {section() === "none" ? null : (
              <RecipeLinks
                activeSlug={currentPath() === RecipeRoute.path ? activeSlug() : undefined}
              />
            )}
          </nav>
        </aside>

        <main class="siteMain" id="content" tabindex="-1">
          {/* The Outlet also renders the footer: nothing may follow it here. */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer class="siteFooter">
      <div class="footerBrand">
        <ArcMark />
        <span>Sunfall Arc · MIT licensed · Public alpha</span>
      </div>
      <nav class="footerLinks" aria-label="Footer">
        <RouterLink route={DocsOverviewRoute}>Docs</RouterLink>
        <RouterLink route={CookbookRoute}>Cookbook</RouterLink>
        <RouterLink route={BlogPostRoute}>Blog</RouterLink>
        <a href={githubUrl} rel="noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  );
}

export const docsSiteRecipeHref = recipeHref;
