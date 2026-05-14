export interface ChromeDevtoolsPanelApi {
  readonly devtools?: {
    readonly panels?: {
      readonly create: (
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: unknown) => void
      ) => void;
    };
  };
}

declare const chrome: ChromeDevtoolsPanelApi | undefined;

export const effectUiDevtoolsPanelTitle = "Effect UI";
export const effectUiDevtoolsPanelPage = "panel.html";

export const registerEffectUiDevtoolsPanel = (
  api: ChromeDevtoolsPanelApi | undefined
): boolean => {
  const createPanel = api?.devtools?.panels?.create;
  if (!createPanel) {
    return false;
  }

  createPanel(effectUiDevtoolsPanelTitle, "", effectUiDevtoolsPanelPage);
  return true;
};

if (typeof chrome !== "undefined") {
  registerEffectUiDevtoolsPanel(chrome);
}
