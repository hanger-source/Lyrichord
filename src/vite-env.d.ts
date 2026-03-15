/// <reference types="vite/client" />

declare module '*.tmd?raw' {
  const content: string;
  export default content;
}

declare module '*.sf2' {
  const url: string;
  export default url;
}

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string, params?: any[]): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(params?: any): Record<string, any>;
    get(params?: any[]): any[];
    free(): boolean;
    reset(): void;
  }
  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}
