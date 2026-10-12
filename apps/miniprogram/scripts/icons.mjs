// Reuse the exact Lucide geometry installed for the accepted mobile app.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const names = [
  'layout-dashboard',
  'calendar-days',
  'dumbbell',
  'user-round',
  'droplets',
  'flame',
  'utensils',
  'activity',
  'plus',
  'settings-2',
  'chevron-right',
  'arrow-up-right',
  'arrow-up',
  'camera',
  'mic',
  'sparkles',
  'square',
];
export async function buildIcons(output) {
  const destination = path.join(output, 'assets/icons');
  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, 'license.json'),
    JSON.stringify(
      {
        name: 'Lucide',
        source: 'lucide-react-native',
        license: await readFile(
          path.join(root, 'node_modules/lucide-react-native/LICENSE'),
          'utf8',
        ),
      },
      null,
      2,
    ),
  );
  for (const name of names) {
    const text = await readFile(
      path.join(
        root,
        'node_modules/lucide-react-native/dist/cjs/icons',
        name + '.js',
      ),
      'utf8',
    );
    const data = runInNewContext(
      text.slice(
        text.indexOf('const __iconData ='),
        text.indexOf('__iconData.node;'),
      ) + '\n__iconData',
    );
    for (const [variant, color] of Object.entries({
      green: '#00ED85',
      muted: '#93A69B',
      text: '#F5F7F6',
      dark: '#001A0D',
      blue: '#526FD6',
      slate: '#667498',
      ink: '#25345A',
      white: '#FFFFFF',
    })) {
      const shapes = data.node
        .map(
          ([tag, attributes]) =>
            '<' +
            tag +
            ' ' +
            Object.entries(attributes)
              .filter(([k]) => k !== 'key')
              .map(([k, v]) => k + '="' + v + '"')
              .join(' ') +
            '/>',
        )
        .join('');
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="' +
        color +
        '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        shapes +
        '</svg>';
      await writeFile(
        path.join(destination, name + '-' + variant + '.png'),
        await sharp(Buffer.from(svg)).png().toBuffer(),
      );
    }
  }
}
