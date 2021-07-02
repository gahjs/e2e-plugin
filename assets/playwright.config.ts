import { PlaywrightTestConfig } from "@playwright/test";
import playwrightProjectsConfig from "./playwright.projects.config.json";

const config: PlaywrightTestConfig = {
  use: {
    // Browser options
    headless: false,

    // Context options
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    // Artifacts
    screenshot: "only-on-failure",
    video: "retry-with-video",
  },
  testMatch: ".*(spec)\.(ts)",
  projects: playwrightProjectsConfig,
};

export default config;
