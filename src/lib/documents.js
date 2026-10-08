import { supabase } from "./db.js";

const BUCKET = "car-documents";

export const DOC_CATEGORIES = [
  { value: "intake", label: "Intake (purchase / title)" },
  { value: "repair", label: "Repair / recon" },
  { value: "sale", label: "Sale / buyer's order" },
  { value: "other", label: "Other" },
];

async function currentUserEmail() {
  const { data } = await supabase.auth.getUser();
  return (data && data.user && data.user.email) || "";
}

// meta: { carId, saleId, category, label, vin, vehicle }
export async function uploadDocument(file, meta) {
  const safeName = (file.name || "document").replace(/[^\w.\-]+/g, "_").slice(-60);
  const folder = meta.carId || meta.saleId || "unassigned";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", cacheControl: "31536000" });
  if (upErr) throw upErr;

  const uploadedBy = await currentUserEmail().catch(() => "");

  const { data, error } = await supabase
    .from("documents")
    .insert({
      car_id: meta.carId || null,
      sale_id: meta.saleId || null,
      category: meta.category || "other",
      label: (meta.label || "").trim(),
      vin: meta.vin || "",
      vehicle: meta.vehicle || "",
      file_name: file.name || "",
      path,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

// filters: { carId, saleId, category, q, from, to }
export async function fetchDocuments(filters = {}) {
  let query = supabase.from("documents").select("*").order("created_at", { ascending: false });
  if (filters.carId) query = query.eq("car_id", filters.carId);
  if (filters.saleId) query = query.eq("sale_id", filters.saleId);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.q) {
    const s = filters.q.replace(/[%,]/g, "");
    query = query.or(`vin.ilike.%${s}%,vehicle.ilike.%${s}%,label.ilike.%${s}%,file_name.ilike.%${s}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// No deleteDocument export, deliberately: the RLS policy on both the
// documents table and the car-documents bucket only grants select/insert,
// so a delete call would fail anyway. Once a document is archived, it stays
// archived — that's the point, for a dealer-board inquiry.

export async function signedDocUrl(path, expiresIn = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
