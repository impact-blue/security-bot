interface Word {
  [name: string]: string;
}

declare module 'seeds.json' {
  export const words: [Word];
}
