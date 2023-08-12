import { foo } from './foo.js'
import { bar } from './bar.js'
import test from './test.js'

import type { Foo } from './foo.js'
import type { Bar } from './bar.js'

const fooBar: Foo<Bar> = () => {
  return `${foo(bar)}`
}
export default test
export { fooBar }
