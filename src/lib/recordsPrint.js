import { signedDocUrl } from "./documents.js";
import { pdfPageImages } from "./auctionDoc.js";

const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

// One stored document as printable page pictures: a photo is one page, a PDF
// is one picture per page. Throws if the file can't be fetched or shown (for
// example an iPhone HEIC photo a desktop browser can't display) — the caller
// lists that document on the cover sheet as "print it from its own View link"
// instead of leaving it out silently.
export async function loadDocumentPages(doc) {
  const url = await signedDocUrl(doc.path, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const blob = await res.blob();
  const isPdf = /pdf/i.test(blob.type) || /\.pdf$/i.test(doc.file_name || "");
  if (isPdf) {
    const { images, total } = await pdfPageImages(blob);
    return { pages: images, total, truncated: total > images.length };
  }
  if (/^image\//i.test(blob.type)) {
    const src = await toDataUrl(blob);
    const img = new Image();
    img.src = src;
    await img.decode();
    return { pages: [src], total: 1, truncated: false };
  }
  throw new Error("unsupported file type");
}
