/// <reference types="vite/client" />

declare module '*.tmd?raw' {
  const content: string;
  export default content;
}

declare module '*.sf2' {
  const url: string;
  export default url;
}
