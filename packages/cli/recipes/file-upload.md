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

`ctx.files(ids)` returns the files this user may use: uploaded through this link, or through their earlier links to the same surface. Compare lengths, so an ID from anyone else is refused.

```ts
photos_added: async ({ photos }, ctx) => {
  const files = await ctx.files(photos);
  if (files.length !== photos.length) throw new SurfaceError("unknown_photo", "A photo isn't from this screen");
  if (files.length === 0) throw new SurfaceError("photos_required", "Damaged items need at least one photo");
  return saveDraft(id, ctx.subject, { photos: files.map((f) => ({ id: f.id, name: f.name })) }, "pickup");
},
```

The photos to show go in `data`, so they're there after a reload or when the agent sends a new link: the draft's photos, plus anything uploaded through this link since.

```ts
resolve: async ({ id }, ctx) => {
  const r = load(id, ctx.subject);
  const saved = await ctx.files(r.draft.photos.map((p) => p.id));
  const fresh = (await ctx.files()).filter((f) => !saved.some((s) => s.id === f.id));
  return { ...r, uploaded: [...saved, ...fresh].map((f) => ({ id: f.id, name: f.name })) };
},
```

## Screen

The `photo-picker` part does the screen side: a camera button and a gallery button, thumbnails with remove, a placeholder while uploading, and the same type, size and count checks as the server, with a message in the user's language when a photo is refused.

```bash
npx ui-calling add photo-picker
```

```tsx
import { PhotoPicker } from "./parts/photo-picker";

const { upload, removeFile, fileUrl, locale } = useSurface(orderReturn);
const [photos, setPhotos] = useState(data.uploaded);

<PhotoPicker
  slot={orderReturn.files!.photos}
  photos={photos}
  onChange={setPhotos}
  upload={(file) => upload("photos", file)} // the slot name is typed
  remove={removeFile}
  fileUrl={fileUrl}
  locale={locale}
/>

// On Continue, report them with the step's event:
await emit("photos_added", { photos: photos.map((p) => p.id) });
```

By hand: `upload("photos", file)` returns `{ id, name, type, size }` or throws `SurfaceActionError` with `code: "invalid_file"` and a `reason` (`file_too_large`, `file_type_not_allowed`, `too_many_files`, `empty_file`); `fileUrl(id)` is the `<img src>`; `removeFile(id)` deletes it. An `<input type="file" capture="environment">` opens the camera on a phone.

## Watch out

- **Uploading records no event.** The step that uses the files reports them, so the agent reads "attached 2 photos", not one line per upload.
- **`image/*` never matches SVG,** which can carry scripts. Files are served only to links of the user who uploaded them, for the same surface, with `nosniff` and a sandboxing CSP.
- **Next.js serves GET, POST and DELETE** on the API route; `init` writes all three. Without DELETE, removing a photo fails.
- **Big files:** `sqliteStore()` keeps files as blobs in the same database, fine for photos on one machine. For more, implement `putFile`, `getFile`, `listFiles` and `deleteFile` on object storage.

## In the UI_calling repo

Not in the package; for reading if you have the repo.


- Contract and handler: [`order-return.surface.ts`](../../../apps/demo/src/components/ui-calling/order-return.surface.ts), [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts)
- Screen: the photos step in [`order-return.tsx`](../../../apps/demo/src/components/ui-calling/order-return.tsx)
- Proof: "photos upload through the link" in [`smoke.ts`](../../../apps/demo/server/smoke.ts), and the file checks in [`test-runtime.ts`](../../../scripts/test-runtime.ts)
