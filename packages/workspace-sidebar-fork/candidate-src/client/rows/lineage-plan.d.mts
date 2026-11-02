export type LineageRow = { id:string, parentId:string|null, rowKey:string, parentKey:string|null, level:number, title:string, ambiguous:boolean, archived:boolean, external:boolean, unknownMode:boolean, expandable:boolean, expanded:boolean, target:null|{ parentSessionId:string, childSessionId:string, mode:'one-shot'|'continuable' } };
export function canInspectScope(input:{rootId:string,scopeRootIds:readonly string[],list:unknown}):boolean;
export function duplicateWorkspaceRoots(workspaces:unknown):Set<string>|null;
export function planLineage(input:{rootId:string,scopeRootIds:readonly string[],list:unknown,expanded:Set<string>,archived:Set<string>,statuses:unknown,archivedFilter:string}):LineageRow[];
