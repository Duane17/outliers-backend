// Augment Node's IncomingMessage so TypeScript knows pino-http sets an `id`.
import "http";

declare module "http" {
  interface IncomingMessage {
    /** Added by pino-http when `genReqId` is provided */
    id?: string;
  }
}
