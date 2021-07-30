import { PlaywrightTestConfig } from "@playwright/test";
import mainConfig from "./playwright.config";

const config: PlaywrightTestConfig = {
  ...mainConfig, // Extend main config
  use: {
    headless: true,
  },
  forbidOnly: true,
  reporter: [["line"], ["junit", { outputFile: "results/playwright-test.xml" }]],
};

export default config;
