import { GahPlugin, GahPluginConfig } from '@awdware/gah-shared';

import { TemplateConfig } from './template-config';

/**
 * A gah plugin has to extend the abstract GahPlugin base class and implement the abstract methods.
 */
export class TemplatePlugin extends GahPlugin {
  constructor() {
    // Call the constructor with the name of the plugin (only used for logging, does not need to match the package name)
    super('TemplatePlugin');
  }

  /**
   * Called after adding the plugin with gah. Used to configure the plugin.
   * @param existingCfg This will be passed by gah and is used to check wheter a property is already configured or not
   */
  public async onInstall(existingCfg: TemplateConfig): Promise<GahPluginConfig> {
    // Create a new instance of the plugin configuration
    const newCfg = new TemplateConfig();

    // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
    newCfg.someSetting = await this.promptService.input({
      msg: 'Please enter a string configuration property',
      default: 'default value',
      enabled: () => !(existingCfg?.someSetting),
      validator: (val: string) => val.endsWith('.json')
    }) ?? existingCfg.someSetting; // Defaults back to the old value in case undefined gets returned

    // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
    newCfg.somePathSetting = await this.promptService.fuzzyPath({
      msg: 'Please enter a (fuzzy)path configuration property',
      default: 'test/directory',
      enabled: () => !(existingCfg?.somePathSetting),
      itemType: 'file'
    }) ?? existingCfg.somePathSetting; // Defaults back to the old value in case undefined gets returned

    // Ask the user for configuration after installing the plugin. ONLY if the values do not exist yet!
    newCfg.someArraySetting = await this.promptService.checkbox({
      msg: 'Please enter a (fuzzy)path configuration property',
      default: 'test/directory',
      enabled: () => !(existingCfg?.someArraySetting),
      choices: () => ['Option1', 'Option2', 'Option3', 'Option4', 'Option5']
    }) ?? existingCfg.someArraySetting; // Defaults back to the old value in case undefined gets returned

    // Return the new (or maybe unchanged) config back to gah for saving!
    return newCfg;
  }

  /**
   * Called everytime gah gets used for all configured plugins. Register your handlers here.
   */
  public onInit() {
    // Register a handler that gets called synchronously if the corresponding event occured. Some events can be called multiple times!
    this.registerEventListener('INSTALL_STARTED', (event) => {
      // Some example logic that does not really do anything:
      if (!event.gahFile?.isHost) {
        return;
      }
      this.loggerService.log(`${this.cfg.someSetting} --> ${event.gahFile?.modules[0].moduleName!}`);
    });

    this.registerEventListener('FINISHED_MODULE_INSTALL', (event) => {
      // Some example logic that does not really do anything:
      if (!event.module?.isEntry) {
        return;
      }
      this.loggerService.log(`entry module: ${event.module.moduleName!}`);
    });

    this.registerCommandHandler('example', (args) => {
      this.loggerService.error('This command has yet to be implemented ¯\\_(ツ)_/¯');
      this.loggerService.error(args[0]);
      return true;
    });
  }

  /**
   * For convenience the correctly casted configuration
   */
  private get cfg() {
    return this.config as TemplateConfig;
  }
}
