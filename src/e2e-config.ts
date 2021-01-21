import { GahPluginConfig } from '@gah/shared';

export class E2eConfig extends GahPluginConfig {
  public isConfigured: boolean;
  public testDirectoryPath: string;
  public sharedHelperPath: string;
  public sharedHelperAliasName: string;
  public e2ePackages: {[key: string]: string};
}
