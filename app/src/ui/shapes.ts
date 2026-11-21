import type { DesignShape } from '../rules/engine'

/** Shape picker entries: id, label, 24x24 icon path. */
export const SHAPES: [Exclude<DesignShape, 'custom'>, string, string][] = [
  ['rect', 'Box', 'M3 5h18v14H3z'],
  ['circle', 'Round', 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z'],
  ['ellipse', 'Oval', 'M12 6c5.5 0 10 2.7 10 6s-4.5 6-10 6S2 15.3 2 12s4.5-6 10-6z'],
  ['L', 'L', 'M4 3h7v11h9v7H4z'],
  ['hexagon', 'Hex', 'M7 3h10l5 9-5 9H7l-5-9z'],
  ['octagon', 'Oct', 'M8 2h8l6 6v8l-6 6H8l-6-6V8z'],
  ['triangle', 'Tri', 'M12 3l10 18H2z'],
  ['polygon', 'N-sided', 'M12 2l9.5 7-3.6 11H6.1L2.5 9z'],
]
