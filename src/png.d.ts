// An image imported `with { type: 'file' }`: its path, which `bun build --compile` embeds.
declare module '*.png' {
  const path: string;
  export default path;
}
