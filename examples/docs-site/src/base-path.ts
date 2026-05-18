const absoluteUrlPattern = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export const normalizeDocsSiteBasePath = (input = "/"): string => {
  const value = input.trim();
  if (value.length === 0 || value === "/") {
    return "/";
  }
  if (value.includes("?") || value.includes("#")) {
    throw new Error("Docs site base path must not include a query string or hash.");
  }
  if (absoluteUrlPattern.test(value) || value.startsWith("//")) {
    throw new Error("Docs site base path must be path-only, such as '/repository-name/'.");
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const withDocsSiteBasePath = (href: string, basePath: string): string => {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return href;
  }

  const normalizedBasePath = normalizeDocsSiteBasePath(basePath);
  return normalizedBasePath === "/" ? href : `${normalizedBasePath.slice(0, -1)}${href}`;
};

export const stripDocsSiteBasePath = (href: string, basePath: string): string => {
  const normalizedBasePath = normalizeDocsSiteBasePath(basePath);
  if (normalizedBasePath === "/") {
    return href;
  }

  const url = new URL(href, "https://sunfall-arc.local");
  const basePathWithoutTrailingSlash = normalizedBasePath.slice(0, -1);
  if (url.pathname === basePathWithoutTrailingSlash || url.pathname === normalizedBasePath) {
    return `/${url.search}`;
  }
  if (url.pathname.startsWith(normalizedBasePath)) {
    return `/${url.pathname.slice(normalizedBasePath.length)}${url.search}`;
  }

  return `${url.pathname}${url.search}`;
};
