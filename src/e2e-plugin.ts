import { GahModuleData, GahModuleType, GahPlugin, GahPluginConfig, TsConfig } from '@gah/shared';
import { e2ePackages } from './e2e-packages';

import { E2eConfig } from './e2e-config';
import { AvaModuleConfig } from './models/ava-module-config';

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
    const isHost = this.configurationService.getGahModuleType() === GahModuleType.HOST;

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
    // Register a handler that gets called synchronously if the corresponding event occured. Some events can be called multiple times!
    if (this.readData('isInit') !== true) {


      this.registerEventListener('GAH_FOLDER_CLEANED', (event) => {
        if (event.module === undefined) {
          return;
        }

        if (event.module?.isHost) {
          this.fileSystemService.deleteFilesInDirectory(this.fileSystemService.join(event.module.basePath, 'test'));
        } else {
          this.fileSystemService.deleteFilesInDirectory(this.fileSystemService.join(event.module.srcBasePath, '.gah/test'));
        }

        this.loggerService.log('test folder cleaned');
      });

      this.registerEventListener('TS_CONFIG_ADJUSTED', (event) => {
        if (event.module === undefined) {
          return;
        }

        const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

        if (event.module?.isHost) {
          this.createTsconfigForTest(event.module);
        }

        this.addPathsToTsconfig(event.module, allDepModules);
        this.linkSharedTestFolder(event.module, allDepModules);

        this.loggerService.log('tsconfig.spec.json generated');
      });

      this.registerEventListener('SYMLINKS_CREATED', (event) => {
        if (event.module === undefined) {
          return;
        }

        if (!event.module?.isHost) {
          return;
        }
        const allDepModules = this.allFilterdRecursiveDependencies(event.module.dependencies);

        this.linkTestFiles(event.module, allDepModules);
        this.generateMainAvaConfig(event.module);
        this.generateModuleAvaConfig(event.module, allDepModules);
        this.loggerService.log(`entry module: ${event.module?.moduleName!}`);
      });

      this.registerEventListener('BEFORE_INSTALL_PACKAGES', (event) => {
        if (event.module === undefined) {
          return;
        }

        this.editPkgJson(event.module);
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

  private createTsconfigForTest(module: GahModuleData) {
    const tsconfigJsonTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'tsconfig.spec.json');
    const tsconfigJsonSourcePath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    if (this.fileSystemService.fileExists(tsconfigJsonSourcePath)) {
      this.fileSystemService.deleteFile(tsconfigJsonSourcePath);
    }
    this.fileSystemService.copyFile(tsconfigJsonTemplatePath, module.basePath);
  }

  private async addPathsToTsconfig(module: GahModuleData, allDepModules: GahModuleData[]) {
    let tsconfigPath: string;

    if (module.isHost) {
      tsconfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    } else {
      tsconfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.json');
    }

    const tsConfig = this.fileSystemService.parseFile<TsConfig>(tsconfigPath);

    allDepModules.forEach(depMod => {
      const plugConf = this.getPluginCfgFromModule(depMod);

      if (plugConf?.sharedHelperPath) {
        let sharedHelperDistPath;
        if (depMod.isHost) {
          sharedHelperDistPath = this.fileSystemService.join(module.basePath, '/test', depMod.packageName!, depMod.moduleName!, plugConf.sharedHelperPath);
        } else {
          sharedHelperDistPath = this.fileSystemService.join(module.srcBasePath, '.gah/test', depMod.packageName!, depMod.moduleName!, plugConf.sharedHelperPath);
        }
        tsConfig.compilerOptions.paths[`@${depMod.packageName}/${depMod.moduleName}/test`] = [sharedHelperDistPath, '[gah] This property was generated by gah/e2e-plugin'];
      }
    });
    this.fileSystemService.saveObjectToFile(tsconfigPath, tsConfig);
  }

  private async linkSharedTestFolder(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.sharedHelperPath) {
        let sharedHelperDistPath;
        const plugDirectoryPath = this.extractDirectoryFromPluginPath(plugConf.sharedHelperPath);

        if (depMod.isHost) {
          sharedHelperDistPath = this.fileSystemService.join(module.basePath, '/test', depMod.packageName!, depMod.moduleName!, plugDirectoryPath);
        } else {
          sharedHelperDistPath = this.fileSystemService.join(module.srcBasePath, '.gah/test', depMod.packageName!, depMod.moduleName!, plugDirectoryPath);
        }

        const sharedHelperSourcePath = this.fileSystemService.join(depMod.basePath, plugDirectoryPath);
        if (this.fileSystemService.directoryExists(sharedHelperSourcePath)) {
          this.fileSystemService.ensureDirectory(sharedHelperDistPath);
          try {
            await this.fileSystemService.createDirLink(sharedHelperDistPath, sharedHelperSourcePath);
          } catch (error) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  private extractDirectoryFromPluginPath(plugPath: string) {
    const pathArray = plugPath.split('/');
    pathArray.pop();
    return pathArray.join('/');
  }

  private async linkTestFiles(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        const sourceTestDirectoryPath = this.fileSystemService.join(depMod.basePath, plugConf.testDirectoryPath);

        if (this.fileSystemService.directoryExists(sourceTestDirectoryPath)) {

          const distTestFolder = this.fileSystemService.join(module.basePath, 'test', depMod.moduleName!);
          this.fileSystemService.ensureDirectory(distTestFolder);
          try {
            await this.fileSystemService.createDirLink(distTestFolder, sourceTestDirectoryPath);
          } catch (error) {
            this.loggerService.error(error);
          }
        }
      }
    }
  }

  private generateMainAvaConfig(module: GahModuleData) {
    const avaMainConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'ava.config.cjs');
    const avaMainConfigSourcePath = this.fileSystemService.join(module.basePath, 'ava.config.cjs');
    if (this.fileSystemService.fileExists(avaMainConfigSourcePath)) {
      this.fileSystemService.deleteFile(avaMainConfigSourcePath);
    }
    this.fileSystemService.copyFile(avaMainConfigTemplatePath, module.basePath);
  }

  private generateModuleAvaConfig(module: GahModuleData, allDepModules: GahModuleData[]) {
    for (const depMod of allDepModules) {
      const plugConf = this.getPluginCfgFromModule(depMod);
      if (plugConf?.testDirectoryPath) {
        const pathToCreatedFile = this.createModuleAvaConfig(module, depMod.moduleName as string);
        this.editModuleAvaConfig(pathToCreatedFile, depMod.moduleName as string, plugConf);
      }
    }
  }

  private createModuleAvaConfig(module: GahModuleData, moduleName: string) {
    const avaModukeConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'template.ava.config.cjs');
    this.fileSystemService.copyFile(avaModukeConfigTemplatePath, module.basePath);
    const oldTemplatePath = this.fileSystemService.join(module.basePath, 'template.ava.config.cjs');
    const newTemplatePath = this.fileSystemService.join(module.basePath, `${moduleName}.ava.config.cjs`);
    if (this.fileSystemService.fileExists(newTemplatePath)) {
      this.fileSystemService.deleteFile(newTemplatePath);
    }
    this.fileSystemService.rename(oldTemplatePath, newTemplatePath);
    return newTemplatePath;
  }

  private editModuleAvaConfig(path: string, moduleName: string, config: E2eConfig) {
    const avaConfig = this.fileSystemService.parseFile<AvaModuleConfig>(path);

    avaConfig.files = [`test/${moduleName}/${config.testDirectoryPath}/**/*`];

    this.fileSystemService.saveObjectToFile(path, avaConfig);
  }

  private editPkgJson(module: GahModuleData) {
    const pkgJsonPath = this.fileSystemService.join(module?.basePath, 'package.json');
    const pkgJson = module?.packageJson;

    const allPackagesWithVersions = Object.keys(e2ePackages).map(pkgName => { return { name: pkgName, version: e2ePackages[pkgName] }; });
    if (this.cfg && this.cfg.e2ePackages) {
      allPackagesWithVersions.push(...Object.keys(this.cfg.e2ePackages).map(pkgName => { return { name: pkgName, version: this.cfg.e2ePackages[pkgName] }; }));
    }

    allPackagesWithVersions.forEach(x => {
      pkgJson.devDependencies![x.name] = x.version;
    });

    this.fileSystemService.saveObjectToFile(pkgJsonPath, pkgJson);
  }
}
