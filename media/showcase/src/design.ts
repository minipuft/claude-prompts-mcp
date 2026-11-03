import {loadFont} from '@remotion/fonts';
import {cancelRender, staticFile} from 'remotion';

export const palette = {ink: '#111715', paper: '#F5F7F6', route: '#2A8F83', gate: '#E3A63B', muted: '#B9C4C0', rule: '#35413C'};
export const fonts = {sans: 'Instrument Sans', mono: 'IBM Plex Mono'};
for (const weight of ['400', '600', '700']) {
  void loadFont({family: fonts.sans, url: staticFile(`fonts/instrument-sans-latin-${weight}-normal.woff2`), weight}).catch(cancelRender);
}
void loadFont({family: fonts.mono, url: staticFile('fonts/ibm-plex-mono-latin-400-normal.woff2'), weight: '400'}).catch(cancelRender);
