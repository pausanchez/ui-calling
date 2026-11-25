import { useState } from "react";
import { acceptsType, type FileSlot, type UiFileRef } from "@ui-calling/core";
import { SurfaceActionError } from "@ui-calling/react";

const LABELS = {
  en: {
    camera: "Take a photo",
    gallery: "Choose from gallery",
    remove: "Remove",
    uploading: "Uploading…",
    count: (n: number, max: number) => `${n} of ${max}`,
    file_too_large: "That photo is too big. Try a smaller one.",
    file_type_not_allowed: "That file isn't a photo.",
    too_many_files: "That's the most photos you can add.",
    empty_file: "That file is empty.",
    failed: "That photo didn't upload. Check your connection and try again.",
  },
  es: {
    camera: "Hacer una foto",
    gallery: "Elegir de la galería",
    remove: "Quitar",
    uploading: "Subiendo…",
    count: (n: number, max: number) => `${n} de ${max}`,
    file_too_large: "Esa foto es demasiado grande. Prueba con otra más pequeña.",
    file_type_not_allowed: "Ese archivo no es una foto.",
    too_many_files: "Ya has añadido el máximo de fotos.",
    empty_file: "Ese archivo está vacío.",
    failed: "No se ha podido subir la foto. Comprueba tu conexión e inténtalo de nuevo.",
  },
};
export type PhotoPickerLabels = (typeof LABELS)["en"];

/**
 * Photos for a file slot: take one with the camera or pick from the gallery, see thumbnails, remove one.
 * It checks type, size and count before uploading (the server checks again), and says why a photo was refused.
 *
 *   const { upload, removeFile, fileUrl } = useSurface(orderReturn);
 *   <PhotoPicker slot={orderReturn.files!.photos} photos={photos} onChange={setPhotos}
 *     upload={(f) => upload("photos", f)} remove={removeFile} fileUrl={fileUrl} locale={locale} />
 *
 * Report the photos with the step's event (`emit("photos_added", { photos: photos.map((p) => p.id) })`):
 * uploading alone records nothing for the agent.
 */
export function PhotoPicker({
  slot,
  photos,
  onChange,
  upload,
  remove,
  fileUrl,
  locale,
  labels,
}: {
  slot: FileSlot;
  photos: { id: string; name: string }[];
  onChange: (photos: { id: string; name: string }[]) => void;
  upload: (file: File) => Promise<UiFileRef>;
  remove: (id: string) => Promise<void>;
  fileUrl: (id: string) => string;
  locale?: string;
  labels?: Partial<PhotoPickerLabels>;
}) {
  const t: PhotoPickerLabels = { ...(locale?.startsWith("es") ? LABELS.es : LABELS.en), ...labels };
  const max = slot.maxFiles ?? 1;
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setProblem(null);
    let next = photos;
    for (const file of Array.from(files)) {
      if (next.length + uploading >= max) return setProblem(t.too_many_files);
      if (!acceptsType(slot, file.type)) {
        setProblem(t.file_type_not_allowed);
        continue;
      }
      if (file.size > slot.maxBytes) {
        setProblem(t.file_too_large);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const ref = await upload(file);
        next = [...next, { id: ref.id, name: ref.name }];
        onChange(next);
      } catch (err) {
        const reason = err instanceof SurfaceActionError ? err.reason : undefined;
        const known = reason && reason in t ? (t[reason as keyof PhotoPickerLabels] as string) : undefined;
        setProblem(known ?? t.failed);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function drop(id: string) {
    onChange(photos.filter((p) => p.id !== id));
    void remove(id).catch(() => {});
  }

  const full = photos.length + uploading >= max;
  const pick = "flex h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted";
  const accept = slot.accept.join(",");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <figure key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
            <img src={fileUrl(p.id)} alt={p.name} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => drop(p.id)}
              aria-label={`${t.remove}: ${p.name}`}
              className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-background/90 text-sm shadow"
            >
              ✕
            </button>
          </figure>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className="grid aspect-square animate-pulse place-items-center rounded-md bg-muted text-xs text-muted-foreground">
            {t.uploading}
          </div>
        ))}
      </div>
      {!full && (
        <div className="grid grid-cols-2 gap-2">
          {/* capture opens the camera on phones; the second input picks existing photos. */}
          <label className={pick}>
            {t.camera}
            <input type="file" accept={accept} capture="environment" className="sr-only" onChange={(e) => void add(e.target.files).finally(() => (e.target.value = ""))} />
          </label>
          <label className={pick}>
            {t.gallery}
            <input type="file" accept={accept} multiple={max > 1} className="sr-only" onChange={(e) => void add(e.target.files).finally(() => (e.target.value = ""))} />
          </label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t.count(photos.length, max)}</p>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
