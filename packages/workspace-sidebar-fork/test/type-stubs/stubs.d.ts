declare namespace JSX { interface IntrinsicElements { [name:string]: any } }
declare module 'react' {
 export type ReactNode=unknown;
 export type MouseEvent<T>={stopPropagation():void,currentTarget:T};
 export const Fragment:any;
 export function useEffect(f:()=>void|(()=>void), deps:unknown[]):void;
 export function useLayoutEffect(f:()=>void|(()=>void)):void;
 export function useRef<T>(value:T):{current:T};
 export function useState<T>(v:T|(()=>T)):[T,(value:T|((p:T)=>T))=>void];
}
declare module 'react/jsx-runtime' { export const jsx:any; export const jsxs:any; export const Fragment:any }
declare module '@deepseek-ai/dsh-api-session-controller/client' { export type SessionListState=unknown }
declare module '@deepseek-ai/dsh-session/types' { export type SessionId=string & {readonly __brand:'SessionId'} }
