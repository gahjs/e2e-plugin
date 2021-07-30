import {
  GahModuleData,
  GahModuleType,
  GahPlugin,
  GahPluginConfig,
  GahPluginDependencyConfig,
  PackageJson,
  TsConfig
} from '@gah/shared';
import { e2ePackages } from './e2e-packages';

import { E2eConfig } from './e2e-config';

/**
 * A gah plugin has to extend the abstract GahPlugin base class and implement the abstract methods.
 */
export class E2ePlugin extends GahPlugin {
  constructor() {
    // Call the constructor with the name of the plugin (only used for logging, does not need to match the package name)
    super('E2ePlugin');
  }

  /**
   * Called after adding the plugin with gah. Used to configure the plugin.
   * @param existingCfg This will be passed by gah and is used to check wheter a property is already configured or not
   */
  public async onInstall(existingCfg?: E2eConfig): Promise<GahPluginConfig> {
    // Create a new instance of the plugin configuration
    const newCfg = new E2eConfig();
    const isHost = (await this.configurationService.getGahModuleType()) === GahModuleType.HOST;

    if (!isHost) {
      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.testDirectoryPath =
        (await this.promptService.fuzzyPath({
          msg: 'Please enter a (fuzzy) path to your test directory (press enter to skip)',
          default: 'test/specs',
          enabled: () => !existingCfg?.testDirectoryPath,
          itemType: 'directory',
          optional: true
        })) ?? existingCfg?.testDirectoryPath; // Defaults back to the old value in case undefined gets returned

      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.sharedHelperPath =
        (await this.promptService.fuzzyPath({
          msg: 'Please enter a (fuzzy) path to your test helper file (press enter to skip)',
          enabled: () => !existingCfg?.sharedHelperPath,
          itemType: 'file',
          optional: true
        })) ?? existingCfg?.sharedHelperPath; // Defaults back to the old value in case undefined gets returned

      if (newCfg.testDirectoryPath || newCfg.sharedHelperPath) {
        newCfg.isConfigured = true;
      }
    }
    return newCfg;
  }

  /**
   * Called everytime gah gets used for all configured plugins. Register your handlers here.
   */
  public onInit() {
    /**
     * executes all tests of the modules defined in playwright.projects.config.json
     */
    this.registerCommandHandler('test', () => this.executionService.execute('yarn playwright test', true, undefined, './.gah'));

    /**
     * executes the tests of the specified module
     */
    this.registerCommandHandler('test-p', args =>
      this.executionService.execute(`yarn playwright test --project=${args[0]}`, true, undefined, './.gah')
    );

    /**
     * Use CI config
     * executes all tests of the modules defined in playwright.projects.config.json
     */
    this.registerCommandHandler('test-ci', () =>
      this.executionService.execute('yarn ava --config=playwright-ci.config.ts', true, undefined, './.gah')
    );

    /**
     * Use CI config
     * executes the tests of the specified module
     */
    this.registerCommandHandler('test-ci-p', args =>
      this.executionService.execute(`yarn ava --config=playwright-ci.config.ts --project=${args[0]}`, true, undefined, './.gah')
    );

    // Register a handler that gets called synchronously if the corresponding event occured. Some events can be called multiple times!
    if (this.readData('isInit') !== true) {
      this.registerEventListener('AFTER_GENERATE_SYMLINKS', async event => {
        if (event.module === undefined) {
          return;
        }

        /**
         * if gah module
         */
        if (!event.module?.isHost) {
          if (!this.isPluginConfiguardInModule(event.module)) {
            return;
          }

          /**
           * declare dist folder for tests
           */
          const distTestFolder = this.fileSystemService.join(event.module.srcBasePath, '.gah/test');

          /**
           * if dist test folder exist then delete
           */
          if (await this.fileSystemService.directoryExists(distTestFolder)) {
            await this.fileSystemService.deleteFilesInDirectory(distTestFolder);
          }

          /**
           * get all dep modules with e2e plugin cfg
           */
          const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

          await this.linkSharedTestFolder(allDepModules, distTestFolder);

          await this.createTsconfigForTestModule(event.module);
          await this.addPathsToTsconfig(event.module, allDepModules);
        }

        /**
         * if gah host
         */
        if (event.module?.isHost) {
          if (!this.isPluginConfiguardInAnyModule(event.module)) {
            return;
          }

          /**
           * declare dist folder for tests
           */
          const distTestFolder = this.fileSystemService.join(event.module.basePath, 'test');

          /**
           * if dist test folder exist then delete
           */
          if (await this.fileSystemService.directoryExists(distTestFolder)) {
            await this.fileSystemService.deleteFilesInDirectory(distTestFolder);
          }

          /**
           * get all dep modules with e2e plugin cfg
           */
          const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

          await this.linkTestFiles(allDepModules, distTestFolder);
          await this.linkSharedTestFolder(allDepModules, distTestFolder);

          await this.copyConfigFiles(event.module, 'playwright.config.ts');
          await this.copyConfigFiles(event.module, 'playwright-ci.config.ts');
          await this.copyConfigFiles(event.module, 'playwright.projects.config.json');
          await this.generatePlaywrightProjectsConfig(event.module, allDepModules);

          await this.createTsconfigForTestHost(event.module);
          await this.addPathsToTsconfig(event.module, allDepModules);
        }
      });

      this.registerEventListener('BEFORE_INSTALL_PACKAGES', event => {
        if (event.module === undefined) {
          return;
        }

        /**
         * if gah module without plugin cfg
         */
        if (!event.module?.isHost && !this.isPluginConfiguardInModule(event.module)) {
          return;
        }

        /**
         * if gah host without any module with plugin cfg
         */
        if (event.module?.isHost && !this.isPluginConfiguardInAnyModule(event.module)) {
          return;
        }

        this.editPkgJson(event.module.packageJson);
        this.loggerService.log('Package.json adjusted for tests');
      });

      this.storeData('isInit', true);
    }
  }

  /**
   * For convenience the correctly casted configuration
   */
  private get cfg() {
    return this.config as E2eConfig;
  }

  /**
   * check is plugin is configuard in module
   */
  private isPluginConfiguardInModule(module: GahModuleData): boolean {
    if (this.getPluginCfgFromModule(module)) {
      return true;
    }
    return false;
  }
  /**
   * find all dependencie modules with @gah/e2e-plugin config
   */
  private allFilterdRecursiveDependencies(dependencies: GahModuleData[]): GahModuleData[] {
    const allModules = new Array<GahModuleData>();
    dependencies.forEach(dep => {
      this.collectAllReferencedModules(dep, allModules);
    });
    const filterdModules = allModules.filter(mod => this.getPluginCfgFromModule(mod));
    return filterdModules;
  }

  /**
   * find all dependencie modules
   */
  private collectAllReferencedModules(module: GahModuleData, allModules: GahModuleData[]) {
    if (!allModules.some(m => m.moduleName === module.moduleName)) {
      allModules.push(module);
    }

    module.dependencies.forEach(dep => {
      this.collectAllReferencedModules(dep, allModules);
    });
  }

  /**
   * get plugin config from Module
   */
  private getPluginCfgFromModule(module: GahModuleData): E2eConfig | undefined {
    let pluginCfg: E2eConfig | undefined = undefined;
    module.pluginCfg?.['@gah/e2e-plugin']?.forEach(cfg => {
      if (cfg.isConfigured) {
        return (pluginCfg = cfg);
      }
    });
    return pluginCfg;
  }

  /**
   * check is Plugin configuard in any gah module
   */
  private isPluginConfiguardInAnyModule(module: GahModuleData): GahPluginDependencyConfig | undefined {
    return module.gahConfig.plugins?.find(pl => {
      if (pl.name === '@gah/e2e-plugin') {
        const pluginCfg = pl.settings as E2eConfig;
        if (pluginCfg) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * link test folder from modules
   * testDirectoryPath only exist in non shared helper modules
   */
  private async linkTestFiles(allDepModules: GahModuleData[], distTestFolder: string) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        const sourceTestDirectoryPath = this.fileSystemService.join(depMod.basePath, plugConf.testDirectoryPath);

        if (await this.fileSystemService.directoryExists(sourceTestDirectoryPath)) {
          await this.fileSystemService.ensureDirectory(distTestFolder);
          try {
            await this.fileSystemService.createDirLink(`${distTestFolder}/${depMod.moduleName!}`, sourceTestDirectoryPath);
          } catch (error: any) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  /**
   * remove index file from shared helper path
   */
  private extractDirectoryFromPluginPath(plugPath: string): string[] {
    const pathArray = plugPath.split('/');
    pathArray.pop(); // remove the index file
    const lastFolder = pathArray.pop();
    return [pathArray.join('/'), lastFolder!];
  }

  /**
   * link shared test helper folder
   * sharedHelperPath only exists in shared helper modules
   */
  private async linkSharedTestFolder(allDepModules: GahModuleData[], distTestFolder: string) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.sharedHelperPath) {
        const plugDirectoryPath = this.extractDirectoryFromPluginPath(plugConf.sharedHelperPath);

        const sharedHelperDistPath = this.fileSystemService.join(
          distTestFolder,
          depMod.packageName!,
          depMod.moduleName!,
          plugDirectoryPath[0]
        );

        const sharedHelperSourcePath = this.fileSystemService.join(depMod.basePath, plugDirectoryPath[0], plugDirectoryPath[1]);
        if (await this.fileSystemService.directoryExists(sharedHelperSourcePath)) {
          await this.fileSystemService.ensureDirectory(sharedHelperDistPath);

          try {
            await this.fileSystemService.createDirLink(`${sharedHelperDistPath}/${plugDirectoryPath[1]}`, sharedHelperSourcePath);
          } catch (error: any) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  /**
   * copy template config to .gah folder
   */
  private async copyConfigFiles(module: GahModuleData, fileName: string) {
    const configTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', fileName);
    const configDistFilePath = this.fileSystemService.join(module.basePath, fileName);

    if (await this.fileSystemService.fileExists(configDistFilePath)) {
      await this.fileSystemService.deleteFile(configDistFilePath);
    }

    try {
      await this.fileSystemService.copyFile(configTemplatePath, module.basePath);
    } catch (error: any) {
      this.loggerService.error(error);
    }
  }

  /**
   * add modules to config -> projects array
   */
  private async generatePlaywrightProjectsConfig(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        await this.addProjectToPlaywrightConfig(module.basePath, depMod.moduleName as string);
      }
    }
  }

  /**
   * add modules to config -> projects array
   */
  private async addProjectToPlaywrightConfig(path: string, moduleName: string) {
    const playwrightConfigSourcePath = this.fileSystemService.join(path, 'playwright.projects.config.json');
    const pwConfig: Array<any> = await this.fileSystemService.parseFile<Array<any>>(playwrightConfigSourcePath);

    const newProject = {
      name: moduleName,
      testDir: `test/${moduleName}/'`,
      use: {}
    };

    pwConfig.push(newProject);

    await this.fileSystemService.saveObjectToFile(playwrightConfigSourcePath, pwConfig);
  }

  /**
   * generate ts-config.spec in modules for tests
   */
  private async createTsconfigForTestModule(module: GahModuleData) {
    const plugConf = this.getPluginCfgFromModule(module);
    if (plugConf && plugConf.testDirectoryPath) {
      const tsconfigJsonTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'tsconfig.spec.json');
      const tsconfigJsonSourcePath = this.fileSystemService.join(plugConf.testDirectoryPath, 'tsconfig.json');
      if (await this.fileSystemService.fileExists(tsconfigJsonSourcePath)) {
        await this.fileSystemService.deleteFile(tsconfigJsonSourcePath);
      }
      await this.fileSystemService.copyFile(tsconfigJsonTemplatePath, plugConf?.testDirectoryPath!);
      await this.fileSystemService.rename(`${plugConf?.testDirectoryPath!}/tsconfig.spec.json`, tsconfigJsonSourcePath);
      await this.adjustTsConfigBaseUrl(module, plugConf, tsconfigJsonSourcePath);
    }
  }

  /**
   * generate ts-config.spec in host for tests
   */
  private async createTsconfigForTestHost(module: GahModuleData) {
    const tsconfigJsonTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'tsconfig.spec.json');
    const tsconfigJsonSourcePath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    if (await this.fileSystemService.fileExists(tsconfigJsonSourcePath)) {
      await this.fileSystemService.deleteFile(tsconfigJsonSourcePath);
    }
    await this.fileSystemService.copyFile(tsconfigJsonTemplatePath, module.basePath);
  }

  /**
   * add shared helper paths to ts-config.spec
   */
  private async addPathsToTsconfig(module: GahModuleData, allDepModules: GahModuleData[]) {
    let tsConfigPath: string = '';

    if (module.isHost) {
      tsConfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    } else {
      const plugConf = this.getPluginCfgFromModule(module);
      if (plugConf?.testDirectoryPath) {
        tsConfigPath = this.fileSystemService.join(plugConf?.testDirectoryPath!, 'tsconfig.json');
      }
    }

    if (tsConfigPath) {
      const tsConfig = await this.fileSystemService.parseFile<TsConfig>(tsConfigPath);

      allDepModules.forEach(depMod => {
        const plugConf = this.getPluginCfgFromModule(depMod);

        if (plugConf?.sharedHelperPath) {
          let sharedHelperDistPath;
          if (module.isHost) {
            sharedHelperDistPath = this.fileSystemService.join(
              'test',
              depMod.packageName!,
              depMod.moduleName!,
              plugConf.sharedHelperPath
            );
          } else {
            sharedHelperDistPath = this.fileSystemService.join(
              module.srcBasePath,
              '.gah/test',
              depMod.packageName!,
              depMod.moduleName!,
              plugConf.sharedHelperPath
            );
          }
          tsConfig.compilerOptions.paths[`@${depMod.packageName}/${depMod.moduleName}/test`] = [
            sharedHelperDistPath,
            '[gah] This property was generated by gah/e2e-plugin'
          ];
        }
      });
      await this.fileSystemService.saveObjectToFile(tsConfigPath!, tsConfig);
    }
  }

  /**
   * tsconfig add baseUrl relativePath
   */
  private async adjustTsConfigBaseUrl(module: GahModuleData, plugConf: E2eConfig, tsConfigPath: string) {
    const tsConfig = await this.fileSystemService.parseFile<TsConfig>(tsConfigPath);
    const relativePath = await this.fileSystemService.ensureRelativePath(
      module.basePath,
      `${module.basePath}/${plugConf.testDirectoryPath}`
    );
    const baseUrl = `./${relativePath}/`;
    tsConfig.compilerOptions.baseUrl = baseUrl;
    await this.fileSystemService.saveObjectToFile(tsConfigPath!, tsConfig);
  }

  /**
   * add packages to package.json
   */
  private editPkgJson(pkgJson: PackageJson) {
    const allPackagesWithVersions = Object.keys(e2ePackages).map(pkgName => {
      return { name: pkgName, version: e2ePackages[pkgName] };
    });
    if (this.cfg && this.cfg.e2ePackages) {
      allPackagesWithVersions.push(
        ...Object.keys(this.cfg.e2ePackages).map(pkgName => {
          return { name: pkgName, version: this.cfg.e2ePackages[pkgName] };
        })
      );
    }

    allPackagesWithVersions.forEach(x => {
      pkgJson.devDependencies![x.name] = x.version;
    });
  }
}
