// pdf.js, its worker, decoders and fonts imported `with { type: 'file' }` (src/server/pdfjs.ts): their paths, which `bun build --compile` embeds.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  const path: string;
  export default path;
}
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  const path: string;
  export default path;
}
declare module 'pdfjs-dist/wasm/*' {
  const path: string;
  export default path;
}
declare module 'pdfjs-dist/standard_fonts/*' {
  const path: string;
  export default path;
}
