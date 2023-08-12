import { bar } from './bar.js'
export const foo = (wut: string = bar): string => `foo${wut}`
export type Foo<T> = () => T
