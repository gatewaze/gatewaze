// @ts-nocheck
import { forwardRef } from 'react';
const Box = forwardRef<HTMLDivElement, any>(({ as: Component = 'div', ...props }, ref) => (
  <Component ref={ref} {...props} />
));
Box.displayName = 'Box';
export { Box };
