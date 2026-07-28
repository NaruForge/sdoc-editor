export interface DiagramRendererSettings {
  enabled: boolean;
  endpoint: string;
  allowPrivateNetwork: boolean;
}

export const DEFAULT_DIAGRAM_RENDERER_SETTINGS: Readonly<DiagramRendererSettings> = {
  enabled: false,
  endpoint: 'https://kroki.io',
  allowPrivateNetwork: false,
};

export type DiagramRenderFailureCode =
  | 'disabled'
  | 'invalid-endpoint'
  | 'blocked-address'
  | 'source-too-large'
  | 'timeout'
  | 'offline'
  | 'rate-limited'
  | 'server-error'
  | 'redirect'
  | 'response-too-large'
  | 'invalid-response'
  | 'cancelled';
