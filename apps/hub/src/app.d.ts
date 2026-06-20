declare global {
  namespace App {
    interface Error {
      message: string;
    }
  }
}

declare module '*.wasm?url' {
  const src: string;
  export default src;
}

export {};
