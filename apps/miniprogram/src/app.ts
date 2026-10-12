import { LocalClient } from './local/client';
import { Appearance } from './lib/appearance';
App({ client: new LocalClient(wx), appearance: new Appearance(wx) });
