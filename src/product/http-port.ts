import type { IncomingMessage, ServerResponse } from 'node:http'
export interface RouteContext {
 webServer: {readonly port:number;register(route:{kind:'prefix';path:string;handler(req:IncomingMessage,res:ServerResponse):void|Promise<void>}):()=>void}
}
