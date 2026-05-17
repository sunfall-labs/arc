export interface ChromeDevtoolsPanelApi {
  readonly devtools?: {
    readonly panels?: {
      readonly create: (
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: unknown) => void,
      ) => void;
    };
  };
}

declare const chrome: ChromeDevtoolsPanelApi | undefined;

export const sunfallArcDevtoolsPanelTitle = "Sunfall Arc";
export const sunfallArcDevtoolsPanelPage = "panel.html";

export const registerSunfallArcDevtoolsPanel = (
  api: ChromeDevtoolsPanelApi | undefined,
): boolean => {
  const createPanel = api?.devtools?.panels?.create;
  if (!createPanel) {
    return false;
  }

  createPanel(sunfallArcDevtoolsPanelTitle, "", sunfallArcDevtoolsPanelPage);
  return true;
};

if (typeof chrome !== "undefined") {
  registerSunfallArcDevtoolsPanel(chrome);
}
