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
    super('TemplatePlugin');
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
        msg: 'Please enter a (fuzzy) path to your test directory',
        default: 'test/specs',
        enabled: () => !(existingCfg?.testDirectoryPath),
        itemType: 'directory',
      }) ?? existingCfg?.testDirectoryPath; // Defaults back to the old value in case undefined gets returned

      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.sharedHelperPath = await this.promptService.fuzzyPath({
        msg: 'Please enter a (fuzzy) path to your test helper file (optional)',
        default: 'test/public-test.ts',
        enabled: () => !(existingCfg?.sharedHelperPath),

        itemType: 'file',
        optional: true
      }) ?? existingCfg?.sharedHelperPath; // Defaults back to the old value in case undefined gets returned

      // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
      newCfg.sharedHelperAliasName = await this.promptService.input({
        msg: 'Please enter the helper alias name for the tsconfig.json',
        default: '@projectname/test',
        enabled: () => !(existingCfg?.sharedHelperAliasName) && Boolean(newCfg?.sharedHelperPath)
      }) ?? existingCfg?.sharedHelperAliasName; // Defaults back to the old value in case undefined gets returned
    }
    return newCfg;
  }

  /**
   * Called everytime gah gets used for all configured plugins. Register your handlers here.
   */
  public onInit() {
    // Register a handler that gets called synchronously if the corresponding event occured. Some events can be called multiple times!
    this.registerEventListener('TS_CONFIG_ADJUSTED', (event) => {
      if (event.module === undefined) {
        return;
      }

      if (event.module?.isHost) {
        this.createTsconfigForTest();
      }

      this.addPathsToTsconfig(event.module);

      this.loggerService.log(`tsconfig.spec.json generated`);
    });

    this.registerEventListener('ASSETS_COPIED', (event) => {
      if (event.module === undefined) {
        return;
      }

      if (!event.module?.isHost) {
        return;
      }

      this.linkTestFiles(event.module);
      this.generateMainAvaConfig();
      this.generateModuleAvaConfig(event.module);
      this.loggerService.log(`entry module: ${event.module?.moduleName!}`);
    });

    this.registerEventListener('DEPENDENCIES_MERGED', (event) => {
      if (event.module === undefined) {
        return;
      }

      if (!event.module?.isHost) {
        return;
      }
      this.editPkgJson(event.module);
      this.loggerService.log(`Package.json adjusted for tests`);
    });
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
    const filterdModules = allModules.filter(mod => mod.gahConfig.plugins?.find(plug => { plug.name = '@gah/e2e-plugin' })?.settings.enabled)
    return filterdModules;
  }

  private collectAllReferencedModules(module: GahModuleData, allModules: GahModuleData[]) {
    if (allModules.indexOf(module) === -1) {
      allModules.push(module);
    }
    module.dependencies.forEach(dep => {
      this.collectAllReferencedModules(dep, allModules);
    });
  }

  private createTsconfigForTest() {
    const destinationFolder = './.gah';
    const tsconfigJsonTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'tsconfig.spec.json');
    this.fileSystemService.copyFile(tsconfigJsonTemplatePath, destinationFolder);
  }

  private addPathsToTsconfig(module: GahModuleData) {
    let tsconfigPath: string;

    if (module.isHost) {
      tsconfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.spec.json');
    } else {
      tsconfigPath = this.fileSystemService.join(module.basePath, 'tsconfig.json');
    }
    const tsConfig = this.fileSystemService.parseFile<TsConfig>(tsconfigPath);

    const allModules = this.allFilterdRecursiveDependencies(module.dependencies);
    allModules.forEach(mod => {
      const plugConf = mod.gahConfig.plugins?.find(plug => { plug.name === '@gah/e2e-plugin' })?.settings as E2eConfig;
      if (plugConf) {
        const relativePath = plugConf.sharedHelperPath;
        tsConfig.compilerOptions.paths[plugConf.sharedHelperAliasName] = [relativePath, '[gah] This property was generated by gah/e2e-plugin'];
      }
    });

    this.fileSystemService.saveObjectToFile(tsconfigPath, tsConfig);
  }

  private async linkTestFiles(hostModule: GahModuleData) {
    const allModules = this.allFilterdRecursiveDependencies(hostModule.dependencies);
    await allModules.forEach(async depMod => {
      const plugConf = depMod.gahConfig.plugins?.find(plug => { plug.name === '@gah/e2e-plugin' })?.settings as E2eConfig;
      if (plugConf) {
        const testsDirectoryPath = this.fileSystemService.join(depMod.basePath, plugConf.testDirectoryPath);
        // Linking tests
        if (this.fileSystemService.directoryExists(testsDirectoryPath)) {
          const hostTestsFolder = this.fileSystemService.join(hostModule.basePath, hostModule.srcBasePath, 'test', depMod.moduleName!);
          await this.fileSystemService.createDirLink(hostTestsFolder, testsDirectoryPath);
        }
      }
    });
  }

  private generateMainAvaConfig() {
    const destinationFolder = './.gah';
    const avaMainConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'ava.config.cjs');
    this.fileSystemService.copyFile(avaMainConfigTemplatePath, destinationFolder);
  }

  private generateModuleAvaConfig(hostModule: GahModuleData) {
    const allModules = this.allFilterdRecursiveDependencies(hostModule.dependencies);
    allModules.forEach(depMod => {
      const plugConf = depMod.gahConfig.plugins?.find(plug => { plug.name === '@gah/e2e-plugin' })?.settings as E2eConfig;
      if (plugConf) {
        const path = this.createModuleAvaConfig(depMod.moduleName as string);
        this.editModuleAvaConfig(path, depMod.moduleName as string, plugConf);
      }
    });

  }

  private createModuleAvaConfig(moduleName: string) {
    const destinationFolder = './.gah';
    const avaModukeConfigTemplatePath = this.fileSystemService.join(__dirname, '..', 'assets', 'template.ava.config.cjs');
    this.fileSystemService.copyFile(avaModukeConfigTemplatePath, destinationFolder);
    const oldTemplatePath = this.fileSystemService.join('.', '.gah', 'template.ava.config.cjs');
    const newTemplatePath = this.fileSystemService.join('.', '.gah', moduleName + '.ava.config.cjs');
    this.fileSystemService.rename(oldTemplatePath, newTemplatePath)
    return newTemplatePath;
  }

  private editModuleAvaConfig(path: string, moduleName: string, config: E2eConfig) {
    const avaConfig = this.fileSystemService.parseFile<AvaModuleConfig>(path);

    avaConfig.files = ['test/' + moduleName + '/' + config.testDirectoryPath + '/**/*']

    this.fileSystemService.saveObjectToFile(path, avaConfig);
  }

  private editPkgJson(hostModule: GahModuleData) {
    const pkgJsonPath = this.fileSystemService.join(hostModule?.basePath, 'package.json');
    const pkgJson = hostModule?.packageJson;

    const allPackagesWithVersions = Object.keys(e2ePackages).map(pkgName => { return { name: pkgName, version: e2ePackages[pkgName] }; });
    if (this.cfg && this.cfg.e2ePackages) {
      allPackagesWithVersions.push(...Object.keys(this.cfg.e2ePackages).map(pkgName => { return { name: pkgName, version: this.cfg.e2ePackages[pkgName] }; }));
    }

    allPackagesWithVersions.forEach(x => {
      pkgJson.dependencies![x.name] = x.version;
    });

    this.fileSystemService.saveObjectToFile(pkgJsonPath, pkgJson);
  }
}
