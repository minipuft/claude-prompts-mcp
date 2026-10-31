import type {CSSProperties, PropsWithChildren} from 'react';
import {roleVars, type RoleMap} from './tokens';

type Props = PropsWithChildren<{roles: RoleMap; outline: string; x: number; y: number; scale?: number; style?: CSSProperties}>;

/** Binds a role map to CSS variables and positions a role-filled SVG child. Fills inside name roles, never hex. */
export const Sprite: React.FC<Props> = ({roles, outline, x, y, scale = 1, style, children}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: `scale(${scale})`, transformOrigin: 'top left', ...roleVars(roles, outline), ...style}}>
    {children}
  </div>
);
