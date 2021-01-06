import { GahPluginConfig } from '@gah/shared';

export class E2eConfig extends GahPluginConfig {
  public e2ePackages: {[key: string]: string};
  public testDirectoryPath: string;
  public sharedHelperPath: string;
  public sharedHelperAliasName: string;
}
