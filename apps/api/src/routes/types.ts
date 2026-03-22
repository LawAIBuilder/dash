export type CaseRouteReply = {
  code: (statusCode: number) => { send: (body: unknown) => unknown };
};

export type HeaderRouteReply = CaseRouteReply & {
  header: (name: string, value: string | number) => unknown;
};

export type StreamingRouteReply = HeaderRouteReply & {
  send: (body: unknown) => unknown;
};
