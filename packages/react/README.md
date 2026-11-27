# @ui-calling/react

React bindings for ui-calling screens: typed data and events from the contract, and lifecycle tracking (opened, left, completed) for free.

```tsx
import { SurfaceProvider, useSurface } from "@ui-calling/react";

<SurfaceProvider token={token} returnUrl="https://wa.me/<your number>">
  <ShiftPicker />
</SurfaceProvider>

function ShiftPicker() {
  const { status, data, emit, complete } = useSurface(shiftPicker);
  // ...
}
```

Also `useSurfaceSteps` (steps in the browser's history) and `useSurfaceSession` (route between screens). `npx ui-calling new <name>` writes a screen that handles every state; the guide: `npx ui-calling guide designing`.
