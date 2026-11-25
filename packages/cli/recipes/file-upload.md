# Photo or file upload

Use it when the user has to send proof: a photo of a damaged item, a receipt, an ID document.

Full example: the photos step of the demo's `order_return`.

## Contract

Declare a slot. The screen uploads into it; the event only carries file IDs.

```ts
defineSurface({
  // ...
  files: { photos: { accept: ["image/*"], maxBytes: 8 * 1024 * 1024, maxFiles: 5 } },
  events: {
    photos_added: event(z.object({ photos: z.array(z.string()).max(5) }), {
      describe: (p) => `Step 3 of 5: attached ${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}`,
    }),
  },
});
```

The store must keep files: `sqliteStore()` and the in-memory store do. `createUiCalling` refuses to start otherwise.

## Server

`ctx.files(ids)` returns only files uploaded through **this** link. Compare lengths, so an ID copied from somewhere else is refused.

```ts
photos_added: async ({ photos }, ctx) => {
  const files = await ctx.files(photos);
  if (files.length !== photos.length) throw new SurfaceError("unknown_photo", "A photo isn't from this screen");
  if (needsPhotos(r) && files.length === 0) throw new SurfaceError("photos_required", "Damaged items need at least one photo");
  return saveDraft(r.orderId, ctx.subject, { photos: files.map((f) => ({ id: f.id, name: f.name })) }, "pickup");
},
```

To show uploads again after a reload, add them to the data in `resolve`: `uploaded: (await ctx.files()).map((f) => ({ id: f.id, name: f.name }))`.

## Screen

```tsx
const { upload, removeFile, fileUrl } = useSurface(orderReturn);
const PHOTOS = orderReturn.files!.photos;

async function addPhoto(file: File) {
  // Check here too, so the user doesn't wait for an upload the server would refuse.
  if (!file.type.startsWith("image/")) return setProblem(t.errors.file_type_not_allowed);
  if (file.size > PHOTOS.maxBytes) return setProblem(t.errors.file_too_large);
  try {
    const ref = await upload("photos", file); // the slot name is typed
    setPhotos((p) => [...p, { id: ref.id, name: ref.name }]);
  } catch (err) {
    const reason = err instanceof SurfaceActionError ? err.reason : undefined; // file_too_large, too_many_files, ...
    setProblem((reason && t.errors[reason]) || t.offline);
  }
}

<input type="file" accept="image/*" multiple onChange={(e) => e.target.files && [...e.target.files].forEach(addPhoto)} />
<img src={fileUrl(photo.id)} alt={photo.name} />
<button onClick={() => removeFile(photo.id)}>Remove</button>
```

`accept="image/*"` on a phone offers the camera directly.

## Watch out

- **Uploading records no event.** The step that uses the files reports them, so the agent reads "attached 2 photos", not one line per upload.
- **`image/*` never matches SVG,** which can carry scripts. Files are served only through their own link, with `nosniff` and a sandboxing CSP.
- **Big files:** `sqliteStore()` keeps files as blobs in the same database, fine for photos on one machine. For more, implement `putFile`, `getFile`, `listFiles` and `deleteFile` on object storage.

## In the repo

- Contract and handler: [`order-return.surface.ts`](../../../apps/demo/src/components/ui-calling/order-return.surface.ts), [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts)
- Screen: `addPhotos` in [`order-return.tsx`](../../../apps/demo/src/components/ui-calling/order-return.tsx)
- Proof: "photos upload through the link" in [`smoke.ts`](../../../apps/demo/server/smoke.ts), and the file checks in [`test-runtime.ts`](../../../scripts/test-runtime.ts)
