/**
 * The backend a drawing was made on (D98, p003): the browser and the WebGL renderer behind it. The light layer is a shader, so its bytes are a function of the GPU path as well as of its inputs
 * (SwiftShader, ANGLE and a hardware driver round the same float differently); the render manifest records this name and hashes it into the layer, so a drawing cached on one backend is not reused on another.
 * `BackendProbe` is a composition with no picture whose `calculateMetadata` runs in the page and hands the answer to node through the resolved props.
 */
export type Backend = {userAgent: string; renderer: string; vendor: string; version: string; floatTargets: boolean; name: string};

export const probeBackend = (): Backend => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('backend: the browser gives no WebGL2 context, which the light layer needs');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const vendor = String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  const userAgent = navigator.userAgent;
  return {userAgent, renderer, vendor, version: String(gl.getParameter(gl.VERSION)), floatTargets: gl.getExtension('EXT_color_buffer_float') !== null, name: `${userAgent} | ${renderer}`};
};

export const BackendProbe: React.FC<{backend: Backend | null}> = () => null;
