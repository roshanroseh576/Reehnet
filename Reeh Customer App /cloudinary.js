// cloudinary.js - uploads images, videos and documents to Cloudinary (unsigned upload preset).
// Only the cloud name and the preset name live here. NEVER put the API secret in this file.
export const CLOUD_NAME = "fdxhmndc";
export const UPLOAD_PRESET = "reeh_unsigned";      // create it in Cloudinary: Settings > Upload > Upload presets (Signing mode: Unsigned)

const MAX_MB = { image: 10, video: 100, raw: 10 };  // Cloudinary free plan limits

export function kindOf(file) {
  const t = file.type || "";
  return t.startsWith("image/") ? "image" : t.startsWith("video/") ? "video" : "raw";
}

// big photos are shrunk before upload (saves data); other files are sent as they are
export function shrinkImage(file, maxW = 1600, mime = "image/jpeg", quality = 0.85) {
  if (kindOf(file) !== "image" || /gif|svg/.test(file.type) || typeof document === "undefined") return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxW / Math.max(img.width, img.height));
      if (s === 1 && file.size < 800 * 1024) { URL.revokeObjectURL(url); return resolve(file); }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b ? new File([b], (file.name || "image").replace(/\.\w+$/, "") + (mime === "image/png" ? ".png" : ".jpg"), { type: mime }) : file), mime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// uploadFile(file, { tag, maxW, mime, onProgress(0-100) }) -> { url, publicId, kind, bytes, width, height, duration, name }
export async function uploadFile(file, opts = {}) {
  const { tag = "misc", maxW = 1600, mime = "image/jpeg", onProgress } = opts;
  const kind = kindOf(file);
  const body = kind === "image" ? await shrinkImage(file, maxW, mime) : file;
  if (body.size > MAX_MB[kind] * 1024 * 1024) throw new Error(`File is too large (maximum ${MAX_MB[kind]} MB for this type).`);

  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", body, file.name || "upload");
    fd.append("upload_preset", UPLOAD_PRESET);
    fd.append("tags", tag);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let j = {};
      try { j = JSON.parse(xhr.responseText); } catch (e) { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300 && j.secure_url) {
        resolve({ url: j.secure_url, publicId: j.public_id, kind: j.resource_type || kind, bytes: j.bytes, width: j.width, height: j.height, duration: j.duration, name: file.name || "" });
      } else {
        reject(new Error((j.error && j.error.message) || "Upload failed (" + xhr.status + ")"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error. Check your internet and try again."));
    xhr.ontimeout = () => reject(new Error("Upload took too long. Try again on a better connection."));
    xhr.send(fd);
  });
}
