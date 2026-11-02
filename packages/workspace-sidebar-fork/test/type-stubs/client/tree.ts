import type {SessionId} from '@deepseek-ai/dsh-session/types';
export type SessionNode={id:SessionId,title:string,blank:boolean};
export type SessionRowState={archivedSessionIds:readonly SessionId[],archivedFilter:'default'|'show'|'only'};
