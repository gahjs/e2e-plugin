import { GahModuleData, GahModuleType, GahPlugin, GahPluginConfig, PackageJson, TsConfig } from '@gah/shared';
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
    const isHost = await this.configurationService.getGahModuleType() === GahModuleType.HOST;

    if (!isHost) {
      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.testDirectoryPath = await this.promptService.fuzzyPath({
        msg: 'Please enter a (fuzzy) path to your test directory (press enter to skip)',
        default: 'test/specs',
        enabled: () => !(existingCfg?.testDirectoryPath),
        itemType: 'directory',
        optional: true
      }) ?? existingCfg?.testDirectoryPath; // Defaults back to the old value in case undefined gets returned

      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.sharedHelperPath = await this.promptService.fuzzyPath({
        msg: 'Please enter a (fuzzy) path to your test helper file (press enter to skip)',
        enabled: () => !(existingCfg?.sharedHelperPath),
        itemType: 'file',
        optional: true
      }) ?? existingCfg?.sharedHelperPath; // Defaults back to the old value in case undefined gets returned

      if (newCfg.testDirectoryPath || newCfg.sharedHelperPath) {
        newCfg.isConfiguard = true;
      }
    }
    return newCfg;
  }

  /**
   * Called everytime gah gets used for all configured plugins. Register your handlers here.
   */
  public onInit() {

    this.registerCommandHandler('test', (args) => this.executionService.execute(`yarn ava --config ${args[0]}.ava.config.cjs`, true, undefined, './.gah'));
    // Register a handler that gets called synchronously if the corresponding event occured. Some events can be called multiple times!
    if (this.readData('isInit') !== true) {

      this.registerEventListener('AFTER_GENERATE_SYMLINKS', async (event) => {
        if (event.module === undefined) {
          return;
        }

        if (event.module?.isHost) {
          await this.fileSystemService.deleteFilesInDirectory(this.fileSystemService.join(event.module.basePath, 'test'));
        } else {
          await this.fileSystemService.deleteFilesInDirectory(this.fileSystemService.join(event.module.srcBasePath, '.gah/test'));
        }

        this.loggerService.log('test folder cleaned');

        // After here only necessary for host
        if (!event.module?.isHost) {
          return;
        }
        const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

        await this.linkTestFiles(event.module, allDepModules);
        await this.generateMainAvaConfig(event.module);
        await this.generateModuleAvaConfig(event.module, allDepModules);
        this.loggerService.log(`entry module: ${event.module?.moduleName!}`);
      });

      this.registerEventListener('BEFORE_ADJUST_TS_CONFIG', async (event) => {
        if (event.module === undefined) {
          return;
        }

        const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

        if (event.module?.isHost) {
          await this.createTsconfigForTest(event.module);
        }

        await this.addPathsToTsconfig(event.module, allDepModules, event.tsConfig);
        await this.linkSharedTestFolder(event.module, allDepModules);

        this.loggerService.log('tsconfig.spec.json generated');
      });

      this.registerEventListener('BEFORE_MERGE_DEPENDENCIES', (event) => {
        if (event.module === undefined) {
          return;
        }

        this.editPkgJson(event.pkgJson);
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

  private allFilterdRecursiveDependencies(dependencies: GahModuleData[]): GahModuleData[] {
    const allModules = new Array<GahModuleData>();
    dependencies.forEach(dep => {
      this.collectAllReferencedModules(dep, allModules);
    });
    const filterdModules = allModules.filter(mod => this.getPluginCfgFromModule(mod));
    return filterdModules;
  }

  private getPluginCfgFromModule(module: GahModuleData): E2eConfig | undefined {
    let pluginCfg; E2eConfig;
    module.pluginCfg?.['@gah/e2e-plugin']?.forEach(cfg => {
      if (cfg.isConfiguard) {
        pluginCfg = cfg;
      }
    });
    return pluginCfg;
  }

  private collectAllReferencedModules(module: GahModuleData, allModules: GahModuleData[]) {
    if (!allModules.some(m => m.moduleName === module.moduleName)) {
      allModules.push(module);
    }

    module.dependencies.forEach(dep => {
      this.collectAllReferencedModules(dep, allModules);
    });
  }

  private async createTsconfigForTest(module: GahModuleData) {
    const tsconfigJsonTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'tsconfig.spec.json');
    const tsconfigJsonSourcePath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    if (await this.fileSystemService.fileExists(tsconfigJsonSourcePath)) {
      await this.fileSystemService.deleteFile(tsconfigJsonSourcePath);
    }
    await this.fileSystemService.copyFile(tsconfigJsonTemplatePath, module.basePath);
  }

  private async addPathsToTsconfig(module: GahModuleData, allDepModules: GahModuleData[], moduleTsConfig?: TsConfig) {
    let tsConfigPath: string;
    let tsConfig: TsConfig;
    if (module.isHost) {
      tsConfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
      tsConfig = await this.fileSystemService.parseFile<TsConfig>(tsConfigPath);
    } else {
      tsConfig = moduleTsConfig!;
    }


    allDepModules.forEach(depMod => {
      const plugConf = this.getPluginCfgFromModule(depMod);

      if (plugConf?.sharedHelperPath) {
        let sharedHelperDistPath;
        if (module.isHost) {
          sharedHelperDistPath = this.fileSystemService.join('test', depMod.packageName!, depMod.moduleName!, plugConf.sharedHelperPath);
        } else {
          sharedHelperDistPath = this.fileSystemService.join(module.srcBasePath, '.gah/test', depMod.packageName!, depMod.moduleName!, plugConf.sharedHelperPath);
        }
        tsConfig.compilerOptions.paths[`@${depMod.packageName}/${depMod.moduleName}/test`] = [sharedHelperDistPath, '[gah] This property was generated by gah/e2e-plugin'];
      }
    });
    if (module.isHost) {
      await this.fileSystemService.saveObjectToFile(tsConfigPath!, tsConfig);
    }
  }

  private async linkSharedTestFolder(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.sharedHelperPath) {
        let sharedHelperDistPath;
        const plugDirectoryPath = this.extractDirectoryFromPluginPath(plugConf.sharedHelperPath);

        if (module.isHost) {
          sharedHelperDistPath = this.fileSystemService.join(module.basePath, '/test', depMod.packageName!, depMod.moduleName!, plugDirectoryPath[0]);
        } else {
          sharedHelperDistPath = this.fileSystemService.join(module.srcBasePath, '.gah/test', depMod.packageName!, depMod.moduleName!, plugDirectoryPath[0]);
        }

        const sharedHelperSourcePath = this.fileSystemService.join(depMod.basePath, plugDirectoryPath[0], plugDirectoryPath[1]);
        if (await this.fileSystemService.directoryExists(sharedHelperSourcePath)) {
          await this.fileSystemService.ensureDirectory(sharedHelperDistPath);
          try {
            await this.fileSystemService.createDirLink(`${sharedHelperDistPath}/${plugDirectoryPath[1]}`, sharedHelperSourcePath);
          } catch (error) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  private extractDirectoryFromPluginPath(plugPath: string): string[] {
    const pathArray = plugPath.split('/');
    pathArray.pop(); // remove index file
    const lastFolder = pathArray.pop();
    return [pathArray.join('/'), lastFolder!];
  }

  private async linkTestFiles(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        const sourceTestDirectoryPath = this.fileSystemService.join(depMod.basePath, plugConf.testDirectoryPath);

        if (await this.fileSystemService.directoryExists(sourceTestDirectoryPath)) {

          const distTestFolder = this.fileSystemService.join(module.basePath, 'test');
          await this.fileSystemService.ensureDirectory(distTestFolder);
          try {
            await this.fileSystemService.createDirLink(`${distTestFolder}/${depMod.moduleName!}`, sourceTestDirectoryPath);
          } catch (error) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  private async generateMainAvaConfig(module: GahModuleData) {
    const avaMainConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'ava.config.cjs');
    const avaMainConfigSourcePath = this.fileSystemService.join(module.basePath, 'ava.config.cjs');
    if (await this.fileSystemService.fileExists(avaMainConfigSourcePath)) {
      await this.fileSystemService.deleteFile(avaMainConfigSourcePath);
    }
    await this.fileSystemService.copyFile(avaMainConfigTemplatePath, module.basePath);
  }

  private async generateModuleAvaConfig(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        const pathToCreatedFile = await this.createModuleAvaConfig(module, depMod.moduleName as string);
        await this.editModuleAvaConfig(pathToCreatedFile, depMod.moduleName as string);
      }
    }
  }

  private async createModuleAvaConfig(module: GahModuleData, moduleName: string) {
    const avaModukeConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'template.ava.config.cjs');
    await this.fileSystemService.copyFile(avaModukeConfigTemplatePath, module.basePath);
    const oldTemplatePath = this.fileSystemService.join(module.basePath, 'template.ava.config.cjs');
    const newTemplatePath = this.fileSystemService.join(module.basePath, `${moduleName}.ava.config.cjs`);
    if (await this.fileSystemService.fileExists(newTemplatePath)) {
      await this.fileSystemService.deleteFile(newTemplatePath);
    }
    await this.fileSystemService.rename(oldTemplatePath, newTemplatePath);
    return newTemplatePath;
  }

  private async editModuleAvaConfig(path: string, moduleName: string) {
    let avaConfig = await this.fileSystemService.readFile(path);

    avaConfig = avaConfig
      .replace('[\'samplePath\']', `['test/${moduleName}/**/*']`)
      .replace('custom-snapshotDir-directory', `test/${moduleName}/snapshots`);

    await this.fileSystemService.saveFile(path, avaConfig);
  }

  private editPkgJson(pkgJson: PackageJson) {
    const allPackagesWithVersions = Object.keys(e2ePackages).map(pkgName => { return { name: pkgName, version: e2ePackages[pkgName] }; });
    if (this.cfg && this.cfg.e2ePackages) {
      allPackagesWithVersions.push(...Object.keys(this.cfg.e2ePackages).map(pkgName => { return { name: pkgName, version: this.cfg.e2ePackages[pkgName] }; }));
    }

    allPackagesWithVersions.forEach(x => {
      pkgJson.devDependencies![x.name] = x.version;
    });
  }
}
