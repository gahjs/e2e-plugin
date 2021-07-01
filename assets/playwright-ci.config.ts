import { PlaywrightTestConfig } from "@playwright/test";
import mainConfig from "./playwright.config";

const config: PlaywrightTestConfig = {
  ...mainConfig,
  use: {
    // Browser options
    headless: true,

    // Artifacts
    screenshot: "only-on-failure",
    video: "retry-with-video",
  },
  forbidOnly: true,
  reporter: [["line"], ["junit", { outputFile: "results/playwright-test.xml" }]],
};

export default config;
